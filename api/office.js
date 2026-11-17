// NOYA Back Office (private) — the owner's own data: SKUs, costs, suppliers, containers and import documents.
// Everything here is behind the ADMIN_PASSWORD login (HttpOnly session cookie) and is stored ENCRYPTED
// (AES-256-GCM) in Vercel Blob, so even a leaked blob URL reveals nothing. Customers never touch this endpoint.
//
// POST ?a=login  {password}          → sets the session cookie
// POST ?a=logout                     → clears it
// GET  ?a=me                         → {ok}
// GET  ?a=data                       → {db, rev}
// PUT  ?a=data   {db, baseRev}       → {rev}   (409 if another tab saved in between)
// POST ?a=upload (raw file body, headers x-file-name, x-folder) → {doc:{url,name,size,type}}
// GET  ?a=file&url=...&name=...      → the decrypted file
// POST ?a=delfile {url}              → deletes an uploaded document
//
// Encryption key: OFFICE_KEY if set, otherwise derived from the store's BLOB_READ_WRITE_TOKEN.
// (If you ever rotate the blob token, set OFFICE_KEY to the OLD token first, or export a backup before.)
import { put, list, del } from "@vercel/blob";
import crypto from "node:crypto";

const DB_PREFIX = "office/db/";
const DOC_PREFIX = "office/docs/";
const KEEP_VERSIONS = 30;                         // older database versions are pruned (they double as history)
const MAX_FILE = Math.floor(4.3 * 1024 * 1024);   // Vercel function body limit is 4.5 MB
const SESSION_HOURS = 12;
const COOKIE = "noya_office";

const secretBase = () => process.env.OFFICE_KEY || process.env.BLOB_READ_WRITE_TOKEN || "";
const dataKey = () => crypto.createHash("sha256").update("noya-office-data-v1:" + secretBase()).digest();
const sessKey = () => crypto.createHash("sha256").update("noya-office-sess-v1:" + (process.env.ADMIN_PASSWORD || "") + ":" + secretBase()).digest();

const MAGIC = Buffer.from("NOYA1");
function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", dataKey(), iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), enc]);
}
function decrypt(buf) {
  if (buf.length < 33 || !buf.subarray(0, 5).equals(MAGIC)) throw new Error("bad file");
  const d = crypto.createDecipheriv("aes-256-gcm", dataKey(), buf.subarray(5, 17));
  d.setAuthTag(buf.subarray(17, 33));
  return Buffer.concat([d.update(buf.subarray(33)), d.final()]);
}

