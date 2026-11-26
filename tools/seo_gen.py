# Generates static SEO pages for build.noyaglobal.com from the catalogue in index.html.
# Run: python3 tools/seo_gen.py   (rewrites /p, /c, /gifts, /guides and sitemap.xml)
import re, json, os, html, shutil, datetime, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from content_more import AUD, IND, EVT, SIZES, GUIDES2, EN_PAGES, KIND
from product_copy import COPY
from guides_extra import EXTRA, CAT_MORE
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://build.noyaglobal.com"
TODAY = datetime.date.today().isoformat()
SRC = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
P = [p for p in json.loads(re.search(r'^const P=(\[.*?\]);\s*$', SRC, re.M).group(1)) if not p.get("hidden")]
BY = {p["id"]: p for p in P}
CATS = {"diffuser": "מפיצי ריח", "candle": "נרות", "holder": "פמוטים", "textile": "טקסטיל", "serve": "עץ והגשה",
        "kitchen": "מטבח", "gift": "מארזי מתנה", "drink": "כלי שתייה", "decor": "אגרטלים ועציצים"}
CAT_SLUG = {k: k for k in CATS}
CAT_INTRO = {
 "diffuser": "מפיצי ריח ודיפיוזרים יוקרתיים למארזי שי – מקלות ראטן טבעיים, בקבוקים מעוצבים וניחוחות שנשארים בבית ובמשרד הרבה אחרי החג. מתנה שמרגישים כל יום.",
 "candle": "נרות ריחניים למארזי מתנה לעובדים וללקוחות – נרות סויה, נרות בכלי קרמי ונרות ארוכים NOYA HOME, ארוזים ומוכנים למארז.",
 "holder": "פמוטים קרמיים, זכוכית וזהב למארזי שי – מתנה קלאסית לחג, לשבת ולבית, שמשתלבת בכל מארז ונראית מושקעת.",
 "textile": "מפות שולחן, מגבות ופלייסמטים למארזי מתנה – טקסטיל איכותי לבית, ארוז כמתנה ומתאים במיוחד למארזי ראש השנה ופסח.",
 "serve": "מגשים, קרשי הגשה וקערות מעץ וקרמיקה למארזי שי – מתנה שימושית ואלגנטית לשולחן החג.",
 "kitchen": "מתנות למטבח למארזי שי לעובדים – סטים לשמן זית, קרשי חיתוך מעץ שיטה, סכיני שף ואביזרי הגשה.",
 "gift": "מארזי מתנה מוכנים ופריטי פינוק – בסיס מצוין למארז שי לעובדים, ללקוחות ולשותפים עסקיים.",
 "drink": "כלי שתייה למארזי מתנה – כוסות ופריטי אירוח שמשדרגים כל מארז שי.",
 "decor": "אגרטלים, עציצים ופריטי עיצוב למארזי מתנה – נגיעה עיצובית שמכניסה את המותג שלכם לבית של כל עובד.",
}
FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700&family=Assistant:wght@400;600;700&display=swap" rel="stylesheet">'
CSS = """
:root{--cream:#f7efe4;--paper:#fffaf3;--cocoa:#4a2f22;--soft:#7a5a48;--gold:#b08a4f;--gl:#e6d3b0;--line:#e2d3c0}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--cream);color:var(--cocoa);font-family:Assistant,Arial,sans-serif;line-height:1.7;font-size:17px}
a{color:var(--cocoa)}
.top{position:sticky;top:0;z-index:10;background:rgba(255,250,243,.94);backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.top-in{max-width:1100px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none;font-family:'Frank Ruhl Libre',serif;font-weight:700;font-size:20px}
.logo img{width:36px;height:36px;border-radius:9px}
.btn{display:inline-block;text-decoration:none;font-weight:700;border-radius:99px;padding:11px 22px;background:linear-gradient(135deg,#ead6a6,#cfab6c 50%,#b08a4f);color:var(--cocoa);box-shadow:inset 0 0 0 1px rgba(140,106,51,.45),0 8px 18px -8px rgba(140,106,51,.55);white-space:nowrap}
.btn.ghost{background:var(--paper);box-shadow:inset 0 0 0 1.5px var(--gold)}
.btn.sm{padding:8px 16px;font-size:15px}
main{max-width:1100px;margin:auto;padding:18px 18px 40px}
.crumbs{font-size:14px;color:var(--soft);margin:4px 0 14px}.crumbs a{color:var(--soft);text-decoration:none;display:inline-block;padding:6px 0}.crumbs a:hover{text-decoration:underline}
h1{font-family:'Frank Ruhl Libre',serif;font-size:clamp(28px,4.4vw,42px);line-height:1.25;margin:6px 0 12px}
h2{font-family:'Frank Ruhl Libre',serif;font-size:clamp(22px,3vw,28px);margin:34px 0 10px}
h3{font-size:19px;margin:18px 0 6px}
.lead{font-size:19px;color:var(--soft);max-width:760px}
.hero{display:grid;grid-template-columns:1.1fr 1fr;gap:28px;align-items:center;background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:26px}
.hero img{width:100%;aspect-ratio:1;object-fit:contain;background:#fff;border-radius:16px}
.cta-row{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 4px}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0;padding:0;list-style:none}
.facts li{font-size:14.5px;border:1px solid var(--gl);border-radius:99px;padding:4px 12px;background:#fff}
.price{font-size:28px;font-weight:700}.price small{font-size:14px;color:var(--soft);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-top:12px}
.card{display:flex;flex-direction:column;background:var(--paper);border:1px solid var(--line);border-radius:16px;overflow:hidden;text-decoration:none;transition:transform .15s,box-shadow .15s}
.card:hover{transform:translateY(-2px);box-shadow:0 10px 24px -12px rgba(74,47,34,.35)}
.card img{width:100%;aspect-ratio:1;object-fit:contain;background:#fff}
.card span{padding:8px 10px 0;font-size:15px;font-weight:600;line-height:1.4}
.card b{padding:2px 10px 10px;font-size:15px;color:#8a6a33}
.prose{max-width:780px}.prose p{margin:0 0 14px}
.prose ul{padding-inline-start:22px}.prose li{margin:4px 0}
.faq details{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:12px 16px;margin:8px 0;max-width:820px}
.faq summary{font-weight:700;cursor:pointer}
.band{margin:34px 0 0;background:linear-gradient(135deg,#4a2f22,#6b4733);color:#fdf3e4;border-radius:22px;padding:26px;text-align:center}
.band h2{margin:0 0 8px;color:#fdf3e4}.band p{margin:0 0 14px;color:#f1dfc4}
.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.links a{font-size:15px;text-decoration:none;border:1px solid var(--gl);border-radius:99px;padding:5px 13px;background:var(--paper)}
.links a:hover{border-color:var(--gold)}
footer{border-top:1px solid var(--gl);margin-top:30px;padding:24px 18px 90px;text-align:center;font-size:15px;color:var(--soft)}
footer b{font-family:'Frank Ruhl Libre',serif;font-size:20px;color:var(--cocoa)}
footer a{text-decoration:none;font-weight:600;display:inline-block;padding:6px 2px}
.wa{position:fixed;right:18px;bottom:18px;z-index:20;background:#15803d;color:#fff;text-decoration:none;font-weight:700;border-radius:99px;padding:11px 18px;box-shadow:0 8px 20px -6px rgba(0,0,0,.35)}
.tbl{border-collapse:collapse;width:100%;max-width:820px;background:var(--paper);border-radius:14px;overflow:hidden}.tbl th,.tbl td{border:1px solid var(--line);padding:8px 12px;text-align:start}.tbl th{background:#f1e4d0}
dl dt{font-weight:700;margin-top:14px}dl dd{margin:2px 0 0}
.skip{position:absolute;inset-inline-start:-999px}.skip:focus{inset-inline-start:12px;top:12px;z-index:99;background:#fff;padding:8px 12px;border-radius:8px}
.tool{background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:22px;max-width:820px}
.tool label{display:block;font-weight:700;margin:12px 0 4px}.tool input,.tool select{font:inherit;padding:9px 12px;border:1px solid var(--gl);border-radius:12px;width:100%;max-width:320px;background:#fff}
.tool .out{margin-top:18px;font-size:18px;background:#fff;border-radius:14px;padding:14px 16px;border:1px solid var(--gl)}
.opts{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.opts button{font:inherit;font-weight:600;border:1.5px solid var(--gl);background:#fff;border-radius:99px;padding:8px 16px;cursor:pointer;color:var(--cocoa)}.opts button.on{border-color:var(--gold);background:#f6ead3}
.grp{margin:18px 0}.grp h3{margin-bottom:4px}
:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
@media (max-width:760px){.hero{grid-template-columns:1fr;padding:16px}.top .btn{padding:8px 14px;font-size:14px}.logo span{display:none}}
"""
WA = "https://wa.me/972543219070?text=" + "%D7%94%D7%99%D7%99%2C%20%D7%94%D7%92%D7%A2%D7%AA%D7%99%20%D7%9E%D7%94%D7%90%D7%AA%D7%A8%20%D7%95%D7%90%D7%A9%D7%9E%D7%97%20%D7%9C%D7%A4%D7%A8%D7%98%D7%99%D7%9D%20%D7%A2%D7%9C%20%D7%9E%D7%90%D7%A8%D7%96%D7%99%20%D7%A9%D7%99"
BIZ = {"@type": "LocalBusiness", "@id": SITE + "/#business", "name": "נויה במתנה", "url": SITE + "/", "telephone": "+972-54-321-9070",
       "address": {"@type": "PostalAddress", "streetAddress": "הענבר 1", "addressLocality": "ברקן", "addressCountry": "IL"}}
e = lambda t: html.escape(str(t), quote=True)
def ils(x):
    return ("₪%.2f" % x).rstrip("0").rstrip(".") if x != int(x) else "₪%d" % x

def page(path, title, desc, body, ld, crumbs, img=None, lang="he", alt=None, nav=True):
    img = img or OG.get(path) or SITE + "/img/og-magic.jpg"
    alts = "".join(f'<link rel="alternate" hreflang="{k}" href="{SITE}{v}">' for k, v in (alt or {}).items())
    url = SITE + path
    bl = {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + u} for i, (n, u) in enumerate(crumbs)]}
    graph = {"@context": "https://schema.org", "@graph": [BIZ, bl] + ld}
    cr = " › ".join(f'<a href="{u}">{e(n)}</a>' if i < len(crumbs) - 1 else e(n) for i, (n, u) in enumerate(crumbs))
    doc = f"""<!doctype html>
<html lang="{lang}" dir="{"rtl" if lang=="he" else "ltr"}"><head>{TRACK}<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title><meta name="description" content="{e(desc)}"><link rel="canonical" href="{url}">{alts}
<meta property="og:type" content="website"><meta property="og:locale" content="{"he_IL" if lang=="he" else "en_US"}"><meta property="og:site_name" content="נויה במתנה">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}"><meta property="og:url" content="{url}"><meta property="og:image" content="{img}">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#fffaf3">
<link rel="icon" type="image/png" href="/img/icon-64.png?v=2"><link rel="apple-touch-icon" href="/img/icon-180.png?v=2">
{FONT}<style>{CSS}</style>
<script type="application/ld+json">{json.dumps(graph, ensure_ascii=False)}</script></head><body>
<a class="skip" href="#main">דילוג לתוכן</a>
<header class="top"><div class="top-in"><a class="logo" href="/"><img src="/img/icon-180.png?v=2" alt="נויה במתנה" width="36" height="36"><span>נויה במתנה</span></a><a class="btn sm" href="/">לבונה המארזים ←</a></div></header>
<main id="main"><nav class="crumbs" aria-label="פירורי לחם">{cr}</nav>
{body}
<section class="band"><h2>בונים מארז – ורואים אותו תוך חצי דקה</h2><p>בוחרים מוצרים ואריזה, רואים את המארז מעוצב ומקבלים הצעת מחיר מיד. מיתוג עם לוגו ומשלוח אישי לכל נמען.</p><a class="btn" href="/">לבונה המארזים ←</a></section>
{NAV_LINKS if nav else ""}
</main>
<footer><b>נויה במתנה</b><br>מארזי שי ומתנות לעובדים, ללקוחות ולשותפים עסקיים<br>
<a href="tel:0543219070">054-3219070</a> · <a href="tel:0537784388">053-7784388</a> · <a href="tel:0533460081">053-3460081</a><br>
<a href="mailto:moshe@noyaglobal.com">moshe@noyaglobal.com</a> · <a href="https://www.noyaglobal.com">NOYAGLOBAL.COM</a><br>הענבר 1, ברקן · איסוף עצמי או משלוח · המחירים לפני מע״מ · מינימום הזמנה ₪3,000</footer>
<a class="wa" href="{WA}" target="_blank" rel="noopener">שאלה? וואטסאפ</a>
</body></html>"""
    d = os.path.join(ROOT, path.strip("/"))
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(doc)
    URLS.append(path)

