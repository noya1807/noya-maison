// Share a finished gift-box image (e.g. on WhatsApp) to consult before ordering.
// POST {image: dataURL (jpeg/png/webp, ≤ 3 MB)} → {url: short page link /s/<id> with a rich link preview, image: direct image URL}
// GET ?ping=1 → {ok}
// The box "recipe" (products, quantities, packaging, background) is saved next to the image, so the shared
// page can offer "I want this box": GET ?box=<id> → {box:{items,pack,bg,variant,image}}
import { put, head } from "@vercel/blob";

const txt = v => String(v || "").replace(/[<>\u0000-\u001f]/g, "").slice(0, 120);
const num = v => { const n = Math.round((+v || 0) * 100) / 100; return n > 0 && n < 1e6 ? n : 0; };
const cleanBox = (b, nested) => {
  if (!b || typeof b !== "object") return null;
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40)
    .filter(x => Array.isArray(x) && /^[a-z0-9]{1,24}$/i.test(String(x[0])))
    .map(x => [String(x[0]), Math.max(1, Math.min(99, Math.round(+x[1] || 1)))]);
  if (!items.length) return null;
  const tag = v => (/^[a-z0-9_-]{1,16}$/i.test(String(v || "")) ? String(v) : "");
  return { items, pack: tag(b.pack), bg: tag(b.bg), variant: Math.max(0, Math.min(99, Math.round(+b.variant || 0))),
    mode: b.mode === "spread" || b.mode === "order" ? b.mode : "consult", boxes: Math.max(1, Math.min(100000, Math.round(+b.boxes || 1))),
    // names and prices as shown when the box was shared, for the order card Noya opens after an approval
    names: Object.fromEntries(items.map(([id]) => [id, txt(b.names?.[id])])), prices: Object.fromEntries(items.map(([id]) => [id, num(b.prices?.[id])])),
    packName: txt(b.packName), per: num(b.per),
    // a multi-type order (עובדים / הנהלה / לקוחות): every box type, so the approver approves the whole order
    ...(!nested && Array.isArray(b.types) && b.types.length > 1 ? { types: b.types.slice(0, 6).map(t => { const c = cleanBox(t, true); return c ? { name: txt(t.name).slice(0, 18), ...c } : null; }).filter(Boolean) } : {}) };
};

const DAILY_LIMIT = +(process.env.SHARE_DAILY_LIMIT || 500);
let day = "", count = 0;

export default async function handler(req, res) {
  if (req.method === "GET") {
    const bid = String(req.query?.box || "");
    if (!bid) { res.status(200).json({ ok: !!process.env.BLOB_READ_WRITE_TOKEN }); return; }
    if (!/^[a-z0-9]{6,24}$/.test(bid)) { res.status(400).json({ error: "bad id" }); return; }
    try {
      const meta = await head(`share/${bid}.json`);
      const r = await fetch(meta.url);
      if (!r.ok) throw new Error("not found");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.status(200).json({ box: await r.json() });
    } catch (e) { res.status(404).json({ error: "not found" }); }
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; count = 0; }
  if (++count > DAILY_LIMIT) { res.status(429).json({ error: "daily limit reached" }); return; }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(body.image || "");
    if (!m) { res.status(400).json({ error: "bad image" }); return; }
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 3 * 1024 * 1024) { res.status(413).json({ error: "image too large" }); return; }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const blob = await put(`share/${id}.${ext}`, buf, { access: "public", contentType: `image/${m[1]}`, addRandomSuffix: false });
    const box = cleanBox(body.box);
    if (box) await put(`share/${id}.json`, JSON.stringify({ ...box, image: blob.url }), { access: "public", contentType: "application/json", addRandomSuffix: false });
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const page = `https://${host}/s/${id}`; // short link: previews more reliably in WhatsApp
    res.status(200).json({ url: page, image: blob.url });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
