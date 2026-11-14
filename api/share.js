// Share a finished gift-box image (e.g. on WhatsApp) to consult before ordering.
// POST {image: dataURL (jpeg/png/webp, ≤ 3 MB)} → {url: page with a rich link preview, image: direct image URL}
// GET ?ping=1 → {ok}
import { put } from "@vercel/blob";

const DAILY_LIMIT = +(process.env.SHARE_DAILY_LIMIT || 500);
let day = "", count = 0;

export default async function handler(req, res) {
  if (req.method === "GET") { res.status(200).json({ ok: !!process.env.BLOB_READ_WRITE_TOKEN }); return; }
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
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const page = `https://${host}/api/s?i=${encodeURIComponent(blob.url)}`;
    res.status(200).json({ url: page, image: blob.url });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