def ptitle(name, cat, lim=65):
    B = " | נויה במתנה"
    for t in (f"{name} | {cat} למארזי שי – נויה במתנה", f"{name} | {cat} – נויה במתנה", name + B):
        if len(t) <= lim: return t
    head, sep, tail = name.partition(" – ")
    keep = sep + tail if tail and len(tail) <= 18 and len(head) >= 20 else ""
    src = head if keep or len(head) >= 25 else name
    room = lim - len(B) - len(keep)
    out = ""
    for w in src.split():
        if len((out + " " + w).strip()) > room: break
        out = (out + " " + w).strip()
    return out.rstrip(",–- ") + keep + B

def pdesc(name, d, price, lim=160):
    base = f"{ils(price)} ליחידה לפני מע״מ. מיתוג עם לוגו ומשלוח לכל נמען."
    d = (d or "").strip().rstrip(".")
    first = re.split(r"(?<=[.!?])\s", d)[0].rstrip(".") if d else ""
    for t in ((f"{name} – {d}. {base}" if d else ""), (f"{name}. {first}. {base}" if first else ""), (f"{first}. {base}" if first else ""), f"{name}. {base}"):
        if t and len(t) <= lim: return t
    room = lim - len(base) - 3
    cut = (first or name)[:room].rsplit(" ", 1)[0].rstrip(",–- ")
    return f"{cut}… {base}"

def card(p):
    return f'<a class="card" href="/p/{p["id"]}/"><img src="/{p["photo"] or p["img"]}" alt="{e(p["name"])}" loading="lazy" width="360" height="360"><span>{e(p["name"])}</span><b>{ils(p["price"])} <small>לפני מע״מ</small></b></a>'

def faq_html(faqs):
    return '<section class="faq"><h2>שאלות נפוצות</h2>' + "".join(f"<details><summary>{e(q)}</summary><p>{a}</p></details>" for q, a in faqs) + "</section>"
