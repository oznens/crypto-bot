import csv
import json
import os
import pathlib
import time
from urllib.parse import urlparse

import requests

BASE = "https://xquik.com/api/v1"
USERNAME = "Efloud"
SINCE = "2025-08-17T00:00:00Z"
UNTIL = "2026-08-17T23:59:59Z"
PAGE_LIMIT = 200

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
MEDIA = ROOT / "media"
DATA.mkdir(exist_ok=True)
MEDIA.mkdir(exist_ok=True)

API_KEY = os.getenv("XQUIK_API_KEY")
if not API_KEY:
    raise SystemExit("XQUIK_API_KEY ortam değişkeni eksik")

session = requests.Session()
session.headers.update({"x-api-key": API_KEY, "User-Agent": "efloud-research/1.0"})


def get_page(cursor=None):
    params = {
        "q": f"from:{USERNAME}",
        "limit": PAGE_LIMIT,
        "sinceTime": SINCE,
        "untilTime": UNTIL,
        "queryType": "Latest",
    }
    if cursor:
        params["cursor"] = cursor
    r = session.get(f"{BASE}/x/tweets/search", params=params, timeout=45)
    if r.status_code == 429:
        wait = int(r.headers.get("Retry-After", "30"))
        time.sleep(wait)
        return get_page(cursor)
    r.raise_for_status()
    return r.json()


def media_items(tweet):
    media = tweet.get("media") or []
    if isinstance(media, dict):
        media = [media]
    return media


def pick_media_url(item):
    for key in ("url", "mediaUrl", "media_url_https", "previewImageUrl", "videoUrl"):
        val = item.get(key)
        if isinstance(val, str) and val.startswith("http"):
            return val
    variants = item.get("variants") or []
    if variants:
        mp4s = [v for v in variants if v.get("url") and "mp4" in (v.get("contentType") or v.get("content_type") or "")]
        if mp4s:
            mp4s.sort(key=lambda x: x.get("bitrate", 0), reverse=True)
            return mp4s[0]["url"]
    return None


def download_media(tweet):
    tid = str(tweet.get("id", "unknown"))
    saved = []
    for i, item in enumerate(media_items(tweet), 1):
        url = pick_media_url(item)
        if not url:
            continue
        suffix = pathlib.Path(urlparse(url).path).suffix
        if not suffix or len(suffix) > 6:
            typ = (item.get("type") or "").lower()
            suffix = ".mp4" if "video" in typ else ".jpg"
        target = MEDIA / f"{tid}_{i}{suffix}"
        if target.exists():
            saved.append(str(target.relative_to(ROOT)))
            continue
        try:
            rr = requests.get(url, timeout=60, stream=True)
            rr.raise_for_status()
            with target.open("wb") as f:
                for chunk in rr.iter_content(1024 * 256):
                    if chunk:
                        f.write(chunk)
            saved.append(str(target.relative_to(ROOT)))
        except Exception as exc:
            print(f"media indirilemedi {tid}: {exc}")
    return saved


def normalize(tweet):
    author = tweet.get("author") or {}
    created = tweet.get("createdAt") or tweet.get("created_at") or ""
    tid = str(tweet.get("id", ""))
    return {
        "id": tid,
        "created_at": created,
        "text": tweet.get("text") or "",
        "url": f"https://x.com/{USERNAME}/status/{tid}" if tid else "",
        "username": author.get("username") or USERNAME,
        "like_count": tweet.get("likeCount", tweet.get("like_count", 0)) or 0,
        "reply_count": tweet.get("replyCount", tweet.get("reply_count", 0)) or 0,
        "retweet_count": tweet.get("retweetCount", tweet.get("retweet_count", 0)) or 0,
        "quote_count": tweet.get("quoteCount", tweet.get("quote_count", 0)) or 0,
        "view_count": tweet.get("viewCount", tweet.get("view_count", 0)) or 0,
        "is_reply": bool(tweet.get("isReply", tweet.get("is_reply", False))),
        "is_quote": bool(tweet.get("isQuoteStatus", tweet.get("is_quote_status", False))),
        "media": media_items(tweet),
    }


def main():
    rows = []
    seen = set()
    cursor = None
    page_no = 0

    while True:
        page_no += 1
        page = get_page(cursor)
        tweets = page.get("tweets") or []
        print(f"page {page_no}: {len(tweets)} tweet")
        for raw in tweets:
            row = normalize(raw)
            if not row["id"] or row["id"] in seen:
                continue
            seen.add(row["id"])
            row["media_files"] = download_media(raw)
            rows.append(row)

        has_next = page.get("has_next_page", page.get("hasMore", False))
        cursor = page.get("next_cursor") or page.get("nextCursor")
        if not has_next or not cursor or not tweets:
            break
        time.sleep(0.4)

    rows.sort(key=lambda r: r["created_at"])

    with (DATA / "tweets.jsonl").open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    csv_fields = [
        "id", "created_at", "text", "url", "username", "like_count", "reply_count",
        "retweet_count", "quote_count", "view_count", "is_reply", "is_quote", "media_files"
    ]
    with (DATA / "tweets.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=csv_fields)
        w.writeheader()
        for row in rows:
            out = {k: row.get(k, "") for k in csv_fields}
            out["media_files"] = "|".join(row.get("media_files", []))
            w.writerow(out)

    print(f"tamamlandı: {len(rows)} tweet, {sum(len(r.get('media_files', [])) for r in rows)} medya")


if __name__ == "__main__":
    main()
