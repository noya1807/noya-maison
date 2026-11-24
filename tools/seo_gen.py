# Generates static SEO pages for build.noyaglobal.com from the catalogue in index.html.
# Run: python3 tools/seo_gen.py   (rewrites /p, /c, /gifts, /guides and sitemap.xml)
import re, json, os, html, shutil, datetime
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
.crumbs{font-size:14px;color:var(--soft);margin:4px 0 14px}.crumbs a{color:var(--soft);text-decoration:none}.crumbs a:hover{text-decoration:underline}
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
.card b{padding:2px 10px 10px;font-size:15px;color:var(--gold)}
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
footer a{text-decoration:none;font-weight:600}
.wa{position:fixed;right:18px;bottom:18px;z-index:20;background:#25d366;color:#fff;text-decoration:none;font-weight:700;border-radius:99px;padding:11px 18px;box-shadow:0 8px 20px -6px rgba(0,0,0,.35)}
@media (max-width:760px){.hero{grid-template-columns:1fr;padding:16px}.top .btn{padding:8px 14px;font-size:14px}.logo span{display:none}}
"""
WA = "https://wa.me/972543219070?text=" + "%D7%94%D7%99%D7%99%2C%20%D7%94%D7%92%D7%A2%D7%AA%D7%99%20%D7%9E%D7%94%D7%90%D7%AA%D7%A8%20%D7%95%D7%90%D7%A9%D7%9E%D7%97%20%D7%9C%D7%A4%D7%A8%D7%98%D7%99%D7%9D%20%D7%A2%D7%9C%20%D7%9E%D7%90%D7%A8%D7%96%D7%99%20%D7%A9%D7%99"
BIZ = {"@type": "LocalBusiness", "@id": SITE + "/#business", "name": "נויה במתנה", "url": SITE + "/", "telephone": "+972-54-321-9070",
       "address": {"@type": "PostalAddress", "streetAddress": "הענבר 1", "addressLocality": "ברקן", "addressCountry": "IL"}}
e = lambda t: html.escape(str(t), quote=True)
def ils(x):
    return ("₪%.2f" % x).rstrip("0").rstrip(".") if x != int(x) else "₪%d" % x

def page(path, title, desc, body, ld, crumbs, img=SITE + "/img/og-magic.jpg"):
    url = SITE + path
    bl = {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + u} for i, (n, u) in enumerate(crumbs)]}
    graph = {"@context": "https://schema.org", "@graph": [BIZ, bl] + ld}
    cr = " › ".join(f'<a href="{u}">{e(n)}</a>' if i < len(crumbs) - 1 else e(n) for i, (n, u) in enumerate(crumbs))
    doc = f"""<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title><meta name="description" content="{e(desc)}"><link rel="canonical" href="{url}">
<meta property="og:type" content="website"><meta property="og:locale" content="he_IL"><meta property="og:site_name" content="נויה במתנה">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}"><meta property="og:url" content="{url}"><meta property="og:image" content="{img}">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#fffaf3">
<link rel="icon" type="image/png" href="/img/icon-64.png?v=2"><link rel="apple-touch-icon" href="/img/icon-180.png?v=2">
{FONT}<style>{CSS}</style>
<script type="application/ld+json">{json.dumps(graph, ensure_ascii=False)}</script></head><body>
<header class="top"><div class="top-in"><a class="logo" href="/"><img src="/img/icon-180.png?v=2" alt="נויה במתנה" width="36" height="36"><span>נויה במתנה</span></a><a class="btn sm" href="/">לבונה המארזים ←</a></div></header>
<main><nav class="crumbs" aria-label="פירורי לחם">{cr}</nav>
{body}
<section class="band"><h2>בונים מארז – ורואים אותו תוך דקה</h2><p>בוחרים מוצרים ואריזה, רואים את המארז מעוצב ומקבלים הצעת מחיר מיד. מיתוג עם לוגו ומשלוח אישי לכל נמען.</p><a class="btn" href="/">לבונה המארזים ←</a></section>
{NAV_LINKS}
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
  body="""<p>מארזי הפסח שלנו מתמקדים במה שבאמת נכנס לשימוש בחג: מפות שולחן גדולות במיוחד, מגשים וקערות הגשה, פמוטים ונרות, ואביזרי מטבח איכותיים. הכול נבחר בבונה, מתומחר מיד ונשלח לכל עובד.</p>
<h3>טיפ להזמנת מארזי פסח</h3>
<p>כדאי לסגור את ההזמנה כחודש לפני החג. כך יש זמן למיתוג, לקבלת רשימת הכתובות מכל המחלקות ולמשלוח מסודר לפני ליל הסדר.</p>"""),
 dict(slug="chanukah", nav="מתנות לחנוכה", title="מתנות לחנוכה לעובדים ולקוחות – מארזי שי | נויה במתנה",
  h1="מתנות לחנוכה לעובדים וללקוחות",
  desc="מארזי שי לחנוכה: פמוטים, נרות ריחניים ומפיצי ריח שמאירים את הבית. מארזים בהתאמה אישית לארגונים, מיתוג עם לוגו ומשלוח לכל נמען.",
  lead="חנוכה הוא חג האור – וזו הזדמנות מושלמת למתנה חמה: נרות ריחניים, פמוטים ומפיצי ריח שמאירים את הבית בערבי החורף.",
  cats=["candle", "holder", "diffuser", "decor", "serve", "gift"],
  body="""<p>מארזי חנוכה הם הזדמנות לפנק עובדים ולקוחות באמצע החורף, לקראת סוף השנה האזרחית. נרות סויה ריחניים, פמוטי זכוכית וזהב ומפיצי ריח יוצרים מארז חם ומרגש – בכל תקציב.</p>
<p>רבים מהלקוחות שלנו משלבים את מארז חנוכה עם <a href="/gifts/sof-shana/">מתנה לסוף השנה</a> ללקוחות ולשותפים עסקיים.</p>"""),
 dict(slug="tu-bishvat", nav="מארזי ט״ו בשבט", title="מארזי ט״ו בשבט לעובדים | נויה במתנה",
  h1="מארזי ט״ו בשבט לעובדים",
  desc="מארזי שי לט״ו בשבט לארגונים: עציצים, פריטי עיצוב ירוקים, מגשי עץ ומתנות לבית. מארזים בהתאמה אישית עם מיתוג ומשלוח לכל עובד.",
  lead="ט״ו בשבט הוא חג הטבע והצמיחה – הזדמנות מצוינת למתנה ירוקה, טבעית ומחברת, שמזכירה לעובדים שהארגון צומח איתם.",
  cats=["decor", "serve", "kitchen", "candle", "textile", "holder"],
  body="""<p>למארז ט״ו בשבט מתאימים במיוחד עציצים ופריטי עיצוב, מגשי הגשה מעץ לפירות יבשים, קערות במבוק וכלים טבעיים. אפשר לבנות מארז קטן וסמלי לכל העובדים, או מארז מושקע יותר להנהלה.</p>"""),
 dict(slug="purim", nav="משלוחי מנות לעובדים", title="משלוחי מנות לעובדים בפורים – מארזים לארגונים | נויה במתנה",
  h1="משלוחי מנות ומארזי פורים לעובדים",
  desc="משלוחי מנות ומארזי פורים לארגונים: מארז מעוצב בהתאמה אישית לכל עובד, מיתוג עם לוגו ומשלוח עד הבית. בונים מארז ורואים אותו מיד.",
  lead="בפורים נהוג לשלוח משלוח מנות – ובארגון זו דרך שמחה ולא מחייבת לחזק את הקשר עם העובדים. מארז מעוצב ושימושי עדיף על עוד סל ממתקים שנשכח אחרי יום.",
  cats=["serve", "kitchen", "candle", "decor", "drink", "gift"],
  body="""<p>אנחנו בונים משלוחי מנות לארגונים סביב מוצר שנשאר: מגש הגשה, קערה, סט למטבח או נר ריחני – ואליהם אפשר להוסיף ברכה ממותגת. כל מארז נשלח לכל עובד בנפרד או מגיע מרוכז למשרד.</p>"""),
 dict(slug="sof-shana", nav="מתנות לסוף השנה", title="מתנות לסוף השנה ללקוחות ולשותפים עסקיים | נויה במתנה",
  h1="מתנות לסוף השנה ללקוחות ולשותפים עסקיים",
  desc="מארזי שי לסוף השנה ללקוחות, ספקים ושותפים עסקיים: מארזים יוקרתיים בהתאמה אישית, מיתוג עם לוגו ומשלוח אישי לכל נמען, כולל שליח VIP.",
  lead="סוף השנה הוא הזמן להגיד תודה ללקוחות ולשותפים שליוו אתכם. מארז מושקע וממותג נשאר על השולחן במשרד ומזכיר את העסק שלכם לאורך כל השנה הבאה.",
  cats=["diffuser", "serve", "kitchen", "holder", "drink", "candle"],
  body="""<p>למתנות עסקיות מתאימים במיוחד מפיצי ריח יוקרתיים, סטים למטבח ולאירוח וקרשי הגשה מעץ שיטה – פריטים שנראים מכובדים ומשמשים באמת. עם מיתוג נכון, המתנה הופכת לכרטיס ביקור שנשאר.</p>
<p>ללקוחות VIP ולהנהלה בכירה יש שליח VIP צמוד (₪99 למארז) שמגיע עם המארז עד היד.</p>"""),
 dict(slug="maarazim-memutagim", nav="מארזים ממותגים עם לוגו", title="מארזי שי ממותגים עם לוגו לחברות | נויה במתנה",
  h1="מארזי שי ממותגים עם הלוגו שלכם",
  desc="מארזי מתנה ממותגים לחברות: הלוגו שלכם על הכרטיס, האריזה או המוצר, ברכה אישית ומשלוח לכל נמען. בונים מארז, מעלים לוגו ורואים את התוצאה מיד.",
  lead="מארז ממותג הופך מתנה למסר: כל עובד, לקוח או שותף רואה מי חשב עליו. בבונה המארזים אפשר להעלות את הלוגו ולראות מיד איך הוא נראה על המארז.",
  cats=["diffuser", "holder", "serve", "kitchen", "textile", "candle"],
  body="""<h3>מה אפשר למתג?</h3>
<ul><li>כרטיס ברכה מעוצב עם הלוגו והברכה שלכם</li><li>תגית ואריזה ממותגת</li><li>חריטה על מוצרים נבחרים</li></ul>
<p>מעלים את הלוגו בבונה, בוחרים מוצרים ואריזה, ורואים את המארז הממותג עוד לפני שמזמינים.</p>"""),
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
LINKS = [("מתנות לעובדים", "/gifts/matanot-laovdim/")] + [(f"מארזים עד ₪{b}", f"/gifts/ad-{b}/") for b in (50,100,150,200,250)] + [("הסיפור שלנו", "/about/")] + [(l["nav"], f'/gifts/{l["slug"]}/') for l in LAND[1:]] + \
        [(v, f"/c/{k}/") for k, v in CATS.items() if any(p["cat"] == k for p in P)] + [(g["nav"], f'/guides/{g["slug"]}/') for g in GUIDES]