def faq_ld(faqs):
    strip = lambda s: re.sub("<[^>]+>", "", s)
    return {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": strip(a)}} for q, a in faqs]}

COMMON_FAQ = [
 ("מה מינימום ההזמנה?", "מינימום ההזמנה הוא ₪3,000 לפני מע״מ להזמנה כולה – לא לכל מארז."),
 ("אפשר לשלוח מארז לכל עובד הביתה?", "כן. שולחים לנו רשימת כתובות באקסל, ואנחנו שולחים כל מארז בנפרד עד הבית או המשרד – ₪65 למארז, או ₪99 בשליח VIP צמוד להנהלה בכירה. אפשר גם איסוף עצמי מברקן."),
 ("אפשר להוסיף לוגו של החברה?", "כן. אפשר למתג את המארז, הכרטיס והאריזה עם הלוגו שלכם ולהוסיף ברכה אישית."),
 ("איך מקבלים הצעת מחיר?", 'בונים מארז ב<a href="/">בונה המארזים</a>, רואים אותו מעוצב, ומורידים הצעת מחיר מסודרת בלחיצה – או שולחים לנו בוואטסאפ.'),
]

# Phrasing variants of the common FAQ, so the same four answers are not copied word for word across dozens of pages.
FAQ_VAR = [
 [COMMON_FAQ[0],
  ("יש מינימום הזמנה?", "כן – ₪3,000 לפני מע״מ לכל ההזמנה יחד. אפשר לשלב בה כמה סוגי מארזים, למשל מארז לעובדים ומארז משודרג להנהלה."),
  ("מה ההזמנה המינימלית?", "ההזמנה המינימלית היא ₪3,000 לפני מע״מ, והיא נספרת על ההזמנה כולה ולא על כל מארז בנפרד.")],
 [COMMON_FAQ[1],
  ("אתם שולחים לכל נמען בנפרד?", "כן. מספיק קובץ אקסל עם שם, טלפון וכתובת לכל נמען. משלוח אישי עולה ₪65 למארז, שליח VIP צמוד ₪99, ואפשר גם לאסוף בעצמכם מהענבר 1, ברקן."),
  ("איך עובד משלוח לבתי העובדים?", "שולחים לנו קובץ אקסל של כתובות, ואנחנו מוציאים כל מארז לכתובת שלו: ₪65 למארז במשלוח אישי, או ₪99 בשליח VIP צמוד. איסוף עצמי אפשרי מברקן.")],
 [COMMON_FAQ[2],
  ("אפשר למתג את המארז?", "כן. הלוגו שלכם יכול להופיע על כרטיס הברכה, על התגית ועל האריזה, ובחלק מהמוצרים גם בחריטה."),
  ("איך מוסיפים את הלוגו שלנו?", "מעלים את הלוגו בבונה ורואים איך הוא נראה על המארז. אפשר למתג כרטיס, תגית ואריזה, ובחלק מהמוצרים גם לחרוט.")],
 [COMMON_FAQ[3],
  ("כמה זמן לוקח לקבל הצעת מחיר?", 'אפשר לקבל אותה מיד: בונים מארז ב<a href="/">בונה המארזים</a> ומורידים הצעת מחיר מסודרת. אם נוח לכם יותר, שלחו לנו הודעה בוואטסאפ.'),
  ("איך מזמינים?", 'בוחרים מוצרים ואריזה ב<a href="/">בונה המארזים</a>, מורידים הצעת מחיר ושולחים לנו אותה בוואטסאפ או במייל moshe@noyaglobal.com.')],
]
import zlib
def common_faq(key):
    h = zlib.crc32(key.encode())
    return [v[(h >> (i * 3)) % len(v)] for i, v in enumerate(FAQ_VAR)]

# ---------- holiday / audience landing pages ----------
LAND = [
 dict(slug="matanot-laovdim", nav="מתנות לעובדים", title="מתנות לעובדים – מארזי שי בהתאמה אישית | נויה במתנה",
  h1="מתנות לעובדים שבאמת שמחים לקבל",
  desc="מארזי שי לעובדים בהתאמה אישית: בוחרים מוצרים, רואים את המארז מיד ומקבלים הצעת מחיר. מיתוג עם לוגו ומשלוח אישי לכל עובד. מעל 600 חברות כבר בחרו בנו.",
  lead="מתנה לעובד היא הדרך הכי פשוטה להגיד תודה – ואם היא מושקעת, יפה ושימושית, רואים אותה בבית עוד הרבה חודשים. בנויה במתנה מעצבים מארזי שי לעובדים בהתאמה מלאה לארגון שלכם.",
  cats=["diffuser", "holder", "candle", "textile", "serve", "kitchen"],
  body="""<p>כל ארגון שונה – וגם המתנה צריכה להיות. בבונה המארזים שלנו בוחרים בעצמכם את המוצרים: מפיצי ריח, פמוטים, נרות, מפות שולחן, מגשי הגשה ומתנות למטבח. המארז מתעדכן מול העיניים, המחיר מתעדכן בזמן אמת, ובלחיצה אחת רואים איך המארז ייראה כשהוא ארוז.</p>
<h3>למה ארגונים בוחרים בנויה במתנה</h3>
<ul><li><b>התאמה אישית מלאה</b> – כל מארז נבנה לפי התקציב, אופי הארגון והעובדים.</li>
<li><b>מיתוג עם לוגו</b> – על הכרטיס, האריזה או המוצר עצמו.</li>
<li><b>משלוח אישי לכל עובד</b> – לפי רשימת כתובות באקסל, עד הבית או המשרד.</li>
<li><b>יבוא ישיר</b> – איכות גבוהה במחירים תחרותיים.</li>
<li><b>ניסיון</b> – מאז 2024 שלחנו מעל 48,000 מארזים ליותר מ-600 חברות וארגונים.</li></ul>
<h3>כמה עולה מתנה לעובד?</h3>
<p>רוב הארגונים בוחרים מארז בטווח של ₪80–₪200 לפני מע״מ לעובד, ומארזי VIP להנהלה גבוהים יותר. בבונה אפשר להגדיר תקציב למארז – והוא יראה לכם מה נכנס בו. לקריאה נוספת: <a href="/guides/kama-lehotzi-al-matana-laoved/">כמה להוציא על מתנה לעובד</a>.</p>"""),
 dict(slug="rosh-hashana", nav="מארזי ראש השנה", title="מארזי ראש השנה לעובדים ולארגונים | נויה במתנה",
  h1="מארזי ראש השנה לעובדים, ללקוחות ולשותפים",
  desc="מארזי שי לראש השנה בהתאמה אישית לארגונים: פמוטים, נרות, מפיצי ריח, מגשי הגשה ומפות שולחן לחג. מיתוג עם לוגו ומשלוח לכל עובד. בונים ורואים את המארז מיד.",
  lead="ראש השנה הוא רגע השיא של מתנות החג בארגונים. מארז מושקע לשולחן החג – פמוטים, נרות, מגש הגשה או מפה חגיגית – מגיע לבית של כל עובד ומתחיל את השנה ברגל ימין.",
  cats=["holder", "serve", "textile", "candle", "diffuser", "kitchen"],
  body="""<p>מארזי ראש השנה שלנו בנויים סביב שולחן החג: מגשי הגשה וקערות לתפוח בדבש, פמוטים ונרות לערב החג, מפות שולחן אלגנטיות ומפיצי ריח שממלאים את הבית. כל מארז נבנה בדיוק לפי התקציב שלכם.</p>
<h3>מתי להזמין?</h3>
<p>מארזי ראש השנה הם העונה העמוסה ביותר בשנה. מומלץ לסגור הזמנה 4–6 שבועות לפני החג, במיוחד כשצריך מיתוג ומשלוח אישי לכל עובד – כך מבטיחים מלאי, אריזה ומשלוח בזמן.</p>
<h3>רעיונות למארז ראש השנה</h3>
<ul><li>מגש הגשה מעץ או קרמיקה + זוג נרות ארוכים + ברכה ממותגת</li>
<li>זוג פמוטים קרמיים + נר ריחני + אריזת חלון</li>
<li>מפת שולחן אלגנטית לחג + מפיץ ריח – מארז VIP</li></ul>"""),
 dict(slug="pesach", nav="מארזי פסח", title="מארזי פסח לעובדים ולארגונים | נויה במתנה",
  h1="מארזי פסח לעובדים ולארגונים",
  desc="מארזי שי לפסח לארגונים: מפות שולחן לליל הסדר, מגשי הגשה, פמוטים ומתנות לבית. מיתוג עם לוגו ומשלוח אישי לכל עובד. בונים מארז ורואים אותו מיד.",
  lead="פסח הוא חג של שולחן גדול ומשפחה – ולכן מארז שמתאים לבית ולשולחן הסדר הוא מתנה שכל עובד משתמש בה כבר בחג עצמו.",
  cats=["textile", "serve", "holder", "kitchen", "candle", "decor"],
  faq=[("מתי ערב פסח 2027?", "ערב פסח וליל הסדר חלים ביום רביעי, 21 באפריל 2027. כדאי שהמארזים יגיעו לעובדים כמה ימים לפני כן, כדי שיספיקו להשתמש בהם בשולחן החג."),
       ("כמה זמן מראש להזמין מארזי פסח?", "מומלץ לסגור הזמנה 4–6 שבועות לפני החג – בערך מאמצע פברואר ועד אמצע מרץ 2027. פסח הוא אחת העונות העמוסות בשנה, והזמנה מוקדמת משאירה זמן למיתוג ולאיסוף כתובות."),
       ("מה נכנס למארז פסח לשולחן הסדר?", "מוצרים שמשתמשים בהם בליל הסדר עצמו: מפת שולחן גדולה, מגשים וקערות הגשה, פמוטים ונרות, ואביזרי מטבח כמו סט לשמן זית או קרש חיתוך מעץ. את השילוב בוחרים בבונה לפי התקציב."),
       ("אפשר לשלוח מארזים ללקוחות ולעובדים באותה הזמנה?", "כן. אפשר לבנות בהזמנה אחת מארז לעובדים ומארז מכובד יותר ללקוחות או להנהלה, ולשלוח כל אחד לכתובת שלו. המינימום (₪3,000 לפני מע״מ) נספר על ההזמנה כולה.")],
  body="""<p>מארזי הפסח שלנו מתמקדים במה שבאמת נכנס לשימוש בחג: מפות שולחן גדולות במיוחד, מגשים וקערות הגשה, פמוטים ונרות, ואביזרי מטבח איכותיים. הכול נבחר בבונה, מתומחר מיד ונשלח לכל עובד.</p>
<h3>מתנה שפוגשים בליל הסדר</h3>
<p>בפסח הבית מתמלא באורחים, והשולחן הוא מרכז החג. מפה חגיגית, מגש הגשה או זוג פמוטים שמגיעים לפני החג נכנסים לשימוש כבר בערב הסדר – ומזכירים את הארגון גם בחגים הבאים. כך מתנה אחת עובדת הרבה יותר מסל מוצרי מזון. וכשהמארז נבנה סביב השולחן, קל להתאים אותו לכל תקציב: מתחילים ממוצר מרכזי אחד ומוסיפים לו פריט או שניים משלימים.</p>
<h3>רעיונות למארז פסח</h3>
<ul><li><b>מארז לשולחן הסדר</b> – מפת שולחן גדולה, מגש הגשה וזוג נרות.</li>
<li><b>מארז למטבח</b> – סט לשמן זית וחומץ, קרש חיתוך מעץ שיטה וקערת הגשה.</li>
<li><b>מארז ללקוחות ולשותפים</b> – פמוטים או מפיץ ריח יוקרתי עם כרטיס ממותג, ומשלוח בשליח VIP צמוד.</li></ul>
<h3>מארז אחיד או מארז מדורג</h3>
<p>רוב הארגונים בוחרים מארז אחיד לכל העובדים, כי הוא הוגן ופשוט לניהול. אפשר להוסיף לו מארז משודרג להנהלה, לעובדים ותיקים או ללקוחות מרכזיים, בלי להגדיל את כל התקציב. בכל אחד מהמארזים אפשר למתג את כרטיס הברכה, התגית והאריזה עם הלוגו שלכם, ובחלק מהמוצרים גם לחרוט. ברכת חג קצרה וחמה על הכרטיס היא מה שהופך מארז יפה למתנה אישית, גם כשהיא נשלחת למאות עובדים.</p>
<p>בבונה מגדירים תקציב למארז ורואים מיד מה נכנס בו. לרעיונות לפי תקציב: <a href="/gifts/ad-150/">מארזים עד ₪150</a> ו<a href="/gifts/ad-200/">מארזים עד ₪200</a>. לתכנון התקציב לכל הארגון יש גם <a href="/kelim/machshevon-takziv/">מחשבון תקציב מתנות</a>.</p>
<h3>טיפ להזמנת מארזי פסח</h3>
<p>ערב פסח 2027 חל ב-21 באפריל. כדאי לסגור את ההזמנה 4–6 שבועות לפני החג. כך יש זמן למיתוג, לקבלת רשימת הכתובות מכל המחלקות ולמשלוח מסודר לפני ליל הסדר. שולחים לנו קובץ אקסל של כתובות, ואנחנו שולחים כל מארז בנפרד (₪65 למארז, או ₪99 בשליח VIP צמוד), או שאוספים בעצמכם מהענבר 1, ברקן. המחירים לפני מע״מ, ומינימום ההזמנה הוא ₪3,000 לכל ההזמנה. פירוט נוסף ב<a href="/guides/ad-matai-lehazmin/">לוח הזמנים להזמנת מארזים לחגים</a>.</p>
<h3>לקריאה נוספת בבלוג</h3>
<ul><li><a href="https://www.noyaglobal.com/post/pesach-gifts-seder-table">מתנות לעובדים לפסח: מה באמת משתמשים בו בליל הסדר</a></li>
<li><a href="https://www.noyaglobal.com/post/pesach-gift-boxes-budget">מארזי פסח לעובדים: כמה להוציא ומה נכנס בכל תקציב</a></li>
<li><a href="https://www.noyaglobal.com/post/pesach-gifts-clients-partners">מתנות פסח ללקוחות ולשותפים עסקיים: איך בוחרים מתנה מכובדת</a></li></ul>"""),
 dict(slug="chanukah", nav="מתנות לחנוכה", title="מתנות לחנוכה 2026 לעובדים ולקוחות – מארזי שי | נויה במתנה",
  h1="מתנות לחנוכה לעובדים וללקוחות",
  desc="מארזי שי לחנוכה 2026 (4–12 בדצמבר): נרות ריחניים, פמוטים ומפיצי ריח. מארזים בהתאמה אישית לארגונים, מיתוג עם לוגו ומשלוח לכל נמען.",
  lead="חנוכה הוא חג האור – וזו הזדמנות מושלמת למתנה חמה: נרות ריחניים, פמוטים ומפיצי ריח שמאירים את הבית בערבי החורף.",
  cats=["candle", "holder", "diffuser", "decor", "serve", "gift"],
  faq=[("מתי חל חנוכה 2026?", "חנוכה 2026 חל בין 4 ל-12 בדצמבר 2026. את הנר הראשון מדליקים ביום שישי בערב, 4 בדצמבר. רוב הארגונים מחלקים את המארזים בשבוע שלפני החג או בימים הראשונים שלו."),
       ("עד מתי אפשר להזמין מארזי חנוכה?", "מומלץ לסגור הזמנה 2–3 שבועות לפני החג, כדי שיהיה זמן למיתוג, לאיסוף כתובות ולמשלוח. אם החג כבר קרוב – כתבו לנו בוואטסאפ ונבדוק יחד מה אפשר להספיק."),
       ("מה מתאים לשים במארז חנוכה לעובדים?", "מוצרים שקשורים לאור ולחורף: נרות סויה ריחניים, פמוטים מקרמיקה, זכוכית או זהב, מפיצי ריח ופריטי עיצוב לבית. אפשר לבנות מארז סמלי עם נר ופמוט, או מארז מושקע עם מפיץ ריח ומגש הגשה."),
       ("אפשר לשלב את מארזי חנוכה עם מתנות לסוף השנה?", "כן. ארגונים רבים סוגרים בהזמנה אחת גם מארזי חנוכה לעובדים וגם מתנות לסוף השנה ללקוחות ולשותפים. מינימום ההזמנה (₪3,000 לפני מע״מ) נספר על ההזמנה כולה.")],
  body="""<p>מארזי חנוכה הם הזדמנות לפנק עובדים ולקוחות באמצע החורף, לקראת סוף השנה האזרחית. נרות סויה ריחניים, פמוטי זכוכית וזהב ומפיצי ריח יוצרים מארז חם ומרגש – בכל תקציב.</p>
<h3>למה נרות ופמוטים הם המתנה הנכונה לחנוכה</h3>
<p>חנוכה הוא חג של אור, ומתנה שמדליקים בבית בערבי החג מתחברת אליו באופן טבעי. נר ריחני או זוג פמוטים לא נשארים בארון: הם עומדים על השולחן, נדלקים שוב ושוב, ומזכירים לעובד מי חשב עליו גם הרבה אחרי שהחג נגמר. מפיץ ריח ממשיך את אותה תחושה של בית חם, ומתאים במיוחד לעובדים שעובדים מהבית בחורף.</p>
<h3>רעיונות למארז חנוכה לפי תקציב</h3>
<ul><li><b>מארז סמלי לכל העובדים</b> – נר סויה ריחני או מארז נרות טי-לייט, יחד עם פמוט קטן וכרטיס ברכה ממותג.</li>
<li><b>מארז בית חם</b> – זוג פמוטים קרמיים גבוה ונמוך, נרות ארוכים ריחניים ומפיץ ריח.</li>
<li><b>מארז להנהלה וללקוחות</b> – נר גדול בכלי קרמי, מפיץ ריח מעוצב ומגש הגשה, באריזת מתנה יוקרתית.</li></ul>
<p>עוד הרבה רעיונות מסודרים לפי מחיר ב<a href="/guides/30-raayonot-matanot-chanukah-laovdim/">30 רעיונות למתנות חנוכה לעובדים</a>, ובדפי <a href="/gifts/ad-50/">מארזים עד ₪50</a> ו<a href="/gifts/ad-100/">מארזים עד ₪100</a>.</p>
<h3>מיתוג ומשלוח</h3>
<p>אפשר להוסיף את הלוגו שלכם על כרטיס הברכה, על התגית ועל האריזה, ובחלק מהמוצרים גם בחריטה. שולחים לנו קובץ אקסל עם כתובות, ואנחנו שולחים כל מארז בנפרד עד הבית או המשרד (₪65 למארז, או ₪99 בשליח VIP צמוד להנהלה), או שאוספים בעצמכם מהענבר 1, ברקן. המחירים לפני מע״מ, ומינימום ההזמנה הוא ₪3,000 לכל ההזמנה.</p>
<p>רבים מהלקוחות שלנו משלבים את מארז חנוכה עם <a href="/gifts/sof-shana/">מתנה לסוף השנה</a> ללקוחות ולשותפים עסקיים. לוח הזמנים המלא לכל החגים נמצא ב<a href="/guides/ad-matai-lehazmin/">עד מתי להזמין מארזים לחג</a>.</p>"""),
 dict(slug="tu-bishvat", nav="מארזי ט״ו בשבט", title="מארזי ט״ו בשבט לעובדים | נויה במתנה",
  h1="מארזי ט״ו בשבט לעובדים",
  desc="מארזי שי לט״ו בשבט לארגונים: עציצים, פריטי עיצוב ירוקים, מגשי עץ ומתנות לבית. מארזים בהתאמה אישית עם מיתוג ומשלוח לכל עובד.",
  lead="ט״ו בשבט הוא חג הטבע והצמיחה – הזדמנות מצוינת למתנה ירוקה, טבעית ומחברת, שמזכירה לעובדים שהארגון צומח איתם.",
  cats=["decor", "serve", "kitchen", "candle", "textile", "holder"],
  faq=[("מתי חל ט״ו בשבט 2027?", "ט״ו בשבט חל ביום שישי, 22 בינואר 2027. מכיוון שהחג נופל בסוף שבוע, רוב הארגונים מחלקים את המארזים כבר בימים שלפניו."),
       ("כמה זמן מראש כדאי להזמין מארזי ט״ו בשבט?", "מומלץ לסגור הזמנה 3–4 שבועות לפני החג, כלומר עד סוף דצמבר או תחילת ינואר. כך נשאר זמן לאסוף כתובות, להכין מיתוג ולשלוח לפני 22 בינואר."),
       ("מה מתאים למארז ט״ו בשבט במקום סלסלת פירות יבשים?", "מוצר שנשאר אחרי החג: עציץ או פריט עיצוב ירוק, מגש עץ או מעמד צנצנות להגשת פירות יבשים, קערות במבוק וכלים טבעיים. אפשר לצרף אליהם ברכה ממותגת."),
       ("אפשר לשלב את מארז ט״ו בשבט עם מתנה לסוף השנה?", "כן. יש ארגונים שסוגרים בהזמנה אחת גם מארזים לסוף השנה וגם מארזי ט״ו בשבט – מינימום ההזמנה (₪3,000 לפני מע״מ) נספר על ההזמנה כולה.")],
  body="""<p>למארז ט״ו בשבט מתאימים במיוחד עציצים ופריטי עיצוב, מגשי הגשה מעץ לפירות יבשים, קערות במבוק וכלים טבעיים. אפשר לבנות מארז קטן וסמלי לכל העובדים, או מארז מושקע יותר להנהלה.</p>
<h3>מתנה ירוקה שנשארת אחרי החג</h3>
<p>סלסלת פירות יבשים נגמרת תוך יום-יומיים. מארז שבנוי סביב מוצר לבית – עציץ, מגש עץ, מעמד צנצנות או קערת הגשה – נשאר על השולחן או על אדן החלון עוד חודשים, ומזכיר לעובד מי חשב עליו. את הפירות היבשים אפשר להגיש בתוכו כבר בחג עצמו.</p>
<h3>רעיונות למארז ט״ו בשבט</h3>
<ul><li><b>מארז סמלי לכל העובדים</b> – עציץ קטן או פריט עיצוב ירוק עם כרטיס ברכה ממותג.</li>
<li><b>מארז לשולחן החג</b> – מגש עץ או מעמד עם צנצנות זכוכית לפירות יבשים, בתוספת נר.</li>
<li><b>מארז להנהלה</b> – שילוב של כלי הגשה מעץ, פריט עיצוב ומפת שולחן או מגבות.</li></ul>
<h3>מיתוג שמחבר את המתנה לארגון</h3>
<p>מתנה ירוקה היא הזדמנות להעביר מסר של צמיחה משותפת. אפשר להוסיף את הלוגו שלכם על כרטיס הברכה, על התגית ועל האריזה, ובחלק מהמוצרים גם בחריטה. ברכה קצרה כמו "צומחים יחד" או "תודה שאתם חלק מהצוות" הופכת מארז פשוט למחווה אישית. כשהמארז נשלח לבית של העובד, הכרטיס הוא מה שמזכיר מי שלח אותו, ולכן כדאי להשקיע בו.</p>
<p>אם יש לכם עובדים בכמה סניפים או בעבודה היברידית, אפשר לשלב: משלוח מרוכז לסניף אחד ומשלוח אישי הביתה לעובדים אחרים, באותה הזמנה.</p>
<p>בבונה המארזים מגדירים תקציב, בוחרים מוצרים ואריזה ורואים את המחיר מתעדכן בזמן אמת. לרעיונות לפי תקציב: <a href="/gifts/ad-100/">מארזים עד ₪100</a> ו<a href="/gifts/ad-150/">מארזים עד ₪150</a>.</p>
<h3>לוח זמנים ומשלוח</h3>
<p>ט״ו בשבט 2027 חל ביום שישי, 22 בינואר. מומלץ לסגור את ההזמנה 3–4 שבועות מראש, כדי שיהיה זמן לאסוף כתובות מכל המחלקות ולהכין מיתוג. שולחים לנו קובץ אקסל של כתובות, ואנחנו שולחים כל מארז בנפרד (₪65 למארז, או ₪99 בשליח VIP צמוד). אפשר גם איסוף עצמי מהענבר 1, ברקן. המחירים לפני מע״מ, ומינימום ההזמנה הוא ₪3,000 לכל ההזמנה. פירוט נוסף ב<a href="/guides/ad-matai-lehazmin/">לוח הזמנים להזמנת מארזים לחגים</a> וב<a href="/guides/mishloach-matanot-laovdim-habayta/">מדריך המשלוח לכל עובד</a>.</p>
<h3>לקריאה נוספת בבלוג</h3>
<ul><li><a href="https://www.noyaglobal.com/post/tu-bishvat-gifts-ideas">מארזי ט״ו בשבט לעובדים: 12 רעיונות לפי תקציב</a></li>
<li><a href="https://www.noyaglobal.com/post/green-gift-tu-bishvat-employees">מתנה ירוקה לעובדים: מה נותנים בט״ו בשבט במקום עוד סלסלת פירות יבשים</a></li>
<li><a href="https://www.noyaglobal.com/post/tu-bishvat-order-deadline-delivery">עד מתי להזמין מארזי ט״ו בשבט, ואיך שולחים לכל עובד הביתה</a></li></ul>"""),
 dict(slug="purim", nav="משלוחי מנות לעובדים", title="משלוחי מנות לעובדים בפורים – מארזים לארגונים | נויה במתנה",
  h1="משלוחי מנות ומארזי פורים לעובדים",
  desc="משלוחי מנות ומארזי פורים לארגונים: מארז מעוצב בהתאמה אישית לכל עובד, מיתוג עם לוגו ומשלוח עד הבית. בונים מארז ורואים אותו מיד.",
  lead="בפורים נהוג לשלוח משלוח מנות – ובארגון זו דרך שמחה ולא מחייבת לחזק את הקשר עם העובדים. מארז מעוצב ושימושי עדיף על עוד סל ממתקים שנשכח אחרי יום.",
  cats=["serve", "kitchen", "candle", "decor", "drink", "gift"],
  body="""<p>אנחנו בונים משלוחי מנות לארגונים סביב מוצר שנשאר: מגש הגשה, קערה, סט למטבח או נר ריחני – ואליהם אפשר להוסיף ברכה ממותגת. כל מארז נשלח לכל עובד בנפרד או מגיע מרוכז למשרד.</p>"""),
 dict(slug="sof-shana", nav="מתנות לסוף השנה", title="מתנות לסוף השנה 2026 ללקוחות ולשותפים עסקיים | נויה במתנה",
  faq=[("מתי כדאי לשלוח מתנות לסוף השנה ללקוחות?", "בשבועיים האחרונים של דצמבר, כך שהמתנה מגיעה לפני 31 בדצמבר. מומלץ לסגור הזמנה כ-3 שבועות מראש."),
       ("אפשר לשלוח לכל לקוח לכתובת אחרת?", "כן. שולחים לנו אקסל עם כל הכתובות, ואנחנו שולחים כל מארז בנפרד – ₪65 למארז, או ₪99 בשליח VIP צמוד."),
       ("אפשר לשלב מתנות לסוף השנה עם מארזי חנוכה?", "כן. אפשר לסגור הכול בהזמנה אחת, ומינימום ההזמנה (₪3,000 לפני מע״מ) נספר על ההזמנה כולה.")],
  h1="מתנות לסוף השנה ללקוחות ולשותפים עסקיים",
  desc="מארזי שי לסוף השנה ללקוחות, ספקים ושותפים עסקיים: מארזים יוקרתיים בהתאמה אישית, מיתוג עם לוגו ומשלוח אישי לכל נמען, כולל שליח VIP.",
  lead="סוף השנה הוא הזמן להגיד תודה ללקוחות ולשותפים שליוו אתכם. מארז מושקע וממותג נשאר על השולחן במשרד ומזכיר את העסק שלכם לאורך כל השנה הבאה.",
  cats=["diffuser", "serve", "kitchen", "holder", "drink", "candle"],
  body="""<p>למתנות עסקיות מתאימים במיוחד מפיצי ריח יוקרתיים, סטים למטבח ולאירוח וקרשי הגשה מעץ שיטה – פריטים שנראים מכובדים ומשמשים באמת. עם מיתוג נכון, המתנה הופכת לכרטיס ביקור שנשאר.</p>
<p>ללקוחות VIP ולהנהלה בכירה יש שליח VIP צמוד (₪99 למארז) שמגיע עם המארז עד היד.</p>
<h3>מתי לשלוח מתנה לסוף השנה</h3>
<p>השבועיים האחרונים של דצמבר הם הזמן המקובל. מתנה שמגיעה לפני 31 בדצמבר 2026 נכנסת לסיכום השנה של הלקוח, ומתנה שמגיעה בשבוע הראשון של ינואר יכולה לפתוח את השנה החדשה. כדי שהמשלוחים יגיעו בזמן, מומלץ לסגור הזמנה כ-3 שבועות מראש. הרבה עסקים סוגרים באותה הזמנה גם <a href="/gifts/chanukah/">מארזי חנוכה לעובדים</a>, כי שני המועדים קרובים.</p>
<h3>איך לבנות רשימת מקבלים</h3>
<ul><li><b>לקוחות מרכזיים</b> – מארז משודרג עם ברכה אישית בשם, ושליח VIP.</li>
<li><b>לקוחות וספקים נוספים</b> – מארז אחיד וממותג במשלוח אישי (₪65 למארז).</li>
<li><b>שותפים ונותני שירות</b> – רואה החשבון, עורך הדין, המשרד שמלווה אתכם – מתנה קטנה ומכובדת.</li></ul>
<p>שולחים לנו קובץ אקסל עם שם, טלפון וכתובת לכל מקבל, ואנחנו אורזים, ממתגים ושולחים כל מארז בנפרד. המחירים לפני מע״מ, ומינימום ההזמנה הוא ₪3,000 להזמנה כולה.</p>"""),
 dict(slug="maarazim-memutagim", nav="מארזים ממותגים עם לוגו", title="מארזי שי ממותגים עם לוגו לחברות | נויה במתנה",
  faq=[("איך מוסיפים לוגו למארז?", "מעלים את קובץ הלוגו בבונה המארזים. הלוגו נכנס לכרטיס הברכה, לתגית ולאריזה, ובחלק מהמוצרים אפשר גם חריטה."),
       ("באיזה פורמט לשלוח את הלוגו?", "PNG ברזולוציה טובה, PDF או SVG. אם יש רק קובץ באיכות נמוכה – שלחו אותו ונבדוק."),
       ("אפשר כרטיס עם שם אישי לכל מקבל?", "כן. אפשר ברכה אחידה עם לוגו, או כרטיס אישי עם שם המקבל לפי רשימה.")],
  h1="מארזי שי ממותגים עם הלוגו שלכם",
  desc="מארזי מתנה ממותגים לחברות: הלוגו שלכם על הכרטיס, האריזה או המוצר, ברכה אישית ומשלוח לכל נמען. בונים מארז, מעלים לוגו ורואים את התוצאה מיד.",
  lead="מארז ממותג הופך מתנה למסר: כל עובד, לקוח או שותף רואה מי חשב עליו. בבונה המארזים אפשר להעלות את הלוגו ולראות מיד איך הוא נראה על המארז.",
  cats=["diffuser", "holder", "serve", "kitchen", "textile", "candle"],
  body="""<h3>מה אפשר למתג?</h3>
<ul><li>כרטיס ברכה מעוצב עם הלוגו והברכה שלכם</li><li>תגית ואריזה ממותגת</li><li>חריטה על מוצרים נבחרים</li></ul>
<p>מעלים את הלוגו בבונה, בוחרים מוצרים ואריזה, ורואים את המארז הממותג עוד לפני שמזמינים.</p>
<h3>מיתוג שעובד: פחות זה יותר</h3>
<p>מארז ממותג טוב לא נראה כמו פרסומת. לוגו קטן ונקי על הכרטיס ועל התגית, וברכה קצרה וחמה, משדרים יותר מלוגו גדול על כל מוצר. על מוצרים מעץ, כמו קרשי הגשה, חריטה עדינה נראית אלגנטית ונשארת לשנים.</p>
<h3>מה צריך להכין</h3>
<ul><li>קובץ לוגו באיכות טובה (PNG, PDF או SVG).</li><li>נוסח ברכה קצר, ואם רוצים – שם המקבל על כל כרטיס.</li><li>רשימת כתובות באקסל, אם המארזים נשלחים לכל נמען בנפרד.</li></ul>
<p>מתאים במיוחד ל<a href="/gifts/matanot-lelakochot/">מתנות ללקוחות</a>, ל<a href="/gifts/sof-shana/">מתנות לסוף השנה</a> ול<a href="/gifts/matanot-laovdim/">מתנות לעובדים</a>.</p>"""),
]

# ---------- guides ----------
GUIDES = [
 dict(slug="kama-lehotzi-al-matana-laoved", nav="כמה להוציא על מתנה לעובד?", title="כמה להוציא על מתנה לעובד? מדריך תקציב למארזי שי | נויה במתנה",
  h1="כמה להוציא על מתנה לעובד? מדריך תקציב",
  desc="מדריך מעשי לתקציב מתנות לעובדים: טווחי מחיר מקובלים, מה נכנס בכל תקציב, עלויות משלוח ואיך לחלק תקציב בין עובדים, הנהלה ולקוחות.",
  body="""<p>אחת השאלות הראשונות שמנהלי משאבי אנוש ורכש שואלים אותנו היא כמה כדאי להוציא על מתנה לעובד. אין תשובה אחת – אבל יש כמה כללי אצבע שעוזרים להחליט מהר ונכון.</p>
<h2>טווחי תקציב מקובלים</h2>
<ul><li><b>עד ₪80 לעובד</b> – מארז קטן ומושקע: מוצר מרכזי אחד (נר ריחני, מגש או פמוט) עם אריזה וכרטיס.</li>
<li><b>₪80–₪150 לעובד</b> – הטווח הנפוץ ביותר: 2–4 מוצרים משתלבים, למשל פמוטים + נרות + מגש.</li>
<li><b>₪150–₪250 לעובד</b> – מארז פרימיום: מפיץ ריח יוקרתי, מפת שולחן או סט הגשה מלא.</li>
<li><b>מעל ₪250</b> – מארזי VIP להנהלה ולשותפים עסקיים.</li></ul>
<p>המחירים כאן לפני מע״מ. בבונה המארזים אפשר להגדיר תקציב למארז ולראות מיד מה נכנס בו.</p>
<h2>אל תשכחו את המשלוח</h2>
<p>אם המארזים נשלחים לכל עובד הביתה, צריך לתקצב גם משלוח: אצלנו ₪65 למארז במשלוח אישי, ו-₪99 בשליח VIP צמוד. משלוח מרוכז למשרד או איסוף עצמי זולים משמעותית.</p>
<h2>איך לחלק תקציב בארגון</h2>
<ul><li>מארז אחיד לכל העובדים – הוגן ופשוט לניהול.</li><li>מארז משודרג למנהלים ולוותיקים – בלי להגדיל את כל התקציב.</li><li>מארזים נפרדים ללקוחות ולשותפים – שם המיתוג חשוב במיוחד.</li></ul>
<h2>טיפ: עדיף פחות מוצרים, יותר איכות</h2>
<p>מארז עם 2–3 מוצרים איכותיים שמשמשים באמת זוכר יותר טוב ממארז עמוס בפריטים קטנים. העובדים זוכרים את המתנה שנשארה על השולחן בבית.</p>"""),
 dict(slug="rayonot-matanot-lechag-laovdim", nav="רעיונות למתנות לחג לעובדים", title="רעיונות למתנות לחג לעובדים – 12 רעיונות שעובדים | נויה במתנה",
  h1="רעיונות למתנות לחג לעובדים",
  desc="12 רעיונות למתנות לחג לעובדים שבאמת משתמשים בהן: מפיצי ריח, פמוטים, מגשי הגשה, מפות שולחן, סטים למטבח ועוד – עם טיפים להרכבת מארז.",
  body="""<p>מתנה טובה לעובד היא כזו שנכנסת לשימוש – על שולחן החג, במטבח או בסלון. הנה רעיונות שעובדים אצל מאות הארגונים שאנחנו מלווים:</p>
<ol><li><b>מפיץ ריח עם מקלות ראטן</b> – מתנה יוקרתית שמרגישים כל יום. <a href="/c/diffuser/">למפיצי הריח</a></li>
<li><b>זוג פמוטים קרמיים</b> – קלאסיקה לחג ולשבת. <a href="/c/holder/">לפמוטים</a></li>
<li><b>נר ריחני גדול</b> – חם, אישי ומתאים לכל אחד. <a href="/c/candle/">לנרות</a></li>
<li><b>מגש הגשה מעץ או קרמיקה</b> – כוכב שולחן החג. <a href="/c/serve/">לכלי ההגשה</a></li>
<li><b>מפת שולחן אלגנטית</b> – מושלמת לראש השנה ולפסח. <a href="/c/textile/">לטקסטיל</a></li>
<li><b>סט לשמן זית וחומץ</b> – מתנה שימושית למטבח. <a href="/c/kitchen/">למתנות למטבח</a></li>
<li><b>קרש חיתוך מעץ שיטה</b> – נראה מכובד ומחזיק שנים.</li>
<li><b>אגרטל או עציץ מעוצב</b> – נגיעה עיצובית לבית. <a href="/c/decor/">לאגרטלים ועציצים</a></li>
<li><b>סכין שף באריזת מתנה</b> – למי שאוהב לבשל.</li>
<li><b>מארז זוג נרות ארוכים</b> – תוספת זולה ויפה לכל מארז.</li>
<li><b>קערת סלט או מעמד צנצנות</b> – לאירוח.</li>
<li><b>מארז משולב</b> – 2–3 מהרעיונות האלה באריזה אחת, עם הלוגו שלכם.</li></ol>
<h2>איך מרכיבים מארז מנצח</h2>
<p>בוחרים מוצר מרכזי אחד (למשל מפיץ ריח או מגש), מוסיפים לו 1–2 מוצרים משלימים, ומסיימים באריזה יפה וכרטיס ברכה ממותג. בבונה המארזים רואים את המארז מוכן בלחיצה – לפני שמזמינים.</p>"""),
 dict(slug="mishloach-matanot-laovdim-habayta", nav="איך לשלוח מתנה לכל עובד הביתה", title="איך לשלוח מתנות לכל עובד הביתה – מדריך לוגיסטיקה | נויה במתנה",
  h1="איך לשלוח מתנה לכל עובד הביתה – בלי כאב ראש",
  desc="מדריך מעשי למשלוח מארזי שי לכל עובד בנפרד: איך מכינים רשימת כתובות, כמה זמן מראש להזמין, עלויות משלוח, שליח VIP ומה עושים עם עובדים שלא היו בבית.",
  body="""<p>יותר ויותר ארגונים שולחים את מתנות החג ישירות לבית של כל עובד – במיוחד כשיש עבודה היברידית, כמה סניפים או עובדים בשטח. הנה איך עושים את זה נכון.</p>
<h2>1. מכינים רשימת כתובות מסודרת</h2>
<p>הכי פשוט: קובץ אקסל עם שם מלא, טלפון נייד, עיר, רחוב ומספר בית, ודירה/קומה אם יש. יש לנו תבנית אקסל מוכנה – אפשר לבקש אותה בוואטסאפ. טלפון נכון הוא החלק החשוב ביותר: השליח מתאם לפיו.</p>
<h2>2. מזמינים בזמן</h2>
<p>לפני חגים גדולים כמו ראש השנה ופסח מומלץ לסגור הזמנה 4–6 שבועות מראש. כך יש זמן לאסוף כתובות מכל המחלקות, למתג ולשלוח לפני החג.</p>
<h2>3. בוחרים סוג משלוח</h2>
<ul><li><b>משלוח אישי לכל עובד</b> – ₪65 למארז, עד הבית או המשרד.</li>
<li><b>שליח VIP צמוד</b> – ₪99 למארז, להנהלה בכירה, ללקוחות חשובים ולשותפים.</li>
<li><b>משלוח מרוכז למשרד</b> – כשמחלקים בעצמכם.</li>
<li><b>איסוף עצמי</b> – מהענבר 1, ברקן.</li></ul>
<h2>4. ברכה אישית ומיתוג</h2>
<p>כשהמארז מגיע הביתה, הכרטיס הוא מה שמחבר אותו לארגון. כדאי להוסיף לוגו וברכה קצרה וחמה – ואפשר גם שם של כל עובד.</p>
<h2>5. מעקב</h2>
<p>אנחנו מעדכנים על סטטוס המשלוחים, ומטפלים במקרים של עובד שלא היה זמין או כתובת שגויה.</p>"""),
]

URLS = []
VIDEO = '<h2>כך בונים מארז – בדקה אחת</h2><video src="/media/noya-builder-wide.mp4" poster="/media/hero-bg.jpg" controls muted playsinline preload="none" style="width:100%;max-width:900px;border-radius:18px;background:#000" aria-label="סרטון: בונים מארז מתנה בבונה המארזים של נויה"></video>'
VIDEO_LD = {"@type": "VideoObject", "name": "בונה המארזים של נויה במתנה – בונים מארז מתנה בדקה", "description": "סרטון קצר: בוחרים מוצרים, בוחרים אריזה, חושפים את המארז ומשתפים עם הצוות בוואטסאפ.", "thumbnailUrl": SITE + "/media/hero-bg.jpg", "contentUrl": SITE + "/media/noya-builder-wide.mp4", "uploadDate": "2026-11-24", "inLanguage": "he"}
HOLI = LAND[1:]
LINKS = [("כל המארזים והמדריכים", "/gifts/"), ("מתנות לעובדים", "/gifts/matanot-laovdim/")] + [(l["nav"], f'/gifts/{l["slug"]}/') for l in KIND] + [(l["nav"], f'/gifts/{l["slug"]}/') for l in HOLI] + \
        [(f"מארזים עד ₪{b}", f"/gifts/ad-{b}/") for b in (50,100,150,200,250)] + \
        [("מחשבון תקציב מתנות", "/kelim/machshevon-takziv/"), ("איזה מארז מתאים לכם?", "/kelim/eize-maraz/"), ("מארזי השראה", "/gifts/galeria/"), ("עד מתי להזמין", "/guides/ad-matai-lehazmin/"), ("הסיפור שלנו", "/about/")]
NAV_LINKS = '<section><h2>עוד מארזים ורעיונות</h2><nav class="links">' + "".join(f'<a href="{u}">{e(n)}</a>' for n, u in LINKS) + "</nav></section>"
ALLG = GUIDES + GUIDES2
GROUPS = [("חגים", [(l["nav"], f'/gifts/{l["slug"]}/') for l in HOLI] + [("מתנות לעובדים", "/gifts/matanot-laovdim/")]),
          ("לפי תקציב", [(f"עד ₪{b}", f"/gifts/ad-{b}/") for b in (50,100,150,200,250)] + [(f"מארזים ל-{n} עובדים", f"/gifts/{n}-ovdim/") for n in SIZES]),
          ("סוגי מארזים", [(a["nav"], f'/gifts/{a["slug"]}/') for a in KIND]),
          ("למי המתנה", [(a["nav"], f'/gifts/{a["slug"]}/') for a in AUD]),
          ("לפי תחום", [(a["nav"], f'/gifts/{a["slug"]}/') for a in IND]),
          ("אירועים במהלך השנה", [(a["nav"], f'/gifts/{a["slug"]}/') for a in EVT]),
          ("מדריכים", [(g["nav"], f'/guides/{g["slug"]}/') for g in ALLG]),
          ("כלים", [("מחשבון תקציב מתנות", "/kelim/machshevon-takziv/"), ("איזה מארז מתאים לכם?", "/kelim/eize-maraz/"), ("מארזי השראה", "/gifts/galeria/")]),
          ("קטגוריות מוצרים", [(v, f"/c/{k}/") for k, v in CATS.items() if any(p["cat"] == k for p in P)]),
          ("עוד", [("הסיפור שלנו", "/about/"), ("English", "/en/")])]
OG = {}
TRACK = '''<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}(function(){var c=null;try{c=localStorage.getItem('noyaConsent')}catch(e){}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:c==='yes'?'granted':'denied'})})();gtag('js',new Date());</script><script async src="https://www.googletagmanager.com/gtm.js?id=GTM-W9WCSJ4X"></script><script defer src="/js/track.js?v=2"></script>'''
def picks(cats, n=12):
    out = []
    for c in cats:
        for p in sorted([p for p in P if p["cat"] == c], key=lambda p: -p.get("stock", 0))[:3]:
            out.append(p)
    return out[:n]

for d in ("p", "c", "gifts", "guides", "kelim", "en", "og"):
    shutil.rmtree(os.path.join(ROOT, d), ignore_errors=True)

# ---------- share images (OG) ----------
from PIL import Image, ImageDraw, ImageFont
FNT = "/usr/share/fonts/truetype/google-fonts/ofl/opensans/OpenSans[wdth,wght].ttf"
def _font(sz, bold=True):
    f = ImageFont.truetype(FNT, sz)
    try: f.set_variation_by_name(b"Bold" if bold else b"Regular")
    except Exception: pass
    return f
ICON = Image.open(os.path.join(ROOT, "img", "icon-180.png")).convert("RGBA").resize((120, 120))
def og_make(path, title, sub="נויה במתנה · מארזי שי לעובדים, ללקוחות ולשותפים"):
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), "#f7efe4"); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 14], fill="#b08a4f"); d.rectangle([0, H - 14, W, H], fill="#b08a4f")
    d.rounded_rectangle([40, 44, W - 40, H - 44], 36, fill="#fffaf3", outline="#e6d3b0", width=3)
    im.paste(ICON, (W - 200, 84), ICON)
    f = _font(62); words = title.split(); lines = []; cur = ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f, direction="rtl", language="he") > W - 300 and cur: lines.append(cur); cur = w
        else: cur = t
    lines.append(cur); lines = lines[:3]
    y = 270 - (len(lines) - 1) * 40
    for ln in lines:
        d.text((W - 110, y), ln, font=f, fill="#4a2f22", anchor="ra", direction="rtl", language="he"); y += 84
    d.text((W - 110, H - 140), sub, font=_font(30, False), fill="#7a5a48", anchor="ra", direction="rtl", language="he")
    d.text((110, H - 140), "build.noyaglobal.com", font=_font(28, False), fill="#b08a4f", anchor="la")
    slug = path.strip("/").replace("/", "-") or "home"
    os.makedirs(os.path.join(ROOT, "og"), exist_ok=True)
    im.save(os.path.join(ROOT, "og", slug + ".jpg"), quality=86, optimize=True, progressive=True)
    OG[path] = f"{SITE}/og/{slug}.jpg"
