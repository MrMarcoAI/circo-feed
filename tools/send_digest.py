"""Manda por Gmail un resumen con los artículos nuevos de hoy (según data.js).

Uso: python3 tools/send_digest.py [--dry-run]
Variables de entorno: GMAIL_USER, GMAIL_APP_PASSWORD, DIGEST_TO (opcional, por defecto GMAIL_USER),
CIRCO_URL (link a la webapp). Sin credenciales, no envía y termina sin error.
"""
import html
import json
import os
import smtplib
import sys
from datetime import datetime
from email.mime.text import MIMEText
from pathlib import Path
from zoneinfo import ZoneInfo

DATA = Path(__file__).resolve().parent.parent / "data.js"
URL = os.environ.get("CIRCO_URL") or "https://mrmarcoai.github.io/circo-feed/"
PER_SOURCE = 5


def build(items, today):
    by_source = {}
    for i in items:
        by_source.setdefault(i["source"], []).append(i)
    e = html.escape
    parts = [f'<div style="font-family:Inter,Helvetica Neue,Arial,sans-serif;max-width:600px;color:#111">'
             f'<h1 style="font-size:24px;margin:0 0 4px">CIRCO FEED</h1>'
             f'<p style="color:#6b6b6b;margin:0 0 24px">{len(items)} artículos nuevos · '
             f'<a href="{URL}" style="color:#111">Leer en la webapp</a></p>']
    for source, rows in by_source.items():
        parts.append(f'<h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#ce2be7;'
                     f'border-bottom:2px solid #ce2be7;padding-bottom:6px;margin:28px 0 8px">{e(source)}</h2>')
        for i in rows[:PER_SOURCE]:
            parts.append(f'<p style="margin:12px 0"><a href="{e(i["link"])}" style="color:#111;font-weight:700;'
                         f'text-decoration:none;font-size:16px">{e(i["title"])}</a><br>'
                         f'<span style="color:#6b6b6b;font-size:14px">{e(i["excerpt"][:160])}</span></p>')
        if len(rows) > PER_SOURCE:
            parts.append(f'<p style="font-size:14px"><a href="{URL}" style="color:#6b6b6b">'
                         f'y {len(rows) - PER_SOURCE} más</a></p>')
    parts.append("</div>")
    return "".join(parts)


def main():
    raw = DATA.read_text(encoding="utf-8")
    data = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
    today = datetime.now(ZoneInfo("America/Santiago")).date().isoformat()
    items = [i for i in data["items"] if i["first_seen"] == today]
    if not items:
        print("Sin artículos nuevos hoy; no se envía nada.")
        return

    body = build(items, today)
    if "--dry-run" in sys.argv:
        print(body)
        return

    user, password = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    if not user or not password:
        print("Faltan GMAIL_USER / GMAIL_APP_PASSWORD; no se envía el mail.")
        return
    msg = MIMEText(body, "html", "utf-8")
    msg["Subject"] = f"CIRCO FEED · {len(items)} artículos nuevos"
    msg["From"] = user
    msg["To"] = os.environ.get("DIGEST_TO") or user
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(user, password)
        s.send_message(msg)
    print(f"Mail enviado a {msg['To']} con {len(items)} artículos.")


if __name__ == "__main__":
    main()