NAV_LINKS = '<section><h2>עוד מארזים ורעיונות</h2><nav class="links">' + "".join(f'<a href="{u}">{e(n)}</a>' for n, u in LINKS) + "</nav></section>"

def picks(cats, n=12):
    out = []
    for c in cats:
        for p in sorted([p for p in P if p["cat"] == c], key=lambda p: -p.get("stock", 0))[:3]:
            out.append(p)
    return out[:n]

for d in ("p", "c", "gifts", "guides"):
    shutil.rmtree(os.path.join(ROOT, d), ignore_errors=True)

for l in LAND:
    pp = picks(l["cats"])
    faqs = COMMON_FAQ
    body = f"""<h1>{e(l["h1"])}</h1><p class="lead">{e(l["lead"])}</p>
<div class="cta-row"><a class="btn" href="/?cat={l["cats"][0]}">בונים מארז עכשיו ←</a><a class="btn ghost" href="{WA}" target="_blank" rel="noopener">מדברים איתנו בוואטסאפ</a></div>
<ul class="facts"><li>מאז 2024 · 48,000+ מארזים</li><li>600+ חברות וארגונים</li><li>מיתוג עם לוגו</li><li>משלוח אישי לכל נמען</li></ul>
{VIDEO if l["slug"]=="matanot-laovdim" else ""}<div class="prose">{l["body"]}</div>
<h2>מוצרים מומלצים למארז</h2><div class="grid">{"".join(card(p) for p in pp)}</div>
{faq_html(faqs)}"""
    ld = [{"@type": "WebPage", "name": l["title"], "description": l["desc"], "inLanguage": "he"},
          {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f'{SITE}/p/{p["id"]}/'} for i, p in enumerate(pp)]}, faq_ld(faqs)] + ([VIDEO_LD] if l["slug"] == "matanot-laovdim" else [])
    page(f'/gifts/{l["slug"]}/', l["title"], l["desc"], body, ld, [("בונה המארזים", "/"), (l["nav"], f'/gifts/{l["slug"]}/')])