for l in LAND + KIND + AUD + IND + EVT: og_make(f'/gifts/{l["slug"]}/', l["h1"])
for g in ALLG: og_make(f'/guides/{g["slug"]}/', g["h1"])
for b in (50, 100, 150, 200, 250): og_make(f"/gifts/ad-{b}/", f"מארזי שי לעובדים עד ₪{b}")
for n in SIZES: og_make(f"/gifts/{n}-ovdim/", f"מתנות ל-{n} עובדים – תקציב ורעיונות")
og_make("/gifts/", "כל המארזים, הרעיונות והמדריכים")
og_make("/gifts/galeria/", "מארזי השראה – מתחילים ממארז מוכן")
og_make("/kelim/machshevon-takziv/", "מחשבון תקציב מתנות לעובדים")
og_make("/kelim/eize-maraz/", "איזה מארז מתאים לארגון שלכם?")
og_make("/about/", "הסיפור של נויה במתנה")
for k, v in CATS.items(): og_make(f"/c/{k}/", f"{v} למארזי שי")

for l in LAND + KIND + AUD + IND + EVT:
    pp = picks(l["cats"])
    faqs = l.get("faq", []) + common_faq(l["slug"])
    body = f"""<h1>{e(l["h1"])}</h1><p class="lead">{e(l["lead"])}</p>
<div class="cta-row"><a class="btn" href="/?cat={l["cats"][0]}">בונים מארז עכשיו ←</a><a class="btn ghost" href="{WA}" target="_blank" rel="noopener">מדברים איתנו בוואטסאפ</a></div>
<ul class="facts"><li>מאז 2024 · 48,000+ מארזים</li><li>600+ חברות וארגונים</li><li>מיתוג עם לוגו</li><li>משלוח אישי לכל נמען</li></ul>
{VIDEO if l["slug"]=="matanot-laovdim" else ""}<div class="prose">{l["body"]}</div>
<h2>מוצרים מומלצים למארז</h2><div class="grid">{"".join(card(p) for p in pp)}</div>
{faq_html(faqs)}"""
    ld = [{"@type": "WebPage", "name": l["title"], "description": l["desc"], "inLanguage": "he"},
          {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f'{SITE}/p/{p["id"]}/'} for i, p in enumerate(pp)]}, faq_ld(faqs)] + ([VIDEO_LD] if l["slug"] == "matanot-laovdim" else [])
    page(f'/gifts/{l["slug"]}/', l["title"], l["desc"], body, ld, [("בונה המארזים", "/"), (l["nav"], f'/gifts/{l["slug"]}/')],
         alt={"he": "/gifts/matanot-laovdim/", "en": "/en/employee-gifts-israel/"} if l["slug"] == "matanot-laovdim" else None)

