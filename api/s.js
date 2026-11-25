// Shared gift-box page: shows the image and gives WhatsApp / social apps a large link preview.
// GET /s/<id> (rewritten to ?id=<id>) or the older ?i=<image URL in this project's Blob storage>
import { head } from "@vercel/blob";
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function boxFor(q) { // {id, box} when the box "recipe" was saved next to the image
  const id = String(q?.id || "");
  if (!/^[a-z0-9]{6,24}$/.test(id)) return null;
  try { const m = await head(`share/${id}.json`); const r = await fetch(m.url); return { id, box: r.ok ? await r.json() : {} }; } catch (e) { return null; }
}
const NOYA_WA = "972543219070";

async function imageFor(q) {
  const id = String(q?.id || "");
  if (/^[a-z0-9]{6,24}$/.test(id)) {
    for (const ext of ["jpg", "png", "webp"]) { try { return (await head(`share/${id}.${ext}`)).url; } catch (e) {} }
    return "";
  }
  return String(q?.i || "");
}

export default async function handler(req, res) {
  const [img, bx] = await Promise.all([imageFor(req.query), boxFor(req.query)]);
  const boxId = bx?.id || "", approve = !!boxId && bx.box?.mode !== "spread", nBoxes = Math.max(1, Math.round(+bx?.box?.boxes || 1));
  const ok = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/share\/[a-z0-9]+\.(jpg|png|webp)$/i.test(img);
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const home = `https://${host}/`;
  if (!ok) { res.status(404).setHeader("Content-Type", "text/html; charset=utf-8"); res.end(`<!DOCTYPE html><meta charset="utf-8"><p style="font-family:sans-serif;text-align:center;margin-top:20vh">התמונה לא נמצאה. <a href="${home}">לבניית מארז</a></p>`); return; }
  const page = `https://${host}/s/${boxId}`;
  const title = approve ? "מארז מתנה לאישורך ✨" : "המארז שבניתי ב-נויה במתנה ✨";
  const desc = approve ? "הוכן עבורכם מארז מתנה בעיצוב אישי. מאשרים ומזמינים בלחיצה אחת." : "מארז מתנה בעיצוב אישי. בחרו מוצרים, ונויה תעצב לכם מארז משלכם.";
  const b = bx?.box || {}, items = Array.isArray(b.items) ? b.items : [];
  const ils = n => "₪" + (+n).toLocaleString("he-IL", { maximumFractionDigits: 2 });
  const per = +b.per || 0, total = per ? Math.round(per * nBoxes * 100) / 100 : 0;
  const lines = items.map(([id, q]) => `• ${b.names?.[id] || id}${q > 1 ? ` × ${q}` : ""}`).join("\n");
  const waText = `✅ מארז אושר – אשמח לקבל הצעת מחיר מסודרת\n${lines}\nאריזה: ${b.packName || "—"}\n${per ? `מחיר למארז: ${ils(per)} (לפני מע״מ)\n` : ""}כמות: ${nBoxes} מארזים${total ? ` · סה״כ: ${ils(total)} (לפני מע״מ)` : ""}\n\nלפתיחת המארז והפקת הצעת מחיר:\n${home}?box=${boxId}&go=sum`;
  // the approver orders straight away: the builder opens on the order page with this box and quantity
  const approveBtn = `<a class="ok" href="${home}?box=${boxId}&go=sum">מאשר ומזמין ✓</a>`;
  if (boxId && b.mode === "order") { // order card for Noya: the picture with all the order details, nothing else
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-cache");
    res.end(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>כרטיס הזמנה – נויה במתנה</title><meta property="og:title" content="כרטיס הזמנה – נויה במתנה"><meta property="og:description" content="תמונת המארז עם כל פרטי ההזמנה">
<meta property="og:image" content="${esc(img)}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<style>body{margin:0;background:#f7efe4;display:flex;justify-content:center;padding:12px}img{width:min(760px,100%);height:auto;border-radius:12px;box-shadow:0 10px 26px rgba(74,47,34,.16)}</style></head>
<body><img src="${esc(img)}" alt="כרטיס הזמנה"></body></html>`);
    return;
  }
  if (boxId && req.query?.v === "noya") { // order card for Noya after a customer approved: details only, no approve button
    const rows = items.map(([id, q]) => { const pr = +b.prices?.[id] || 0;
      return `<tr><td>${esc(b.names?.[id] || id)}<small>${esc(id)}</small></td><td>${q}</td><td>${pr ? esc(ils(pr)) : "—"}</td></tr>`; }).join("");
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-cache");
    res.end(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>כרטיס הזמנה – מארז שאושר</title>
<link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500&family=Assistant:wght@400;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#f7efe4;color:#4a2f22;font-family:Assistant,Arial,sans-serif;padding:20px 14px 40px;display:flex;flex-direction:column;align-items:center;gap:14px}
.w{width:min(760px,100%);display:flex;flex-direction:column;gap:14px}h1{font-family:"Frank Ruhl Libre",Georgia,serif;font-weight:500;font-size:26px;margin:0;text-align:center}
img{width:100%;border-radius:16px;box-shadow:0 10px 26px rgba(74,47,34,.16)}.card{background:#fffaf3;border:1px solid #e2d3c0;border-radius:16px;padding:14px 16px}
table{width:100%;border-collapse:collapse;font-size:17px}th,td{text-align:right;padding:8px 6px;border-bottom:1px solid #eee2d2;vertical-align:top}th{font-size:14px;color:#7a5a48}td small{display:block;color:#a08670;font-size:12px}
.sum{display:grid;grid-template-columns:1fr auto;gap:6px 12px;font-size:17px}.sum b{font-size:19px}.note{font-size:13px;color:#7a5a48;margin:6px 0 0}
a{display:block;text-align:center;text-decoration:none;border-radius:14px;padding:15px 20px;font-size:19px;font-weight:700;color:#fffaf3;background:linear-gradient(135deg,#3f271c,#6e4d3b 55%,#b08a4f)}a.alt{background:#fffaf3;color:#4a2f22;border:1px solid #e2d3c0;font-weight:400}</style></head>
<body><div class="w"><h1>✅ מארז שאושר – כרטיס הזמנה</h1><img src="${esc(img)}" alt="תמונת המארז">
<div class="card"><table><tr><th>מוצר</th><th>כמות במארז</th><th>מחיר ליחידה</th></tr>${rows}</table></div>
<div class="card sum"><span>אריזה</span><span>${esc(b.packName || "—")}</span><span>מחיר למארז</span><span>${per ? esc(ils(per)) : "בהצעת מחיר"}</span><span>כמות מארזים</span><span>${nBoxes}</span>${total ? `<b>סה״כ לפני מע״מ</b><b>${esc(ils(total))}</b>` : ""}
<p class="note" style="grid-column:1/-1">המחירים כפי שהוצגו ללקוח בזמן השיתוף, לפני מע״מ.</p></div>
<a href="${home}?box=${boxId}">פתיחה בבונה (עריכה, הצעת מחיר PDF והזמנה)</a><a class="alt" href="${esc(img)}" download>הורדת התמונה</a></div></body></html>`);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache"); // always fresh, so new buttons show up on links opened before
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
p{margin:0;color:#7a5a48;text-align:center}
a.ok{background:linear-gradient(135deg,#1f7a4d,#25a85f);font-size:22px}
p.small{font-size:14px}</style></head>
<body><h1>${esc(title)}</h1><p>${esc(desc)}</p><img src="${esc(img)}" alt="תמונת מארז מתנה"><div class="btns">${approve ? `${approveBtn}<a class="alt" href="${home}?box=${boxId}">לצפייה ועריכה של המארז</a><p class="small">המחירים לפני מע"מ · המחיר הסופי, משלוח ומיתוג יאושרו מול נציג</p>` : boxId ? `<a href="${home}?box=${boxId}">אני רוצה את המארז הזה ✨</a><a class="alt" href="${home}">עצבו מארז משלכם</a>` : `<a href="${home}">עצבו את המארז שלכם ✨</a>`}</div></body></html>`);
}