for g in GUIDES:
    body = f'<article class="prose"><h1>{e(g["h1"])}</h1>{g["body"]}<p><b>רוצים לראות את זה בפועל?</b> <a href="/">היכנסו לבונה המארזים</a>, בחרו מוצרים ותראו את המארז שלכם תוך דקה.</p></article>'
    ld = [{"@type": "Article", "headline": g["h1"], "description": g["desc"], "inLanguage": "he", "datePublished": TODAY, "dateModified": TODAY,
           "author": {"@type": "Organization", "name": "נויה במתנה"}, "publisher": {"@id": SITE + "/#business"}, "mainEntityOfPage": f'{SITE}/guides/{g["slug"]}/'}]
    page(f'/guides/{g["slug"]}/', g["title"], g["desc"], body, ld, [("בונה המארזים", "/"), (g["nav"], f'/guides/{g["slug"]}/')])

for k, v in CATS.items():
    pp = [p for p in P if p["cat"] == k]
    if not pp: continue
    title = f"{v} למארזי שי ומתנות לעובדים | נויה במתנה"
    desc = f"{CAT_INTRO[k]} {len(pp)} מוצרים, מחירים לפני מע״מ."
    body = f"""<h1>{e(v)} למארזי שי</h1><p class="lead">{e(CAT_INTRO[k])}</p>
<div class="cta-row"><a class="btn" href="/?cat={k}">בונים מארז עם {e(v)} ←</a></div>
<div class="grid">{"".join(card(p) for p in pp)}</div>"""
    ld = [{"@type": "CollectionPage", "name": title, "description": desc, "inLanguage": "he"},
          {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f'{SITE}/p/{p["id"]}/'} for i, p in enumerate(pp)]}]
    page(f"/c/{k}/", title, desc, body, ld, [("בונה המארזים", "/"), (v, f"/c/{k}/")])