for g in ALLG:
    outro = ['<p><b>רוצים לראות את זה בפועל?</b> <a href="/">היכנסו לבונה המארזים</a>, בחרו מוצרים ותראו את המארז שלכם תוך חצי דקה.</p>',
             '<p><b>מהמדריך למארז:</b> ב<a href="/">בונה המארזים</a> בוחרים מוצרים ואריזה ומקבלים הצעת מחיר מסודרת מיד.</p>',
             '<p><b>רוצים לנסות?</b> פתחו את <a href="/">בונה המארזים</a>, הגדירו תקציב למארז ובדקו מה נכנס בו.</p>'][ALLG.index(g) % 3]
    ex = EXTRA.get(g["slug"], {})
    gfaq = ex.get("faq", [])
    body = f'<article class="prose"><h1>{e(g["h1"])}</h1>{g["body"]}{ex.get("body", "")}{outro}</article>' + (faq_html(gfaq) if gfaq else "")
    ld = ([faq_ld(gfaq)] if gfaq else []) + [{"@type": "Article", "headline": g["h1"], "description": g["desc"], "inLanguage": "he", "datePublished": g.get("published", "2026-11-25"), "dateModified": TODAY,
           "author": {"@type": "Organization", "name": "נויה במתנה"}, "publisher": {"@id": SITE + "/#business"}, "mainEntityOfPage": f'{SITE}/guides/{g["slug"]}/'}]
    page(f'/guides/{g["slug"]}/', g["title"], g["desc"], body, ld, [("בונה המארזים", "/"), (g["nav"], f'/guides/{g["slug"]}/')])

