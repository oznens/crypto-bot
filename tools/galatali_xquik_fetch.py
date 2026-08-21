#!/usr/bin/env python3
import json
import os
import sys
import time
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE_URL = os.getenv("XQUIK_BASE_URL", "https://xquik.com/api/v1").rstrip("/")
API_KEY = os.getenv("XQUIK_API_KEY", "").strip()
USERNAME = os.getenv("XQUIK_USERNAME", "GalataliBorsaci").lstrip("@")
MAX_PAGES = int(os.getenv("XQUIK_MAX_PAGES", "200"))
OUT_DIR = Path(os.getenv("XQUIK_OUT_DIR", "data/galatali"))


def write_error(message: str):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "last_error.txt").write_text(message + "\n", encoding="utf-8")
    print(message, file=sys.stderr)


def request_json(url):
    req = Request(
        url,
        headers={
            "x-api-key": API_KEY,
            "accept": "application/json",
            "user-agent": "crypto-bot-galatali-collector/2.0",
        },
    )
    try:
        with urlopen(req, timeout=90) as resp:
            return json.load(resp)
    except HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        raise RuntimeError(f"HTTP {e.code} {e.reason}; url={url}; body={body}") from e
    except URLError as e:
        raise RuntimeError(f"Network error; url={url}; reason={e.reason}") from e


def timeline_page(cursor=None):
    params = {"includeReplies": "true"}
    if cursor:
        params["cursor"] = cursor
    return request_json(
        f"{BASE_URL}/x/users/{quote(USERNAME, safe='')}/tweets?{urlencode(params)}"
    )


def tweet_id(t):
    return str(t.get("id") or t.get("tweet_id") or t.get("tweetId") or t.get("rest_id") or "")


def media_urls(t):
    out = []
    for value in (t.get("media"), t.get("media_urls"), t.get("mediaUrls"), t.get("photos"), t.get("images")):
        if not value:
            continue
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    out.append(item)
                elif isinstance(item, dict):
                    for k in ("mediaUrl", "url", "media_url_https", "media_url", "preview_image_url"):
                        if item.get(k):
                            out.append(item[k])
                            break
    return list(dict.fromkeys(out))


def normalize(t):
    tid = tweet_id(t)
    return {
        "id": tid,
        "created_at": t.get("createdAt") or t.get("created_at") or t.get("timestamp"),
        "text": t.get("text") or t.get("full_text") or t.get("fullText") or "",
        "url": t.get("url") or (f"https://x.com/{USERNAME}/status/{tid}" if tid else None),
        "media": media_urls(t),
        "is_reply": bool(t.get("isReply")),
        "raw": t,
    }


def sort_key(item):
    value = item.get("created_at")
    if not value:
        return 0.0
    try:
        return parsedate_to_datetime(value).timestamp()
    except Exception:
        return 0.0


def load_existing():
    path = OUT_DIR / "tweets.json"
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
        return {str(row.get("id")): row for row in rows if row.get("id")}
    except Exception:
        return {}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not API_KEY:
        write_error("XQUIK_API_KEY secret is missing.")
        return 0

    collected = load_existing()
    before = len(collected)
    cursor = None
    seen_cursors = set()
    pages = 0
    api_rows = 0
    stop_reason = "max_pages"

    try:
        while pages < MAX_PAGES:
            payload = timeline_page(cursor)
            tweets = payload.get("tweets", []) if isinstance(payload, dict) else []
            if not isinstance(tweets, list):
                tweets = []

            api_rows += len(tweets)
            for raw in tweets:
                if not isinstance(raw, dict):
                    continue
                item = normalize(raw)
                if item["id"]:
                    collected[item["id"]] = item

            pages += 1
            next_cur = payload.get("next_cursor") if isinstance(payload, dict) else None
            has_next = bool(payload.get("has_next_page")) if isinstance(payload, dict) else False
            print(f"page={pages} rows={len(tweets)} unique={len(collected)} has_next={has_next}")

            if not has_next or not next_cur:
                stop_reason = "no_next_page"
                break
            if next_cur == cursor or next_cur in seen_cursors:
                stop_reason = "repeated_cursor"
                break

            seen_cursors.add(next_cur)
            cursor = next_cur
            time.sleep(0.5)
    except Exception as e:
        write_error(str(e))
        stop_reason = "error"

    ordered = sorted(collected.values(), key=sort_key, reverse=True)
    chart_tweets = [t for t in ordered if t.get("media")]
    original_posts = [t for t in ordered if not t.get("is_reply")]

    (OUT_DIR / "tweets.json").write_text(json.dumps(ordered, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "chart_tweets.json").write_text(json.dumps(chart_tweets, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "original_posts.json").write_text(json.dumps(original_posts, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "backfill_status.json").write_text(json.dumps({
        "username": USERNAME,
        "pages_fetched": pages,
        "api_rows_seen": api_rows,
        "unique_before": before,
        "unique_after": len(ordered),
        "new_unique": len(ordered) - before,
        "media_tweets": len(chart_tweets),
        "original_posts": len(original_posts),
        "stop_reason": stop_reason,
        "has_cursor_checkpoint": bool(cursor),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Galatalı Borsacı X Arşivi",
        "",
        f"Hesap: @{USERNAME}",
        f"Toplam benzersiz tweet: {len(ordered)}",
        f"Grafik/medya içeren tweet: {len(chart_tweets)}",
        f"Orijinal gönderi: {len(original_posts)}",
        f"Backfill sayfası: {pages}",
        f"Durma nedeni: {stop_reason}",
        "",
        "## Son gönderiler",
        "",
    ]
    for t in ordered[:100]:
        text = " ".join(str(t.get("text") or "").split())
        lines.append(f"- {t.get('created_at') or ''} — [{text[:180]}]({t.get('url') or '#'})")
    (OUT_DIR / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    if stop_reason != "error":
        err = OUT_DIR / "last_error.txt"
        if err.exists():
            err.unlink()

    print(f"saved={len(ordered)} chart_tweets={len(chart_tweets)} pages={pages} stop={stop_reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
