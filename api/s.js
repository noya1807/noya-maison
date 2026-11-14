// Shared gift-box page: shows the image and gives WhatsApp / social apps a large link preview.
// GET /s/<id> (rewritten to ?id=<id>) or the older ?i=<image URL in this project's Blob storage>
import { head } from "@vercel/blob";
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function hasBox(q) {
  const id = String(q?.id || "");
  if (!/^[a-z0-9]{6,24}$/.test(id)) return "";
  try { await head(`share/${id}.json`); return id; } catch (e) { return ""; }
}

async function imageFor(q) {
  const id = String(q?.id || "");
  if (/^[a-z0-9]{6,24}$/.test(id)) {
    for (const ext of ["jpg", "png", "webp"]) { try { return (await head(`share/${id}.${ext}`)).url; } catch (e) {} }
    return "";
  }
  return String(q?.i || "");
}

export default async function handler(req, res) {
  const [img, boxId] = await Promise.all([imageFor(req.query), hasBox(req.query)]);
  const ok = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/share\/[a-z0-9]+\.(jpg|png|webp)$/i.test(img);
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const home = `https://${host}/`;
  if (!ok) { res.status(404).setHeader("Content-Type", "text/html; charset=utf-8"); res.end(`<!DOCTYPE html><meta charset="utf-8"><p style="font-family:sans-serif;text-align:center;margin-top:20vh">התמונה לא נמצאה. <a href="${home}">לבניית מארז</a></p>`); return; }
  const title = "המארז שבניתי ב-נויה במתנה ✨";
  const desc = "מארז מתנה בעיצוב אישי. בחרו מוצרים, ונויה תעצב לכם מארז משלכם.";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1280"><meta property="og:image:alt" content="תמונת מארז מתנה">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">
<link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500&family=Assistant:wght@400;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#f7efe4;color:#4a2f22;font-family:Assistant,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px 16px 40px}
h1{font-family:"Frank Ruhl Libre",Georgia,serif;font-weight:500;font-size:26px;margin:6px 0 0;text-align:center}
img{width:min(960px,100%);border-radius:18px;box-shadow:0 12px 32px rgba(74,47,34,.18)}
.btns{display:flex;flex-direction:column;gap:10px;width:min(480px,100%)}
a{display:block;width:min(480px,100%);box-sizing:border-box;text-align:center;color:#fffaf3;text-decoration:none;border-radius:14px;padding:16px 22px;font-family:"Frank Ruhl Libre",Georgia,serif;font-size:21px;font-weight:500;background:linear-gradient(135deg,#3f271c,#6e4d3b 55%,#b08a4f);box-shadow:0 10px 24px rgba(74,47,34,.28)}
a.alt{background:#fffaf3;color:#4a2f22;border:1px solid #e2d3c0;box-shadow:none;font-size:18px;padding:13px 22px}
p{margin:0;color:#7a5a48;text-align:center}</style></head>
<body><h1>${esc(title)}</h1><p>${esc(desc)}</p><img src="${esc(img)}" alt="תמונת מארז מתנה"><div class="btns">${boxId ? `<a href="${home}?box=${boxId}">אני רוצה את המארז הזה ✨</a><a class="alt" href="${home}">עצבו מארז משלכם</a>` : `<a href="${home}">עצבו את המארז שלכם ✨</a>`}</div></body></html>`);
}
