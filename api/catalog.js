// NOYA catalogue storage (Vercel Blob). GET is public; saving needs the ADMIN_PASSWORD (header x-admin-key).
// GET            → {catalog} (null until the first save; the app then uses its built-in catalogue)
// GET ?auth=1    → 200 if the password is right
// POST ?upload=id {orig: dataURL}  → {url}   (original photo of a new product, used by the AI designer)
// PUT {catalog}  → saves the whole catalogue
import { put, list } from "@vercel/blob";

const KEY = "catalog/catalog.json";
const authed = req => !!process.env.ADMIN_PASSWORD && req.headers["x-admin-key"] === process.env.ADMIN_PASSWORD;

export async function readCatalog() {
  const { blobs } = await list({ prefix: KEY, limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url + "?t=" + Date.now(), { cache: "no-store" });
  return r.ok ? r.json() : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      if (req.query?.auth) { res.status(authed(req) ? 200 : 401).json({ ok: authed(req) }); return; }
      res.status(200).json({ catalog: await readCatalog() });
      return;
    }
    if (!authed(req)) { res.status(401).json({ error: "סיסמת מנהל שגויה" }); return; }
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (req.method === "POST" && req.query?.upload) {
      const id = String(req.query.upload).replace(/[^a-z0-9]/gi, "").slice(0, 20);
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(body.orig || "");
      if (!id || !m) { res.status(400).json({ error: "bad image" }); return; }
      const blob = await put(`orig/${id}.${m[1] === "jpeg" ? "jpg" : m[1]}`, Buffer.from(m[2], "base64"),
        { access: "public", contentType: `image/${m[1]}`, addRandomSuffix: false, allowOverwrite: true });
      res.status(200).json({ url: blob.url });
      return;
    }
    if (req.method === "PUT") {
      const c = body.catalog;
      if (!c || !Array.isArray(c.products) || !Array.isArray(c.packs)) { res.status(400).json({ error: "bad catalogue" }); return; }
      await put(KEY, JSON.stringify(c), { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