for k, v in CATS.items():
    pp = [p for p in P if p["cat"] == k]
    if not pp: continue
    title = f"{v} למארזי שי ומתנות לעובדים | נויה במתנה"
    desc = f"{CAT_INTRO[k]} {len(pp)} מוצרים, מחירים לפני מע״מ."
    if len(desc) > 160: desc = f"{CAT_INTRO[k].split(' – ')[0]} – {len(pp)} מוצרים, מחירים לפני מע״מ."
    if len(desc) < 90: desc += " מיתוג עם לוגו ומשלוח לכל נמען."
    body = f"""<h1>{e(v)} למארזי שי</h1><p class="lead">{e(CAT_INTRO[k])}</p>
<div class="cta-row"><a class="btn" href="/?cat={k}">בונים מארז עם {e(v)} ←</a></div>
<div class="grid">{"".join(card(p) for p in pp)}</div><div class="prose">{CAT_MORE.get(k, "")}</div>"""
    ld = [{"@type": "CollectionPage", "name": title, "description": desc, "inLanguage": "he"},
          {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f'{SITE}/p/{p["id"]}/'} for i, p in enumerate(pp)]}]
    page(f"/c/{k}/", title, desc, body, ld, [("בונה המארזים", "/"), (v, f"/c/{k}/")])

# how each category works inside a gift box (product pages)
CAT_TIP = {
 "diffuser": "מפיץ ריח הוא מוצר מרכזי מצוין במארז: הוא נראה טוב על השולחן, מחזיק שבועות ומזכיר את הנותן בכל פעם שנכנסים לחדר. משלבים אותו עם נר ריחני או כלי הגשה קטן.",
 "candle": "נרות מוסיפים למארז חום ואווירה, ומתאימים כמעט לכל קהל ולכל חג. נר בודד משלים מארז קיים, וכמה נרות יחד יוצרים מארז פינוק שלם.",
 "holder": "פמוטים מתאימים במיוחד למארזי חג – ראש השנה, פסח וחנוכה – ולמארזים לבית. משלבים אותם עם נרות ארוכים ומגש קטן.",
 "textile": "מפות, מגבות וטקסטיל לבית הם מתנה שימושית שנכנסת לבית מיד. אפשר למתג אותם עם חבק ממותג עם לוגו, ולשלב עם כלי הגשה למארז אירוח.",
 "serve": "כלי הגשה מעץ וקרמיקה הם הבסיס של מארזי אירוח. קרש או מגש גדול משמש גם כבסיס שעליו מסדרים את שאר המוצרים במארז.",
 "kitchen": "מתנות למטבח הן בחירה בטוחה לעובדים ולקוחות: כולם משתמשים בהן, והן מתאימות למארזי חג ולמארזי אירוח.",
 "decor": "אגרטלים, עציצים ופריטי עיצוב מוסיפים למארז נגיעה אישית ומעוצבת. משלבים אותם עם נר או מפיץ ריח למארז לבית.",
 "drink": "כלי שתייה הם מתנה קטנה ושימושית, מתאימה במיוחד לכנסים, לימי גיבוש ולמארזים בתקציב קטן.",
 "gift": "מארז מוכן הוא מתנה שלמה בפני עצמה, ואפשר להוסיף לו מוצר משלים אחד או שניים כדי להפוך אותו למארז אישי.",
}
def prod_faq(p):
    if p.get("engrave"): b = "כן. אפשר לחרוט את הלוגו שלכם על המוצר בתוספת ₪7 ליחידה. הלוגו מופיע גם על כרטיס הברכה והתגית של המארז."
    elif p.get("brandKind") == "sleeve": b = "כן. את המוצר ממתגים עם חבק ממותג עם הלוגו שלכם, בתוספת ₪7 ליחידה. הלוגו מופיע גם על כרטיס הברכה והתגית של המארז."
    else: b = "הלוגו שלכם מופיע על כרטיס הברכה, על התגית ועל האריזה של המארז."
    return [("אפשר למתג את המוצר עם לוגו?", b),
            ("איך המארזים מגיעים לעובדים?", "שולחים לנו קובץ אקסל עם כתובות, וכל מארז נשלח בנפרד: ₪65 למארז, או שליח VIP צמוד ב-₪99 למארז. אפשר גם משלוח מרוכז למשרד או איסוף עצמי מהענבר 1, ברקן."),
            ("יש מינימום הזמנה?", "מינימום ההזמנה הוא ₪3,000 לפני מע״מ לכל ההזמנה. אפשר לשלב כמה מוצרים וכמה סוגי מארזים באותה הזמנה.")]
for p in P:
    cat = CATS.get(p["cat"], "מוצרים")
    name = p["name"]
    d = (p.get("desc") or "").strip()
    cp = COPY.get(p["id"])
    if cp: d = cp[0]
    desc = f"{name}" + (f" – {d}" if d else "") + f". {ils(p['price'])} ליחידה לפני מע״מ, למארזי שי לעובדים וללקוחות – מיתוג עם לוגו ומשלוח אישי לכל נמען."
    img = f'{SITE}/{p["photo"] or p["img"]}'
    rel = [x for x in P if x["cat"] == p["cat"] and x["id"] != p["id"]][:8]
    instock = (p.get("stock") or 0) > 0
    sale = f' <s style="color:var(--soft);font-size:18px">{ils(p["was"])}</s>' if p.get("was", 0) > p["price"] else ""
    eta = f'<li>מלאי נוסף בדרך</li>' if p.get("incoming") else ""
    body = f"""<div class="hero"><div><h1>{e(name)}</h1>
{f'<p class="lead">{e(d)}</p>' if d else ''}{f'<p><b>רעיון למארז:</b> {e(cp[1])}</p>' if cp else ''}
<div class="price">{ils(p["price"])}{sale} <small>ליחידה · לפני מע״מ</small></div>
<ul class="facts"><li>{e(cat)}</li>{'<li>במלאי</li>' if instock else '<li>בהזמנה מראש</li>'}{'<li>מגיע באריזת מתנה</li>' if p.get('box') else ''}{eta}<li>מיתוג ומשלוח לכל נמען</li></ul>
<div class="cta-row"><a class="btn" href="/?add={p["id"]}">הוסיפו למארז ←</a><a class="btn ghost" href="/c/{p["cat"]}/">עוד {e(cat)}</a></div>
<p style="font-size:15px;color:var(--soft);margin:10px 0 0">בונים מארז מכמה מוצרים, רואים אותו מעוצב ומקבלים הצעת מחיר מיד. מינימום הזמנה ₪3,000 לכל ההזמנה.</p></div>
<img src="/{p["photo"] or p["img"]}" alt="{e(name)}" width="720" height="720" fetchpriority="high"></div>
<h2>עוד {e(cat)} למארז</h2><div class="grid">{"".join(card(x) for x in rel)}</div>
<h2>מתאים במיוחד ל…</h2><nav class="links">{"".join(f'<a href="/gifts/{l["slug"]}/">{e(l["nav"])}</a>' for l in (LAND + KIND + AUD + IND + EVT) if p["cat"] in l["cats"][:3])}</nav>
<h2>איך משלבים את המוצר במארז</h2><div class="prose"><p>{e(CAT_TIP.get(p["cat"], ""))} בבונה המארזים מוסיפים את המוצר למארז, רואים את המארז מעוצב ומקבלים הצעת מחיר מיד. רעיונות לפי תקציב: <a href="/gifts/ad-100/">מארזים עד ₪100</a>, <a href="/gifts/ad-200/">עד ₪200</a>.</p></div>
{faq_html(prod_faq(p))}"""
    prod = {"@type": "Product", "name": name, "image": [img], "description": desc, "sku": p["id"], "category": cat,
            "brand": {"@type": "Brand", "name": "NOYA"},
            "offers": {"@type": "Offer", "url": f'{SITE}/p/{p["id"]}/', "priceCurrency": "ILS", "price": f'{p["price"]:.2f}',
                       "availability": "https://schema.org/InStock" if instock else "https://schema.org/PreOrder",
                       "itemCondition": "https://schema.org/NewCondition", "seller": {"@id": SITE + "/#business"}}}
    page(f'/p/{p["id"]}/', ptitle(name, cat), pdesc(name, d, p["price"]), body, [prod, faq_ld(prod_faq(p))],
         [("בונה המארזים", "/"), (cat, f'/c/{p["cat"]}/'), (name, f'/p/{p["id"]}/')], img)


