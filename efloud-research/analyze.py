import csv
import json
import pathlib
import re
from collections import Counter, defaultdict

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "analysis"
OUT.mkdir(exist_ok=True)

CONCEPTS = {
    "support_resistance": [r"support", r"resistance", r"destek", r"direnç", r"box", r"zone", r"bölge"],
    "market_structure": [r"structure", r"market structure", r"trend", r"higher high", r"lower low", r"hh\b", r"hl\b", r"lh\b", r"ll\b"],
    "breakout_close": [r"breakout", r"break down", r"closing above", r"closing below", r"close above", r"close below", r"kapanış"],
    "liquidity": [r"liquidity", r"likidite", r"sweep", r"stop hunt", r"stop av"],
    "supply_demand": [r"supply", r"demand", r"arz", r"talep"],
    "range_regime": [r"range", r"chop", r"sideway", r"rejim", r"sığ su", r"volatility", r"volatilite"],
    "risk_psychology": [r"risk", r"stop", r"position size", r"psychology", r"psikoloji", r"discipline", r"disiplin", r"sabır"],
    "macro_fa": [r"fed", r"cpi", r"inflation", r"fa\b", r"macro", r"makro", r"faiz", r"fomc"],
    "dca_investing": [r"dca", r"recurring", r"yatırım", r"invest", r"portfolio", r"portföy"],
}

ASSETS = ["BTC", "ETH", "SOL", "DOGE", "XRP", "BNB", "TOTAL", "TOTAL2", "TOTAL3", "USDT.D", "BTC.D"]
TIMEFRAMES = ["1M", "1W", "1D", "12H", "8H", "6H", "4H", "2H", "1H", "30M", "15M", "5M", "LTF", "HTF"]


def load_rows():
    p = DATA / "tweets.jsonl"
    if not p.exists():
        raise SystemExit("Önce fetch_xquik.py çalıştırılmalı: data/tweets.jsonl yok")
    rows = []
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def tags_for(text):
    low = text.lower()
    tags = []
    for name, pats in CONCEPTS.items():
        if any(re.search(p, low, re.I) for p in pats):
            tags.append(name)
    return tags


def detect_assets(text):
    u = text.upper()
    found = []
    for a in ASSETS:
        if re.search(rf"(?<![A-Z0-9])\$?{re.escape(a)}(?![A-Z0-9])", u):
            found.append(a)
    return found


def detect_tfs(text):
    u = text.upper()
    found = []
    for tf in TIMEFRAMES:
        if re.search(rf"(?<![A-Z0-9]){re.escape(tf)}(?![A-Z0-9])", u):
            found.append(tf)
    return found


def main():
    rows = load_rows()
    concept_counts = Counter()
    asset_counts = Counter()
    tf_counts = Counter()
    monthly = Counter()
    examples = defaultdict(list)
    out_rows = []

    for r in rows:
        text = r.get("text", "")
        tags = tags_for(text)
        assets = detect_assets(text)
        tfs = detect_tfs(text)
        created = r.get("created_at", "")
        month = created[:7] if len(created) >= 7 else "unknown"
        monthly[month] += 1
        concept_counts.update(tags)
        asset_counts.update(assets)
        tf_counts.update(tfs)
        for t in tags:
            if len(examples[t]) < 5:
                examples[t].append((created, r.get("url", ""), text.replace("\n", " ")[:280]))
        out_rows.append({
            "id": r.get("id", ""),
            "created_at": created,
            "url": r.get("url", ""),
            "concepts": "|".join(tags),
            "assets": "|".join(assets),
            "timeframes": "|".join(tfs),
            "has_media": bool(r.get("media") or r.get("media_files")),
            "likes": r.get("like_count", 0),
            "retweets": r.get("retweet_count", 0),
            "views": r.get("view_count", 0),
            "text": text,
        })

    with (OUT / "concepts.csv").open("w", encoding="utf-8-sig", newline="") as f:
        fields = list(out_rows[0].keys()) if out_rows else ["id"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out_rows)

    media_count = sum(1 for r in out_rows if r.get("has_media"))
    lines = [
        "# Efloud – Son 1 Yıl İçerik Analizi",
        "",
        f"Toplam tweet: **{len(rows)}**",
        f"Medya/grafik içeren tweet: **{media_count}**",
        "",
        "## Kavram sıklığı",
        "",
    ]
    for k, v in concept_counts.most_common():
        lines.append(f"- **{k}**: {v}")
    lines += ["", "## En sık geçen varlıklar", ""]
    for k, v in asset_counts.most_common(15):
        lines.append(f"- **{k}**: {v}")
    lines += ["", "## Zaman dilimleri", ""]
    for k, v in tf_counts.most_common():
        lines.append(f"- **{k}**: {v}")
    lines += ["", "## Aylık paylaşım yoğunluğu", ""]
    for k in sorted(monthly):
        lines.append(f"- **{k}**: {monthly[k]}")

    lines += [
        "",
        "## Yöntem çıkarımı için okuma sırası",
        "",
        "1. Medyalı tweetleri tarih sırasıyla incele; çizilen box/zone/level ve kapanış şartlarını not et.",
        "2. Aynı grafiğin update tweetlerini conversation/thread ID üzerinden eşleştir.",
        "3. Entry şartı ile invalidation şartını ayır: seviye teması tek başına mı, yoksa candle close/confirmation mı gerekiyor?",
        "4. HTF yön filtresi ile LTF execution arasındaki ilişkiyi çıkar.",
        "5. Rejim notlarını ayrı tut: trend, range, düşük likidite/yaz dönemi gibi koşullarda davranış değişiyor mu kontrol et.",
        "6. Risk/psikoloji tweetlerini setup kurallarından ayrı bir katman olarak modelle.",
        "",
        "## Temsilî örnekler",
        "",
    ]
    for tag, vals in examples.items():
        lines.append(f"### {tag}")
        lines.append("")
        for created, url, text in vals:
            lines.append(f"- {created} — {url} — {text}")
        lines.append("")

    (OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"analiz tamamlandı: {OUT / 'report.md'}")


if __name__ == "__main__":
    main()
