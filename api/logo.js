// Files the customer attaches while ordering: logo for engraving / greeting card, or an Excel address list.
// POST raw file body, header x-file-name: <encoded name> → {url, name}
// Files are stored under an unguessable path; only the order message carries the link.
import { put } from "@vercel/blob";

const MAX = Math.floor(4.3 * 1024 * 1024); // Vercel function body limit is 4.5 MB
const OK_EXT = /\.(png|jpe?g|webp|svg|pdf|ai|eps|xlsx|xls|csv)$/i; // logos, card designs and address lists
const DAILY_LIMIT = +(process.env.LOGO_DAILY_LIMIT || Infinity);
let day = "", count = 0;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; count = 0; }
  if (++count > DAILY_LIMIT) { res.status(429).json({ error: "daily limit reached" }); return; }
  try {
    let name = "logo";
    try { name = decodeURIComponent(String(req.headers["x-file-name"] || "logo")); } catch (e) {}
    name = name.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, "_").slice(-80) || "logo";
    if (!OK_EXT.test(name)) { res.status(400).json({ error: "file type not allowed" }); return; }
    const chunks = []; let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX) { res.status(413).json({ error: "file too large" }); return; }
      chunks.push(c);
    }
    if (!size) { res.status(400).json({ error: "empty file" }); return; }
    const type = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].replace(/[^a-z0-9.+/-]/gi, "").slice(0, 80) || "application/octet-stream";
    const dir = Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    const blob = await put(`logos/${dir}/${name}`, Buffer.concat(chunks), { access: "public", contentType: type, addRandomSuffix: false });
    res.status(200).json({ url: blob.url, name });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