# ---------- budget pages ----------
SRCSETS = re.search(r'^const SETS=\[(.*?)^\];', SRC, re.M | re.S).group(1)
SETS = []
for m in re.finditer(r'\{name:"([^"]+)",budget:(\d+),items:\[([^\]]*)\],pack:"([^"]+)"\}', SRCSETS):
    SETS.append(dict(name=m.group(1), budget=int(m.group(2)), items=re.findall(r'"(\w+)"', m.group(3)), pack=m.group(4)))
BUD = [(50, "ad-50", "עד ₪50"), (100, "ad-100", "עד ₪100"), (150, "ad-150", "עד ₪150"), (200, "ad-200", "עד ₪200"), (250, "ad-250", "עד ₪250")]
for i, (b, slug, lab) in enumerate(BUD):
    st = min(SETS, key=lambda x: abs(x["budget"] - b)); si = SETS.index(st)
    items = [BY[x] for x in st["items"] if x in BY]
    lo = BUD[i - 1][0] * 0.5 if i else 0
    singles = sorted([p for p in P if p["price"] <= b * 0.6 and p["price"] >= lo * 0.4 and not (p.get("was", 0) > p["price"])], key=lambda p: -p.get("stock", 0))[:12]
    title = f"מארזי שי לעובדים {lab} – רעיונות ומחירים | נויה במתנה"
    desc = f"מארזי מתנה לעובדים ולקוחות בתקציב {lab} לפני מע״מ: מארז מוכן להתחלה, מוצרים שנכנסים בתקציב ובונה שמראה את המחיר בזמן אמת. מיתוג ומשלוח לכל נמען."
    nav = f"מארזים {lab}"
    body = f"""<h1>מארזי שי לעובדים {e(lab)}</h1>
<p class="lead">מחפשים מתנה לעובדים בתקציב של {e(lab)} למארז? בבונה המארזים מגדירים תקציב, בוחרים מוצרים ורואים את המחיר מתעדכן בזמן אמת – כך המארז נשאר בדיוק בתקציב.</p>
<div class="cta-row"><a class="btn" href="/?budget={b}">בונים מארז {e(lab)} ←</a><a class="btn ghost" href="/?set={si}">מתחילים מהמארז "{e(st['name'])}" ←</a></div>
<h2>מארז מוכן להתחלה: "{e(st['name'])}"</h2>
<p>מארז השראה של נויה בתקציב של עד ₪{st['budget']} לפני מע״מ. אפשר לפתוח אותו בבונה, להחליף מוצרים ולהוסיף לוגו.</p>
<div class="grid">{"".join(card(p) for p in items)}</div>
<h2>מוצרים שנכנסים בתקציב {e(lab)}</h2><div class="grid">{"".join(card(p) for p in singles)}</div>
<div class="prose"><h2>טיפים למארז {e(lab)}</h2><ul>
<li>מוצר מרכזי אחד טוב עדיף על הרבה פריטים קטנים.</li>
<li>אריזה יפה וכרטיס ברכה ממותג משדרגים כל מארז – גם בתקציב קטן.</li>
<li>אם שולחים לכל עובד הביתה, תקצבו גם משלוח: ₪65 למארז, או ₪99 בשליח VIP.</li>
<li>המחירים לפני מע״מ. מינימום הזמנה ₪3,000 לכל ההזמנה.</li></ul>
<p>לקריאה נוספת: <a href="/guides/kama-lehotzi-al-matana-laoved/">כמה להוציא על מתנה לעובד?</a></p></div>
{faq_html(common_faq(slug))}"""
    ld = [{"@type": "WebPage", "name": title, "description": desc, "inLanguage": "he"}, faq_ld(common_faq(slug))]
    page(f"/gifts/{slug}/", title, desc, body, ld, [("בונה המארזים", "/"), (nav, f"/gifts/{slug}/")])

# ---------- about ----------
ABOUT_T = "הסיפור שלנו – נויה במתנה | מארזי שי לארגונים מאז 2024"
ABOUT_D = "נויה במתנה – עסק משפחתי למארזי שי לעובדים, ללקוחות ולשותפים עסקיים. מאז 2024 שלחנו מעל 48,000 מארזים ליותר מ-600 חברות וארגונים. מחסן ואיסוף עצמי בברקן."
ab = f"""<article class="prose"><h1>הסיפור של נויה במתנה</h1>
<p class="lead">נויה במתנה נקראת על שם נויה, הבת של משה – מייסד העסק. השם הזה מזכיר לנו כל יום שמתנה טובה היא קודם כול מחשבה על מישהו אחר.</p>
<h2>מה אנחנו עושים</h2>
<p>אנחנו מעצבים מארזי שי לעובדים, ללקוחות ולשותפים עסקיים – בהתאמה אישית לכל ארגון. מפיצי ריח, פמוטים, נרות, מפות שולחן, כלי הגשה ומתנות למטבח, ביבוא ישיר ובמחירים תחרותיים. כל מארז נבנה לפי התקציב ואופי הארגון, עם מיתוג ולוגו, ונשלח לכל נמען בנפרד או מגיע מרוכז למשרד.</p>
<h2>במספרים</h2>
<ul><li>פועלים מאז 2024</li><li>מעל 48,000 מארזים נשלחו</li><li>יותר מ-600 חברות וארגונים, ביניהם בנקים, בתי חולים, רשויות וחברות הייטק</li><li>מחסן ואיסוף עצמי: הענבר 1, ברקן</li></ul>
<h2>איך זה עובד</h2>
<ol><li>בונים מארז ב<a href="/">בונה המארזים</a> ורואים אותו מעוצב תוך חצי דקה.</li><li>מורידים הצעת מחיר או מדברים איתנו בוואטסאפ.</li><li>שולחים רשימת כתובות באקסל – ואנחנו אורזים, ממתגים ושולחים.</li></ol>
<h2>האור של אורי</h2>
<p>לזכרו של סמ״ר אורי ג׳רבי הי״ד הקמנו את מארז "האור של אורי". מכל מארז כזה נתרמת ארוחה חמה ליוזמת "האור של אורי" – ועד היום נתרמו 1,869 ארוחות חמות בשווי ₪33,228.</p>
<h2>דברו איתנו</h2>
<p>משה · <a href="tel:0543219070">054-3219070</a> · <a href="mailto:moshe@noyaglobal.com">moshe@noyaglobal.com</a></p></article>"""
page("/about/", ABOUT_T, ABOUT_D, ab, [{"@type": "AboutPage", "name": ABOUT_T, "description": ABOUT_D, "inLanguage": "he"}], [("בונה המארזים", "/"), ("הסיפור שלנו", "/about/")])


# ---------- team size pages ----------
for n in SIZES:
    mn = 3000 / n
    title = f"מתנות ל-{n} עובדים – תקציב, רעיונות ומחירים | נויה במתנה"
    desc = f"כמה עולה מתנה ל-{n} עובדים? טבלת תקציב לפי מחיר מארז, עלות משלוח לכל עובד ורעיונות למארזים – כולל מינימום הזמנה ומה כדאי לבדוק."
    rows = "".join(f"<tr><td>₪{per}</td><td>₪{per*n:,}</td><td>₪{(per+65)*n:,}</td></tr>" for per in (60, 80, 100, 150, 200, 250) if per * n >= 3000)
    note = f"<p>מינימום ההזמנה הוא ₪3,000 לפני מע״מ לכל ההזמנה. ל-{n} עובדים זה יוצא בממוצע ₪{mn:,.0f} למארז ומעלה.</p>"
    body = f"""<article class="prose"><h1>מתנות ל-{n} עובדים – תקציב ורעיונות</h1>
<p class="lead">מזמינים מתנות ל-{n} עובדים? הנה כמה זה עולה בפועל, לפי מחיר המארז ולפי סוג המשלוח – כדי שתוכלו לתכנן תקציב מדויק.</p>
<h2>טבלת תקציב (לפני מע״מ)</h2>
<table class="tbl"><thead><tr><th>מחיר מארז</th><th>סה״כ מארזים</th><th>כולל משלוח לכל עובד (₪65)</th></tr></thead><tbody>{rows}</tbody></table>
{note}
<h2>איך לבחור</h2><ul>
<li><b>משלוח מרוכז למשרד</b> זול משמעותית ממשלוח לכל עובד – אם כולם עובדים באותו מקום.</li>
<li><b>מארז אחיד</b> לכל העובדים הוא הפשוט ביותר לניהול; אפשר להוסיף מארז משודרג להנהלה.</li>
<li>תכננו גם את <a href="/guides/matanot-laovdim-mas/">עלות המס והגילום</a> אם אתם מגלמים.</li></ul>
<p>לחישוב מדויק עם המספרים שלכם: <a href="/kelim/machshevon-takziv/?n={n}">מחשבון תקציב מתנות</a>.</p></article>
<div class="cta-row"><a class="btn" href="/">בונים מארז ורואים מחיר ←</a></div>
{faq_html(common_faq(str(n)))}"""
    page(f"/gifts/{n}-ovdim/", title, desc, body, [{"@type": "WebPage", "name": title, "description": desc, "inLanguage": "he"}, faq_ld(common_faq(str(n)))],
         [("בונה המארזים", "/"), (f"מתנות ל-{n} עובדים", f"/gifts/{n}-ovdim/")])

# ---------- gallery of inspiration sets ----------
gb = ""
for i, st in enumerate(SETS):
    items = [BY[x] for x in st["items"] if x in BY]
    tot = sum(p["price"] for p in items)
    gb += f"""<section class="grp"><h2>{e(st['name'])}</h2><p>מארז השראה בתקציב של עד ₪{st['budget']} לפני מע״מ · {len(items)} מוצרים · {ils(round(tot, 2))} למוצרים.</p>
<div class="grid">{"".join(card(p) for p in items)}</div><div class="cta-row"><a class="btn" href="/?set={i}">פותחים את המארז בבונה ומשנים ←</a></div></section>"""
gt = "מארזי השראה – מארזי שי מוכנים שאפשר לשנות | נויה במתנה"
gd = "מארזי השראה של נויה במתנה בתקציבים של ₪50 עד ₪250: פותחים מארז מוכן בבונה, מחליפים מוצרים, מוסיפים לוגו ומקבלים הצעת מחיר."
page("/gifts/galeria/", gt, gd, f'<h1>מארזי השראה</h1><p class="lead">לא בטוחים מאיפה להתחיל? בחרו אחד ממארזי ההשראה שלנו, פתחו אותו בבונה ושנו כל מה שתרצו – מוצרים, אריזה ולוגו.</p>{gb}',
     [{"@type": "CollectionPage", "name": gt, "description": gd, "inLanguage": "he"}], [("בונה המארזים", "/"), ("מארזי השראה", "/gifts/galeria/")])

