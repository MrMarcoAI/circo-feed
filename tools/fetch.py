"""CIRCO FEED: lee feeds.txt, descarga cada feed y actualiza data.js.

Uso: python3 tools/fetch.py
Solo usa la biblioteca estándar. Conserva los artículos de los últimos KEEP_DAYS días.
"""
import hashlib
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

sys.setrecursionlimit(20000)  # algunas páginas anidan cientos de etiquetas
ROOT = Path(__file__).resolve().parent.parent
FEEDS = ROOT / "feeds.txt"
DATA = ROOT / "data.js"
ARTICLES = ROOT / "articles"  # texto completo de cada nota, un .json por noticia, para el lightbox
FULL_MIN = 1200  # caracteres desde los que el contenido del feed cuenta como nota completa
TZ = ZoneInfo("America/Santiago")
KEEP_DAYS = 14
EXCERPT = 280
UA = "Mozilla/5.0 (CIRCO FEED; +https://github.com/MrMarcoAI/circo-feed)"


def get(url, limit=None, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
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


ALLOWED = {"p", "h2", "h3", "h4", "blockquote", "ul", "ol", "li", "strong", "em", "b", "i", "a", "img",
           "figure", "figcaption", "br"}
VOID = {"img", "br"}
SKIP = {"script", "style", "nav", "footer", "aside", "form", "header", "noscript", "iframe", "svg", "button",
        "template", "select"}


class Cleaner(HTMLParser):
    """Deja solo etiquetas de texto seguras, sin atributos salvo href e src."""

    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.out, self.skip = base, [], 0

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
            return
        if self.skip or tag not in ALLOWED:
            return
        a = dict(attrs)
        if tag == "a":
            href = urljoin(self.base, a.get("href") or "")
            self.out.append(f'<a href="{html.escape(href)}" target="_blank" rel="noopener">'
                            if href.startswith("http") else "<a>")
        elif tag == "img":
            src = urljoin(self.base, a.get("data-src") or a.get("src") or "")
            if src.startswith("http"):
                self.out.append(f'<img src="{html.escape(src)}" alt="" loading="lazy">')
        else:
            self.out.append(f"<{tag}>")

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
        elif not self.skip and tag in ALLOWED and tag not in VOID:
            self.out.append(f"</{tag}>")

    def handle_data(self, d):
        if not self.skip:
            self.out.append(html.escape(d))


def clean(raw, base):
    c = Cleaner(base)
    c.feed(raw)
    return "".join(c.out)


def plain(h):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h))).strip()


HTML_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
BLOCK = {"p", "div", "section", "article", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "figure", "table"}