for p in P:
    cat = CATS.get(p["cat"], "מוצרים")
    name = p["name"]
    d = (p.get("desc") or "").strip()
    desc = f"{name}" + (f" – {d}" if d else "") + f". {ils(p['price'])} ליחידה לפני מע״מ, למארזי שי לעובדים וללקוחות – מיתוג עם לוגו ומשלוח אישי לכל נמען."
    img = f'{SITE}/{p["photo"] or p["img"]}'
    rel = [x for x in P if x["cat"] == p["cat"] and x["id"] != p["id"]][:8]
    instock = (p.get("stock") or 0) > 0
    sale = f' <s style="color:#a08a7a;font-size:18px">{ils(p["was"])}</s>' if p.get("was", 0) > p["price"] else ""
    eta = f'<li>מלאי נוסף בדרך</li>' if p.get("incoming") else ""
    body = f"""<div class="hero"><div><h1>{e(name)}</h1>
{f'<p class="lead">{e(d)}</p>' if d else ''}
<div class="price">{ils(p["price"])}{sale} <small>ליחידה · לפני מע״מ</small></div>
<ul class="facts"><li>{e(cat)}</li>{'<li>במלאי</li>' if instock else '<li>בהזמנה מראש</li>'}{'<li>מגיע באריזת מתנה</li>' if p.get('box') else ''}{eta}<li>מיתוג ומשלוח לכל נמען</li></ul>
<div class="cta-row"><a class="btn" href="/?add={p["id"]}">הוסיפו למארז ←</a><a class="btn ghost" href="/c/{p["cat"]}/">עוד {e(cat)}</a></div>
<p style="font-size:15px;color:var(--soft);margin:10px 0 0">בונים מארז מכמה מוצרים, רואים אותו מעוצב ומקבלים הצעת מחיר מיד. מינימום הזמנה ₪3,000 לכל ההזמנה.</p></div>
<img src="/{p["photo"] or p["img"]}" alt="{e(name)}" width="720" height="720"></div>
<h2>עוד {e(cat)} למארז</h2><div class="grid">{"".join(card(x) for x in rel)}</div>"""
    prod = {"@type": "Product", "name": name, "image": [img], "description": desc, "sku": p["id"], "category": cat,
            "brand": {"@type": "Brand", "name": "NOYA"},
            "offers": {"@type": "Offer", "url": f'{SITE}/p/{p["id"]}/', "priceCurrency": "ILS", "price": f'{p["price"]:.2f}',
                       "availability": "https://schema.org/InStock" if instock else "https://schema.org/PreOrder",
                       "itemCondition": "https://schema.org/NewCondition", "seller": {"@id": SITE + "/#business"}}}
    page(f'/p/{p["id"]}/', f"{name} | {cat} למארזי שי – נויה במתנה"[:110], desc[:300], body, [prod],
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
{faq_html(COMMON_FAQ)}"""
    ld = [{"@type": "WebPage", "name": title, "description": desc, "inLanguage": "he"}, faq_ld(COMMON_FAQ)]
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
<ol><li>בונים מארז ב<a href="/">בונה המארזים</a> ורואים אותו מעוצב תוך דקה.</li><li>מורידים הצעת מחיר או מדברים איתנו בוואטסאפ.</li><li>שולחים רשימת כתובות באקסל – ואנחנו אורזים, ממתגים ושולחים.</li></ol>
<h2>האור של אורי</h2>
<p>לזכרו של סמ״ר אורי ג׳רבי הי״ד הקמנו את מארז "האור של אורי". מכל מארז כזה נתרמת ארוחה חמה ליוזמת "האור של אורי" – ועד היום נתרמו 1,869 ארוחות חמות בשווי ₪33,228.</p>
<h2>דברו איתנו</h2>
<p>משה · <a href="tel:0543219070">054-3219070</a> · <a href="mailto:moshe@noyaglobal.com">moshe@noyaglobal.com</a></p></article>"""
page("/about/", ABOUT_T, ABOUT_D, ab, [{"@type": "AboutPage", "name": ABOUT_T, "description": ABOUT_D, "inLanguage": "he"}], [("בונה המארזים", "/"), ("הסיפור שלנו", "/about/")])

# sitemap
pri = lambda u: "1.0" if u == "/" else "0.9" if u.startswith("/gifts/") else "0.8" if u.startswith(("/c/", "/guides/")) else "0.6"
sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for u in ["/"] + URLS:
    sm.append(f"  <url><loc>{SITE}{u}</loc><lastmod>{TODAY}</lastmod><priority>{pri(u)}</priority></url>")
sm.append("</urlset>")
open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write("\n".join(sm) + "\n")
# links block for the builder home page
open(os.path.join(ROOT, "tools", "links.html"), "w", encoding="utf-8").write("".join(f'<a href="{u}">{e(n)}</a>' for n, u in LINKS))
print("pages", len(URLS))
