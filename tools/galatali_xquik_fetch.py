#!/usr/bin/env python3
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE_URL = os.getenv("XQUIK_BASE_URL", "https://xquik.com/api/v1").rstrip("/")
API_KEY = os.getenv("XQUIK_API_KEY", "").strip()
USERNAME = os.getenv("XQUIK_USERNAME", "GalataliBorsaci").lstrip("@")
MAX_PAGES = int(os.getenv("XQUIK_MAX_PAGES", "25"))
LIMIT = min(int(os.getenv("XQUIK_LIMIT", "200")), 200)
OUT_DIR = Path(os.getenv("XQUIK_OUT_DIR", "data/galatali"))


def fail(msg: str, code: int = 1):
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def get_json(params):
    url = f"{BASE_URL}/x/tweets/search?{urlencode(params)}"
    req = Request(
        url,
        headers={
            "x-api-key": API_KEY,
            "xquik-api-contract": "2026-04-29",
            "accept": "application/json",
            "user-agent": "crypto-bot-galatali-collector/1.0",
        },
    )
    with urlopen(req, timeout=60) as resp:
        return json.load(resp)


def as_list(payload):
    for key in ("tweets", "data", "items", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for sub in ("tweets", "items", "results"):
                if isinstance(value.get(sub), list):
                    return value[sub]
    return []


def next_cursor(payload):
    for key in ("next_cursor", "nextCursor"):
        value = payload.get(key)
        if value:
            return value
    data = payload.get("data")
    if isinstance(data, dict):
        return data.get("next_cursor") or data.get("nextCursor")
    return None


def tweet_id(t):
    return str(t.get("id") or t.get("tweet_id") or t.get("tweetId") or t.get("rest_id") or "")


def media_urls(t):
    out = []
    candidates = []
    for key in ("media", "media_urls", "mediaUrls", "photos", "images"):
        value = t.get(key)
        if value:
            candidates.append(value)
    entities = t.get("entities")
    if isinstance(entities, dict) and entities.get("media"):
        candidates.append(entities["media"])
    for value in candidates:
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    out.append(item)
                elif isinstance(item, dict):
                    for k in ("url", "media_url_https", "media_url", "preview_image_url"):
                        if item.get(k):
                            out.append(item[k])
                            break
    return list(dict.fromkeys(out))


def normalize(t):
    tid = tweet_id(t)
    text = t.get("text") or t.get("full_text") or t.get("fullText") or ""
    created = t.get("created_at") or t.get("createdAt") or t.get("timestamp")
    url = t.get("url") or (f"https://x.com/{USERNAME}/status/{tid}" if tid else None)
    return {
        "id": tid,
        "created_at": created,
        "text": text,
        "url": url,
        "media": media_urls(t),
        "raw": t,
    }


def main():
    if not API_KEY:
        fail("XQUIK_API_KEY secret is missing.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    query = f"from:{USERNAME}"
    cursor = None
    collected = {}
    page = 0

    while page < MAX_PAGES:
        params = {"q": query, "limit": LIMIT}
        if cursor:
            params["cursor"] = cursor
        payload = get_json(params)
        tweets = as_list(payload)
        print(f"page={page + 1} tweets={len(tweets)}")
        for raw in tweets:
            if not isinstance(raw, dict):
                continue
            item = normalize(raw)
            if item["id"]:
                collected[item["id"]] = item
        cursor = next_cursor(payload)
        page += 1
        if not cursor or not tweets:
            break
        time.sleep(0.4)

    ordered = sorted(
        collected.values(),
        key=lambda x: str(x.get("created_at") or ""),
        reverse=True,
    )

    (OUT_DIR / "tweets.json").write_text(
        json.dumps(ordered, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    chart_tweets = [t for t in ordered if t.get("media")]
    (OUT_DIR / "chart_tweets.json").write_text(
        json.dumps(chart_tweets, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    lines = [
        "# Galatalı Borsacı X Arşivi",
        "",
        f"Hesap: @{USERNAME}",
        f"Toplam tweet: {len(ordered)}",
        f"Grafik/medya içeren tweet: {len(chart_tweets)}",
        "",
        "## Son tweetler",
        "",
    ]
    for t in ordered[:100]:
        text = " ".join(str(t.get("text") or "").split())
        lines.append(f"- {t.get('created_at') or ''} — [{text[:180]}]({t.get('url') or '#'})")
    (OUT_DIR / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"saved={len(ordered)} chart_tweets={len(chart_tweets)} dir={OUT_DIR}")


if __name__ == "__main__":
    main()