class Tree(HTMLParser):
    """Árbol mínimo de la página: cada nodo es [tag, attrs, hijos, padre]; los textos son str."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = ["root", {}, [], None]
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        if tag in BLOCK and self.cur[0] == "p":  # un bloque nuevo cierra el <p> abierto
            self.cur = self.cur[3]
        node = [tag, dict(attrs), [], self.cur]
        self.cur[2].append(node)
        if tag not in HTML_VOID:
            self.cur = node

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n[0] != tag:
            n = n[3]
        if n is not self.root:
            self.cur = n[3]

    def handle_data(self, d):
        self.cur[2].append(d)


def node_text(n):
    return "".join(k if isinstance(k, str) else node_text(k) for k in n[2] if isinstance(k, str) or k[0] not in SKIP)


def serialize(n, base, out):
    for k in n[2]:
        if isinstance(k, str):
            out.append(html.escape(k))
            continue
        tag, attrs = k[0], k[1]
        if tag in SKIP:
            continue
        if tag == "a":
            href = urljoin(base, attrs.get("href") or "")
            out.append(f'<a href="{html.escape(href)}" target="_blank" rel="noopener">' if href.startswith("http") else "<a>")
        elif tag == "img":
            src = urljoin(base, attrs.get("data-src") or attrs.get("src") or "")
            if src.startswith("http"):
                out.append(f'<img src="{html.escape(src)}" alt="" loading="lazy">')
            continue
        elif tag in ALLOWED:
            out.append(f"<{tag}>")
        serialize(k, base, out)
        if tag in ALLOWED and tag not in VOID:
            out.append(f"</{tag}>")


def page_text(link):
    """Texto de la nota desde su página, al estilo Readability: el contenedor con más texto en párrafos."""
    page, final = get(link, limit=2_000_000, timeout=15)
    t = Tree()
    t.feed(page.decode("utf-8", "ignore"))
    score, stack = {}, [t.root]
    while stack:
        n = stack.pop()
        for k in n[2]:
            if isinstance(k, str) or k[0] in SKIP:
                continue
            if k[0] == "p":
                size = len(node_text(k).strip())
                if size >= 25:
                    for up, w in ((n, 1), (n[3], 0.75)):
                        if up is not None:
                            score[id(up)] = (score.get(id(up), (0, up))[0] + size * w, up)
            stack.append(k)
    if not score:
        return ""
    best = max(score.values(), key=lambda s: s[0])[1]
    out = []
    serialize(best, final, out)
    blocks = re.findall(r"<(p|h2|h3|h4|blockquote|ul|ol|figure)>(.*?)</\1>", "".join(out), re.S)
    keep, last = [], None
    for tag, b in blocks:
        txt = plain(b)
        if txt == last or (not txt and "<img" not in b):
            continue
        keep.append(f"<{tag}>{b}</{tag}>")
        last = txt
    return "\n".join(keep)


def full_text(item):
    """HTML limpio de la nota completa: el del feed si viene entero, si no el de la página."""
    feed_html = clean(item["content"], item["link"])
    if len(plain(feed_html)) >= FULL_MIN:
        return feed_html
    try:
        page_html = page_text(item["link"])
    except Exception:
        page_html = ""
    best = max(page_html, feed_html, key=lambda h: len(plain(h)))
    return best if len(plain(best)) >= 200 else ""


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
            "content": summary,
            "image": urljoin(url, item_image(el, summary)) if item_image(el, summary) else "",
        })
    return name, items


AGO = {"m": "minutes", "h": "hours", "d": "days", "w": "weeks", "mo": "days", "y": "days"}


def youtube_page(url):
    """Plan B cuando YouTube no entrega el RSS del canal: lee los videos desde la página /videos."""
    page, _ = get(url.split("?")[0].rstrip("/") + "/videos")
    page = page.decode("utf-8", "ignore")
    m = re.search(r'<meta property="og:title" content="([^"]+)"', page)
    name = html.unescape(m.group(1)) if m else url
    now, items = datetime.now(timezone.utc), []
    for m in re.finditer(r'"lockupViewModel":\{"contentImage"', page):
        seg = page[m.start(): m.start() + 12000]
        vid = re.search(r'"contentId":"([\w-]{11})"', seg)
        title = re.search(r'"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"', seg)
        if not (vid and title):
            continue
        date = None
        ago = re.search(r'"content":"(\d+)\s*(mo|[mhdwy])[a-z]* ago"', seg)
        if ago:  # "9h ago", "4d ago", "2mo ago"…
            n, unit = int(ago.group(1)), ago.group(2)
            n *= 30 if unit == "mo" else 365 if unit == "y" else 1
            date = now - timedelta(**{AGO[unit]: n})
        items.append({
            "id": "yt:video:" + vid.group(1),
            "title": json.loads('"' + title.group(1) + '"'),
            "link": "https://www.youtube.com/watch?v=" + vid.group(1),
            "date": date,
            "excerpt": "",
            "content": "",
            "image": f"https://i.ytimg.com/vi/{vid.group(1)}/hqdefault.jpg",
        })
    if not items:
        raise ValueError("YouTube no entregó el RSS ni la lista de videos")
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
                try:
                    body, final = get(feed_url)
                except Exception:
                    if "youtube.com" not in url:
                        raise
                    body = None
            title, entries = parse_feed(body, final) if body else youtube_page(url)
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
                "article": old.get("article"),  # None: todavía no se busca el texto completo
                "content": e["content"],
            }
        print(f"{name}: {len(entries)} artículos")

    # Para los artículos sin imagen en el feed, se busca og:image una sola vez
    missing = [i for i in items.values() if not i["image"] and not i["og_checked"]]
    with ThreadPoolExecutor(8) as pool:
        for i, img in zip(missing, pool.map(lambda i: og_image(i["link"]), missing)):
            i["image"], i["og_checked"] = img, True
    print(f"og:image buscada en {len(missing)} artículos")

    # Texto completo para el lightbox: se busca una sola vez por noticia y queda en articles/<clave>.json
    ARTICLES.mkdir(exist_ok=True)
    todo = [i for i in items.values() if i["article"] is None and "youtube.com/watch" not in i["link"]]
    with ThreadPoolExecutor(8) as pool:
        for i, text_html in zip(todo, pool.map(full_text, todo)):
            i["article"] = ""
            if text_html:
                i["article"] = hashlib.sha1(i["id"].encode()).hexdigest()[:16]
                (ARTICLES / f"{i['article']}.json").write_text(
                    json.dumps({"html": text_html}, ensure_ascii=False), encoding="utf-8")
    for i in items.values():
        i.pop("content")
        i["article"] = i["article"] or ""
    keep = {i["article"] for i in items.values()}
    for f in ARTICLES.glob("*.json"):
        if f.stem not in keep:
            f.unlink()
    print(f"texto completo buscado en {len(todo)} artículos, {sum(1 for i in todo if i['article'])} con texto")

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