const b64u = b => Buffer.from(b).toString("base64url");
function makeToken() {
  const body = b64u(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600e3, n: crypto.randomBytes(6).toString("hex") }));
  return body + "." + crypto.createHmac("sha256", sessKey()).update(body).digest("base64url");
}
function validToken(t) {
  if (!t || typeof t !== "string" || !t.includes(".")) return false;
  const [body, sig] = t.split(".");
  const good = crypto.createHmac("sha256", sessKey()).update(body).digest("base64url");
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now(); } catch (e) { return false; }
}
const cookieOf = req => Object.fromEntries(String(req.headers.cookie || "").split(";").map(s => s.trim().split("=")).filter(p => p[0]).map(([k, ...v]) => [k, v.join("=")]));
const setCookie = (res, val, maxAge) => res.setHeader("Set-Cookie", `${COOKIE}=${val}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
const authed = req => !!process.env.ADMIN_PASSWORD && validToken(cookieOf(req)[COOKIE]);

function samePassword(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
// soft brute-force guard (per server instance) + a delay on every wrong password
let fails = [], lockUntil = 0;

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = []; for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString(); return s ? JSON.parse(s) : {};
}
async function readRaw(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_FILE) throw Object.assign(new Error("too big"), { code: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}

async function dbVersions() {
  const out = []; let cursor;
  do { const r = await list({ prefix: DB_PREFIX, cursor, limit: 1000 }); out.push(...r.blobs); cursor = r.hasMore ? r.cursor : null; } while (cursor);
  return out.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}
async function readDb() {
  const v = await dbVersions();
  if (!v.length) return { db: null, rev: "" };
  const r = await fetch(v[0].url, { cache: "no-store" });
  if (!r.ok) throw new Error("db read " + r.status);
  return { db: JSON.parse(decrypt(Buffer.from(await r.arrayBuffer())).toString()), rev: v[0].pathname };
}
const blobUrlOk = u => { try { const x = new URL(u); return x.protocol === "https:" && x.hostname.endsWith(".blob.vercel-storage.com") && x.pathname.startsWith("/" + DOC_PREFIX); } catch (e) { return false; } };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  const a = String(req.query?.a || "");
  try {
    if (!process.env.ADMIN_PASSWORD) { res.status(500).json({ error: "ADMIN_PASSWORD לא מוגדר בשרת" }); return; }

    if (a === "login" && req.method === "POST") {
      const now = Date.now();
      if (now < lockUntil) { res.status(429).json({ error: "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות." }); return; }
      const { password } = await readBody(req);
      if (!password || !samePassword(password, process.env.ADMIN_PASSWORD)) {
        fails = fails.filter(t => now - t < 15 * 60e3); fails.push(now);
        if (fails.length >= 8) { lockUntil = now + 15 * 60e3; fails = []; }
        await new Promise(r => setTimeout(r, 800));
        res.status(401).json({ error: "הסיסמה שגויה" }); return;
      }
      fails = []; setCookie(res, makeToken(), SESSION_HOURS * 3600);
      res.status(200).json({ ok: true }); return;
    }
    if (a === "logout") { setCookie(res, "", 0); res.status(200).json({ ok: true }); return; }
    if (!authed(req)) { res.status(401).json({ error: "צריך להתחבר" }); return; }
    if (a === "me") { res.status(200).json({ ok: true }); return; }

    if (a === "data" && req.method === "GET") { res.status(200).json(await readDb()); return; }
    if (a === "data" && req.method === "PUT") {
      const { db, baseRev } = await readBody(req);
      if (!db || typeof db !== "object" || !Array.isArray(db.products) || !Array.isArray(db.shipments)) { res.status(400).json({ error: "bad data" }); return; }
      const versions = await dbVersions();
      const cur = versions[0]?.pathname || "";
      if ((baseRev || "") !== cur) { res.status(409).json({ error: "הנתונים עודכנו בחלון אחר. רעננו את הדף." }); return; }
      db.savedAt = new Date().toISOString();
      const blob = await put(DB_PREFIX + "db.bin", encrypt(Buffer.from(JSON.stringify(db))), { access: "public", contentType: "application/octet-stream", addRandomSuffix: true });
      const old = versions.slice(KEEP_VERSIONS - 1).map(b => b.url);
      if (old.length) await del(old).catch(() => {});
      res.status(200).json({ rev: blob.pathname, savedAt: db.savedAt }); return;
    }

    if (a === "upload" && req.method === "POST") {
      let name = "file";
      try { name = decodeURIComponent(String(req.headers["x-file-name"] || "file")); } catch (e) {}
      name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(-120) || "file";
      const folder = String(req.headers["x-folder"] || "misc").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "misc";
      const raw = await readRaw(req);
      if (!raw.length) { res.status(400).json({ error: "קובץ ריק" }); return; }
      const blob = await put(`${DOC_PREFIX}${folder}/${crypto.randomBytes(9).toString("hex")}.bin`, encrypt(raw), { access: "public", contentType: "application/octet-stream", addRandomSuffix: true });
      res.status(200).json({ doc: { url: blob.url, name, size: raw.length, type: String(req.headers["content-type"] || "application/octet-stream").slice(0, 80), uploadedAt: new Date().toISOString() } });
      return;
    }
    if (a === "file" && req.method === "GET") {
      const url = String(req.query.url || "");
      if (!blobUrlOk(url)) { res.status(400).json({ error: "bad url" }); return; }
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) { res.status(404).json({ error: "הקובץ לא נמצא" }); return; }
      const buf = decrypt(Buffer.from(await r.arrayBuffer()));
      const name = String(req.query.name || "file").replace(/[\r\n"]/g, "").slice(0, 120);
      const type = /^[\w.+-]+\/[\w.+-]+$/.test(String(req.query.type || "")) ? String(req.query.type) : "application/octet-stream";
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Disposition", `${req.query.dl ? "attachment" : "inline"}; filename="file"; filename*=UTF-8''${encodeURIComponent(name)}`);
      res.status(200).send(buf); return;
    }
    if (a === "delfile" && req.method === "POST") {
      const { url } = await readBody(req);
      if (!blobUrlOk(url)) { res.status(400).json({ error: "bad url" }); return; }
      await del(url); res.status(200).json({ ok: true }); return;
    }
    res.status(404).json({ error: "unknown action" });
  } catch (e) {
    res.status(e.code === 413 ? 413 : 500).json({ error: e.code === 413 ? "הקובץ גדול מ-4.3MB" : String(e.message || e).slice(0, 200) });
  }
}
