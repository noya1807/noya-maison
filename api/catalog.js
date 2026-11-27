// NOYA catalogue storage (Vercel Blob). GET is public; saving needs an admin: the back-office session cookie
// (preferred), or the old x-admin-key header (transitional, rate-limited) — see _auth.js.
// GET            → {catalog} (null until the first save; the app then uses its built-in catalogue)
// GET ?auth=1    → 200 if the caller is an admin
// POST ?upload=id {orig: dataURL}  → {url}   (original photo of a new product, used by the AI designer)
// PUT {catalog}  → saves the whole catalogue
import { put, list } from "@vercel/blob";
import { adminOk } from "./_auth.js";

const KEY = "catalog/catalog.json";

// Public URL of a blob at a fixed path, built from the store id inside the token. Reading it this way costs
// no Blob "operation" (only data transfer) — unlike list(), which counts as an advanced operation.
export const blobHost = () => { const id = (process.env.BLOB_READ_WRITE_TOKEN || "").split("_")[3] || ""; return id ? `https://${id.toLowerCase()}.public.blob.vercel-storage.com/` : ""; };
export async function readCatalog() {
  const host = blobHost();
  if (host) {
    const r = await fetch(host + KEY + "?t=" + Math.floor(Date.now() / 30000), { cache: "no-store" });
    if (r.status === 404) return null;
    if (r.ok) return r.json();
  }
  const { blobs } = await list({ prefix: KEY, limit: 1 });   // fallback only
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url + "?t=" + Date.now(), { cache: "no-store" });
  return r.ok ? r.json() : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      if (req.query?.auth) { const a = await adminOk(req); res.status(a.ok ? 200 : a.status).json({ ok: a.ok, ...(a.ok ? {} : { error: a.error }) }); return; }
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");   // edge-cached: one read per minute, not per visitor
      res.status(200).json({ catalog: await readCatalog() });
      return;
    }
    { const a = await adminOk(req); if (!a.ok) { res.status(a.status).json({ error: a.error }); return; } }
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
