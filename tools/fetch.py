"""CIRCO FEED: lee feeds.txt, descarga cada feed y actualiza data.js.

Uso: python3 tools/fetch.py
Solo usa la biblioteca estándar. Conserva los artículos de los últimos KEEP_DAYS días.
"""
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
FEEDS = ROOT / "feeds.txt"
DATA = ROOT / "data.js"
TZ = ZoneInfo("America/Santiago")
KEEP_DAYS = 14
EXCERPT = 280
UA = "Mozilla/5.0 (CIRCO FEED; +https://github.com/MrMarcoAI/circo-feed)"


def get(url, limit=None, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(limit) if limit else r.read(), r.geturl()


def discover(page, base):
    """Busca <link rel="alternate" type="application/rss+xml|atom+xml"> en una página HTML."""
    for tag in re.findall(r"<link\b[^>]*>", page.decode("utf-8", "ignore"), re.I):
        if re.search(r"rel=[\"']?alternate", tag, re.I) and re.search(r"(rss|atom)\+xml", tag, re.I):
            href = re.search(r"href=[\"']([^\"']+)", tag, re.I)
            if href:
                return urljoin(base, html.unescape(href.group(1)))
    return None


def local(tag):
    return tag.rsplit("}", 1)[-1]


def child(el, *names):
    for c in el:
        if local(c.tag) in names:
            return c
    return None


def text(el, *names):
    c = child(el, *names)
    return (c.text or "").strip() if c is not None else ""


def parse_date(s):
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


def excerpt(raw):
    t = re.sub(r"<(script|style)\b.*?</\1>", " ", raw or "", flags=re.S | re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) <= EXCERPT:
        return t
    return t[:EXCERPT].rsplit(" ", 1)[0] + "…"


def item_link(el):
    for c in el:
        if local(c.tag) != "link":
            continue
        if c.get("href") and c.get("rel", "alternate") == "alternate":
            return c.get("href")
        if c.text and c.text.strip():
            return c.text.strip()
    return text(el, "guid", "id")


def item_image(el, summary):
    """Imagen del artículo: media:thumbnail/content, enclosure o el primer <img> del contenido."""
    for c in el.iter():
        name, url = local(c.tag), c.get("url")
        if not url:
            continue
        if name == "thumbnail":
            return url
        if name in ("content", "enclosure") and (
                (c.get("type") or "").startswith("image") or c.get("medium") == "image"
                or re.search(r"\.(jpe?g|png|webp|gif)(\?|$)", url, re.I)):
            return url
    m = re.search(r"<img\b[^>]*?src=[\"']([^\"']+)", summary or "", re.I)
    return html.unescape(m.group(1)) if m else ""


def og_image(link):
    """Último recurso: la imagen og:image de la página del artículo."""
    try:
        page, final = get(link, limit=300_000, timeout=10)
    except Exception:
        return ""
    page = page.decode("utf-8", "ignore")
    for tag in re.findall(r"<meta\b[^>]*>", page, re.I):
        if re.search(r"(property|name)=[\"'](og:image|twitter:image)[\"']", tag, re.I):
            m = re.search(r"content=[\"']([^\"']+)", tag, re.I)
            if m:
                return urljoin(final, html.unescape(m.group(1)))
    return ""


def parse_feed(body, url):
    root = ET.fromstring(body)
    chan = child(root, "channel") if local(root.tag) == "rss" else root
    name = html.unescape(text(chan, "title")) or url
    items = []
    for el in root.iter():
        if local(el.tag) not in ("item", "entry"):
            continue
        link = urljoin(url, item_link(el))
        summary = text(el, "encoded", "content", "description", "summary")
        if not summary:  # YouTube guarda la descripción dentro de media:group
            summary = next((c.text for c in el.iter() if local(c.tag) == "description" and c.text), "")
        items.append({
            "id": text(el, "guid", "id") or link,
            "title": html.unescape(text(el, "title")) or "(sin título)",
            "link": link,
            "date": parse_date(text(el, "pubDate", "published", "updated", "date", "issued")),
            "excerpt": excerpt(summary),
            "image": urljoin(url, item_image(el, summary)) if item_image(el, summary) else "",
        })
    return name, items


def read_sources():
    """Devuelve [(categoría, url, nombre o None)] según feeds.txt."""
    out, category = [], "Sin categoría"
    for line in FEEDS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            category = line[1:-1].strip()
            continue
        url, _, name = line.partition("|")
        out.append((category, url.strip(), name.strip() or None))
    return out


def load_previous():
    if not DATA.exists():
        return {}
    raw = DATA.read_text(encoding="utf-8")
    data = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
    return {i["id"]: i for i in data.get("items", [])}


def main():
    now = datetime.now(TZ)
    today = now.date()
    cutoff = today - timedelta(days=KEEP_DAYS)
    previous = load_previous()
    sources, items, errors = [], {}, []

    for category, url, custom in read_sources():
        try:
            body, final = get(url)
            if b"<html" in body[:2000].lower():
                feed_url = discover(body, final)
                if not feed_url:
                    raise ValueError("no encontré un feed RSS en la página")
                body, final = get(feed_url)
            title, entries = parse_feed(body, final)
        except Exception as e:  # una fuente caída no detiene las demás
            errors.append({"url": url, "error": str(e)[:200]})
            print(f"ERROR {url}: {e}", file=sys.stderr)
            continue
        name = custom or title
        sources.append({"name": name, "category": category, "feed": final})
        for e in entries:
            day = e["date"].astimezone(TZ).date() if e["date"] else today
            day = min(day, today)
            if day < cutoff:
                continue
            old = previous.get(e["id"], {})
            items[e["id"]] = {
                "id": e["id"],
                "source": name,
                "category": category,
                "title": e["title"],
                "link": e["link"],
                "excerpt": e["excerpt"],
                "image": e["image"] or old.get("image", ""),
                "day": old.get("day", day.isoformat()),
                "first_seen": old.get("first_seen", today.isoformat()),
                "og_checked": old.get("og_checked", False),
            }
        print(f"{name}: {len(entries)} artículos")

    # Para los artículos sin imagen en el feed, se busca og:image una sola vez
    missing = [i for i in items.values() if not i["image"] and not i["og_checked"]]
    with ThreadPoolExecutor(8) as pool:
        for i, img in zip(missing, pool.map(lambda i: og_image(i["link"]), missing)):
            i["image"], i["og_checked"] = img, True
    print(f"og:image buscada en {len(missing)} artículos")

    out = {
        "updated": now.isoformat(timespec="minutes"),
        "sources": sources,
        "errors": errors,
        "items": sorted(items.values(), key=lambda i: (i["day"], i["first_seen"]), reverse=True),
    }
    DATA.write_text("window.CIRCO = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n",
                    encoding="utf-8")
    new = sum(1 for i in out["items"] if i["id"] not in previous)
    with_img = sum(1 for i in out["items"] if i["image"])
    print(f"{len(out['items'])} artículos en total, {new} nuevos, {with_img} con imagen, {len(errors)} errores")


if __name__ == "__main__":
    main()