# ---------- calculator ----------
CALC = """<h1>מחשבון תקציב מתנות לעובדים</h1>
<p class="lead">כמה יעלו המתנות לכל הארגון? מזינים מספר עובדים, מחיר למארז וסוג משלוח – ומקבלים סה״כ לפני ואחרי מע״מ.</p>
<form class="tool" id="calc" onsubmit="return false">
<label for="n">מספר מקבלי מתנה</label><input id="n" type="number" min="1" value="50" inputmode="numeric">
<label for="per">מחיר מארז (לפני מע״מ, ₪)</label><input id="per" type="number" min="1" value="100" inputmode="numeric">
<label for="ship">משלוח</label><select id="ship"><option value="65">משלוח אישי לכל נמען – ₪65</option><option value="99">שליח VIP צמוד – ₪99</option><option value="0">איסוף עצמי / משלוח מרוכז (בתיאום)</option></select>
<label for="vat">מע״מ (%)</label><input id="vat" type="number" min="0" step="0.1" value="18">
<div class="out" id="out" aria-live="polite"></div></form>
<div class="cta-row"><a class="btn" id="go" href="/?budget=100">בונים מארז בתקציב הזה ←</a></div>
<div class="prose"><h2>איך לקרוא את התוצאה</h2><ul><li>המחירים בבונה ובהצעת המחיר שלנו הם לפני מע״מ. שיעור המע״מ ניתן לשינוי במחשבון.</li><li>מינימום ההזמנה הוא ₪3,000 לפני מע״מ לכל ההזמנה.</li><li>אם אתם מגלמים את המס על המתנה, הוסיפו גם את עלות הגילום. <a href="/guides/matanot-laovdim-mas/">מתנות לעובדים ומס</a>.</li></ul></div>
<script>(function(){var $=function(i){return document.getElementById(i)},f=function(x){return '₪'+Math.round(x).toLocaleString('he-IL')};
var q=new URLSearchParams(location.search);if(+q.get('n'))$('n').value=+q.get('n');
function r(){var n=Math.max(0,+$('n').value||0),p=Math.max(0,+$('per').value||0),s=+$('ship').value,v=(+$('vat').value||0)/100;
var g=n*p,sh=n*s,t=g+sh;$('out').innerHTML='מארזים: <b>'+f(g)+'</b><br>משלוח: <b>'+f(sh)+'</b><br>סה״כ לפני מע״מ: <b>'+f(t)+'</b><br>סה״כ כולל מע״מ: <b>'+f(t*(1+v))+'</b>'+(g&&g<3000?'<br><span style="color:#a0522d">שימו לב: מינימום ההזמנה הוא ₪3,000 לפני מע״מ.</span>':'');
$('go').href='/?budget='+Math.round(p);}
['n','per','ship','vat'].forEach(function(i){$(i).addEventListener('input',r)});r();})();</script>"""
ct = "מחשבון תקציב מתנות לעובדים – כמה יעלו מארזי השי? | נויה במתנה"
cd = "מחשבון חינמי לתקציב מתנות לעובדים: מספר עובדים × מחיר מארז + משלוח לכל עובד, לפני ואחרי מע״מ. מתכננים תקציב לחג בדקה."
page("/kelim/machshevon-takziv/", ct, cd, CALC, [{"@type": "WebApplication", "name": "מחשבון תקציב מתנות לעובדים", "applicationCategory": "BusinessApplication", "operatingSystem": "Any", "inLanguage": "he", "offers": {"@type": "Offer", "price": "0", "priceCurrency": "ILS"}}],
     [("בונה המארזים", "/"), ("מחשבון תקציב מתנות", "/kelim/machshevon-takziv/")])

# ---------- quiz ----------
QUIZ = """<h1>איזה מארז מתאים לארגון שלכם?</h1>
<p class="lead">שלוש שאלות קצרות – ונפתח לכם בבונה מארז השראה שמתאים, שאפשר לשנות כרצונכם.</p>
<div class="tool" id="quiz">
<h3>1. למי המתנה?</h3><div class="opts" data-q="who"><button data-v="emp">עובדים</button><button data-v="vip">הנהלה / VIP</button><button data-v="cli">לקוחות ושותפים</button></div>
<h3>2. מה התקציב למארז (לפני מע״מ)?</h3><div class="opts" data-q="bud"><button data-v="50">עד ₪50</button><button data-v="100">עד ₪100</button><button data-v="150">עד ₪150</button><button data-v="200">עד ₪200</button><button data-v="250">₪250 ומעלה</button></div>
<h3>3. מה הסגנון?</h3><div class="opts" data-q="sty"><button data-v="table">שולחן חג ואירוח</button><button data-v="home">ריח ואווירה בבית</button><button data-v="kitchen">מטבח ושימושי</button></div>
<div class="out" id="res" aria-live="polite">בחרו תשובה בכל שאלה.</div>
<div class="cta-row"><a class="btn" id="go" href="/">פותחים את המארז בבונה ←</a></div></div>
<script>(function(){var a={};var SETS=__SETS__;var CAT={table:'serve',home:'diffuser',kitchen:'kitchen'};
document.querySelectorAll('.opts').forEach(function(g){g.addEventListener('click',function(ev){var b=ev.target.closest('button');if(!b)return;
g.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)});a[g.dataset.q]=b.dataset.v;u();});});
function u(){if(!a.bud){return}var bud=+a.bud;if(a.who==='vip'&&bud<200)bud=200;var best=0,d=1e9;SETS.forEach(function(s,i){var x=Math.abs(s.b-bud);if(x<d){d=x;best=i}});
var s=SETS[best];var url='/?set='+best;if(a.sty)url+='&cat='+CAT[a.sty];document.getElementById('go').href=url;
document.getElementById('res').innerHTML='ההמלצה שלנו: <b>מארז "'+s.n+'"</b> – עד ₪'+s.b+' לפני מע״מ.'+(a.who==='vip'?'<br>להנהלה מומלץ גם שליח VIP צמוד (₪99 למארז).':'')+(a.who==='cli'?'<br>ללקוחות מומלץ להוסיף כרטיס ברכה ממותג עם הלוגו שלכם.':'')+'<br>בבונה אפשר להחליף מוצרים ולראות את המחיר מתעדכן.';}})();</script>""".replace("__SETS__", json.dumps([{"n": st["name"], "b": st["budget"]} for st in SETS], ensure_ascii=False))
qt = "איזה מארז שי מתאים לארגון שלכם? שאלון קצר | נויה במתנה"
qd = "שאלון של 3 שאלות שממליץ על מארז שי לעובדים, להנהלה או ללקוחות לפי תקציב וסגנון – ופותח אותו בבונה המארזים."
page("/kelim/eize-maraz/", qt, qd, QUIZ, [{"@type": "WebPage", "name": qt, "description": qd, "inLanguage": "he"}], [("בונה המארזים", "/"), ("איזה מארז מתאים לכם?", "/kelim/eize-maraz/")])

# ---------- hub ----------
hb = '<h1>כל המארזים, הרעיונות והמדריכים</h1><p class="lead">כל דפי המתנות של נויה במתנה במקום אחד – לפי חג, תקציב, קהל, תחום ואירוע.</p>' + "".join(
    f'<section class="grp"><h2>{e(t)}</h2><nav class="links">' + "".join(f'<a href="{u}">{e(n)}</a>' for n, u in ls) + "</nav></section>" for t, ls in GROUPS)
ht = "כל מארזי השי והמתנות לעובדים – לפי חג, תקציב וקהל | נויה במתנה"
hd = "מפת כל דפי המתנות של נויה במתנה: מארזים לחגים, לפי תקציב, למנהלים, ללקוחות, לפי תחום ולאירועים במהלך השנה – ומדריכים לרכישת מתנות לעובדים."
page("/gifts/", ht, hd, hb, [{"@type": "CollectionPage", "name": ht, "description": hd, "inLanguage": "he"}], [("בונה המארזים", "/"), ("כל המארזים", "/gifts/")], nav=False)

# ---------- English ----------
for ep in EN_PAGES:
    page(ep["path"], ep["title"], ep["desc"], ep["body"], [{"@type": "WebPage", "name": ep["title"], "description": ep["desc"], "inLanguage": "en"}],
         [("Noya Gifts", "/en/"), (ep["title"].split(" – ")[0].split(" | ")[0], ep["path"])] if ep["path"] != "/en/" else [("Noya Gifts", "/en/")],
         lang="en", alt={"en": ep["path"], "he": ep["he"]}, nav=False)

# ---------- 404 ----------
_u = list(URLS)
page("/404-tmp/", "הדף לא נמצא | נויה במתנה", "הדף לא נמצא – חזרו לבונה המארזים של נויה במתנה.",
     '<h1>אופס, הדף הזה לא נמצא</h1><p class="lead">יכול להיות שהקישור השתנה. אפשר לחזור לבונה המארזים, או לבחור אחד מהדפים הבאים.</p><div class="cta-row"><a class="btn" href="/">לבונה המארזים ←</a><a class="btn ghost" href="/gifts/">כל המארזים והמדריכים</a></div>',
     [], [("בונה המארזים", "/"), ("דף לא נמצא", "/404-tmp/")])
URLS[:] = _u
_d = open(os.path.join(ROOT, "404-tmp", "index.html"), encoding="utf-8").read().replace('<meta name="description"', '<meta name="robots" content="noindex"><meta name="description"')
open(os.path.join(ROOT, "404.html"), "w", encoding="utf-8").write(_d); shutil.rmtree(os.path.join(ROOT, "404-tmp"))
# sitemap (with images + video)
pri = lambda u: "1.0" if u == "/" else "0.9" if u.startswith("/gifts/") else "0.8" if u.startswith(("/c/", "/guides/", "/kelim/")) else "0.6"
IMGS = {f'/p/{p["id"]}/': [(f'{SITE}/{p["photo"] or p["img"]}', p["name"])] for p in P}
sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">']
for u in ["/"] + URLS:
    x = f"  <url><loc>{SITE}{u}</loc><lastmod>{TODAY}</lastmod><priority>{pri(u)}</priority>"
    for src, _ in IMGS.get(u, []): x += f"<image:image><image:loc>{e(src)}</image:loc></image:image>"
    if u == "/gifts/matanot-laovdim/":
        x += f"<video:video><video:thumbnail_loc>{SITE}/media/hero-bg.jpg</video:thumbnail_loc><video:title>{e(VIDEO_LD['name'])}</video:title><video:description>{e(VIDEO_LD['description'])}</video:description><video:content_loc>{SITE}/media/noya-builder-wide.mp4</video:content_loc></video:video>"
    sm.append(x + "</url>")
sm.append("</urlset>")
open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write("\n".join(sm) + "\n")
# llms.txt – facts for AI assistants
LL = f"""# נויה במתנה (Noya Gifts)

> נויה במתנה מעצבת מארזי שי ומתנות לעובדים, ללקוחות ולשותפים עסקיים בישראל, בהתאמה אישית לכל ארגון. בבונה המארזים באתר בוחרים מוצרים ואריזה, רואים את המארז מעוצב ומקבלים הצעת מחיר מיד.

## עובדות
- פועלים מאז 2024; מעל 48,000 מארזים ליותר מ-600 חברות וארגונים.
- מחירים לפני מע״מ. מינימום הזמנה: ₪3,000 לפני מע״מ לכל ההזמנה.
- משלוח אישי לכל נמען: ₪65 למארז. שליח VIP צמוד: ₪99 למארז. איסוף עצמי: הענבר 1, ברקן.
- מיתוג עם לוגו: כרטיס ברכה, תגית, אריזה וחריטה על מוצרים נבחרים.
- מוצרים: מפיצי ריח, נרות, פמוטים, מפות שולחן וטקסטיל, כלי הגשה מעץ וקרמיקה, מתנות למטבח, מארזי תה, קפה, יין וספא.
- טלפון: 054-3219070 · מייל: moshe@noyaglobal.com · אתר ראשי: https://www.noyaglobal.com

## דפים מרכזיים
- [בונה המארזים]({SITE}/)
- [כל המארזים והמדריכים]({SITE}/gifts/)
- [מתנות לעובדים]({SITE}/gifts/matanot-laovdim/)
- [מחשבון תקציב מתנות]({SITE}/kelim/machshevon-takziv/)
- [עד מתי להזמין לכל חג]({SITE}/guides/ad-matai-lehazmin/)
- [הסיפור שלנו]({SITE}/about/)
- [English]({SITE}/en/)
"""
open(os.path.join(ROOT, "llms.txt"), "w", encoding="utf-8").write(LL)
# links block for the builder home page
open(os.path.join(ROOT, "tools", "links.html"), "w", encoding="utf-8").write("".join(f'<a href="{u}">{e(n)}</a>' for n, u in LINKS))
print("pages", len(URLS))
