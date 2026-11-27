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
// POST ?a=inbox  {order}             → PUBLIC: the gift-box builder drops a new order here (stored encrypted)
// GET  ?a=inbox                      → orders waiting to be pulled into the back office
// POST ?a=inboxdone {urls}           → removes inbox orders after the back office saved them
// POST ?a=extract {url,type} | {text,name} → AI reads a proforma / packing list / invoice and returns structured lines
// GET  ?a=showcase                   → PUBLIC: the builder's rotating "boxes built with us" (not secret, stored plain)
// PUT  ?a=showcase {list}            → saves that list (owner only)
// POST ?a=showcaseimg {image}        → stores one showcase photo (dataURL, JPEG) → {url}
// GET  ?a=jackpot                    → PUBLIC: meals donated through the slot machine (777) → {meals, perWin}
// POST ?a=spin                       → PUBLIC: the server decides if this pull is a 777 (1 in 777, at most one per week) → {jackpot, id}
// POST ?a=spinshown {id} | spinvoid {id} → PUBLIC: the builder showed it / could not show it in time
// GET  ?a=jackpots                   → owner: all 777s; POST ?a=jackpotdone {id} → donation sent (+21 meals); POST ?a=jackpotdel {id}
//
// Encryption key: OFFICE_KEY if set, otherwise derived from the store's BLOB_READ_WRITE_TOKEN.
// (If you ever rotate the blob token, set OFFICE_KEY to the OLD token first, or export a backup before.)
import { put, list, del } from "@vercel/blob";
import { blobHost } from "./catalog.js";
import crypto from "node:crypto";

const DB_PREFIX = "office/db/";
const DOC_PREFIX = "office/docs/";
const INBOX_PREFIX = "office/inbox/";
const SHOW_PREFIX = "public/showcase/";
const INBOX_DAILY = +(process.env.INBOX_DAILY_LIMIT || Infinity);
let inboxDay = "", inboxCount = 0;
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

// ---------- AI extraction of import documents (uses the OPENAI_API_KEY already set for the designer) ----------
export const config = { maxDuration: 300 };
const EXTRACT_MODELS = [...new Set([process.env.OPENAI_EXTRACT_MODEL, "gpt-5-mini", "gpt-4.1"].filter(Boolean))];
const nn = t => ({ type: [t, "null"] });
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["docType", "supplier", "orderNo", "date", "currency", "incoterm", "items", "extraCosts", "goodsTotal", "grandTotal", "deposit", "totalCartons", "totalCbm", "notes"],
  properties: {
    docType: { type: "string", description: "proforma | commercial_invoice | packing_list | bill_of_lading | customs | freight_invoice | other" },
    supplier: nn("string"), orderNo: nn("string"), date: { ...nn("string"), description: "YYYY-MM-DD" },
    currency: { ...nn("string"), description: "ISO code of the prices, e.g. USD, CNY, EUR, ILS" },
    incoterm: nn("string"),
    items: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["itemNo", "name", "size", "qty", "unitPrice", "amount", "isSet", "setParts", "pcsPerCarton", "cartons", "cbm", "packing"],
      properties: {
        itemNo: nn("string"), name: { type: "string" }, size: nn("string"),
        qty: { ...nn("number"), description: "quantity of priced units (for a set: number of sets)" },
        unitPrice: nn("number"), amount: nn("number"),
        isSet: { type: "boolean", description: "true when several items share ONE unit price/amount (sold together as a set)" },
        setParts: { type: "array", items: { type: "string" }, description: "the parts of the set, e.g. ['small 19cm','big 25cm']" },
        pcsPerCarton: nn("number"), cartons: nn("number"), cbm: nn("number"), packing: nn("string") } } },
    extraCosts: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "amount", "currency"],
      properties: { label: { type: "string" }, amount: { type: "number" }, currency: nn("string") } },
      description: "charges outside the goods lines: freight to port, service fees, bank fees, etc. NOT deposits" },
    goodsTotal: nn("number"), grandTotal: nn("number"), deposit: nn("number"),
    totalCartons: nn("number"), totalCbm: nn("number"),
    notes: { type: "array", items: { type: "string" }, description: "short Hebrew notes about anything unusual or unclear" } } };
const EXTRACT_PROMPT = `You read import documents for an Israeli gift company (proforma invoices, commercial invoices, packing lists, customs and freight papers).
Extract every goods line exactly as written. Rules:
- When one unit price and amount cover two or more rows (e.g. a small and a big size priced together), return ONE item with isSet=true, the shared qty/unitPrice/amount, and the parts in setParts. Sum their cartons and CBM.
- Numbers as plain numbers (no currency symbols or thousands separators). Use null when a value is missing.
- Keep the supplier's own item number in itemNo and a clear English or Hebrew product name in name.
- extraCosts: freight, service/platform fees, bank charges and similar listed outside the goods lines. Never include the deposit there; put it in deposit.
- notes: short Hebrew remarks, e.g. totals that do not add up or anything you were unsure about.`;
async function extractWithAI(content) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY לא מוגדר בשרת");
  let last;
  for (const model of EXTRACT_MODELS) {
    const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: [{ role: "user", content: [...content, { type: "input_text", text: EXTRACT_PROMPT }] }],
        text: { format: { type: "json_schema", name: "import_document", strict: true, schema: SCHEMA } } }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const txt = j.output_text || (j.output || []).flatMap(o => o.content || []).find(c => c.type === "output_text")?.text;
      if (!txt) throw new Error("ה-AI לא החזיר תשובה");
      return { ...JSON.parse(txt), model };
    }
    last = j?.error?.message || `OpenAI ${r.status}`;
    if (!(r.status === 404 || /model/i.test(last))) break;   // only fall back to the next model when the model itself is the problem
  }
  throw new Error(last);
}

const SHOW_CURRENT = SHOW_PREFIX + "current.json";   // fixed path → read by URL, no Blob operation
// ---- 777 on the slot machine → Noya donates 21 hot meals to "האור של אורי" (the owner marks each one as sent; the public counter shows only sent ones)
const JACK_CUR = "public/jackpot/state.json", JACK_ODDS = +(process.env.JACKPOT_ODDS || 777), JACK_GAP = 7 * 24 * 3600e3, JACK_MEALS = 21;
let spinDay = "", spinIp = new Map();
async function readJack() {
  const host = blobHost();
  if (host) { try { const r = await fetch(host + JACK_CUR + "?t=" + Date.now(), { cache: "no-store" }); if (r.ok) { const j = await r.json(); return { meals: +j.meals || 0, wins: Array.isArray(j.wins) ? j.wins : [] }; } } catch (e) {} }
  return { meals: 0, wins: [] };
}
// e-mail alert to the owner (Resend). Needs RESEND_API_KEY in Vercel; NOTIFY_EMAIL / NOTIFY_FROM are optional.
async function notify(subject, html) {
  const key = process.env.RESEND_API_KEY; if (!key) return { ok: false, error: "no key" };
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.NOTIFY_FROM || "מכונת המארזים של נויה <onboarding@resend.dev>", to: [process.env.NOTIFY_EMAIL || "moshe@noyaglobal.com"], subject, html }) });
    const j = await r.json().catch(() => ({})); return r.ok ? { ok: true } : { ok: false, error: j.message || ("status " + r.status) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
const jackMail = (w, test) => notify((test ? "בדיקה: " : "") + "🎰 יצא 777 במכונת המארזים – 21 ארוחות ל\"האור של אורי\"",
  `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#3f271c">
   <p>💜 <b>יצאו שלושה 7 במכונת המארזים${test ? " (מייל בדיקה)" : ""}</b></p>
   <p>הלקוח ראה את ההודעה שנויה במתנה תעביר <b>21 ארוחות חמות</b> למיזם "האור של אורי".</p>
   <p>זמן: ${new Date(w.at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</p>
   <p>אחרי שהעברת את התרומה: ממשק הניהול ← הזמנות ← "✓ העברנו את התרומה". רק אז המונה באתר עולה ב-21.</p></div>`);
// e-mail to the owner on every new order / quote from the builder (same Resend key as the 777 alert)
const mailedRefs = new Set();
const escH = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function orderMail(o) {
  const c = o.customer || {}, q = o.kind === "quote", n = Math.max(1, +o.boxes || 1);
  const goods = Math.round((+o.perBox || 0) * n);
  const who = [c.name, c.org].filter(Boolean).join(" · ") || "לקוח", ag = o.agent ? ` · ${String(o.agent).slice(0, 40)}` : "";
  const types = Array.isArray(o.types) && o.types.length > 1 ? o.types.map(t => `${escH(t.name)}: ${+t.boxes || 0} מארזים`).join(" | ") : "";
  return notify(`${q ? "📝 הצעת מחיר" : "🛒 הזמנה חדשה"} ${o.ref} – ${who}${ag} · ${n} מארזים${goods ? ` · ₪${goods.toLocaleString("he-IL")} לפני מע״מ` : ""}`,
    `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#3f271c">
     <p style="font-size:17px"><b>${q ? "הצעת מחיר חדשה מהבונה" : "הזמנה חדשה מהבונה"}</b> · ${escH(o.ref)}</p>
     <p>👤 ${escH(c.name)}${c.org ? ` · ${escH(c.org)}` : ""}${o.agent ? `<br>🧑‍💼 נציג / הגעה: <b>${escH(o.agent)}</b>` : ""}<br>📞 ${escH(c.phone)}${c.email ? `<br>✉️ ${escH(c.email)}` : ""}</p>
     <p>📦 ${n} מארזים${o.perBox ? ` · ₪${escH(o.perBox)} למארז` : ""}${goods ? ` · סה״כ מוצרים ₪${goods.toLocaleString("he-IL")} לפני מע״מ` : ""}${types ? `<br>${types}` : ""}<br>🚚 ${escH(o.dlv?.name || "")}${o.dlv?.city ? ` · ${escH(o.dlv.city)}` : ""}</p>
     ${o.text ? `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#faf6f1;padding:10px;border-radius:8px">${escH(String(o.text).slice(0, 4000))}</pre>` : ""}
     <p>היא כבר ממתינה בממשק הניהול ← הזמנות (לחצו "בדיקת הזמנות חדשות").</p></div>`);
}
const saveJack = s => put(JACK_CUR, JSON.stringify({ meals: s.meals, wins: s.wins.slice(0, 200), savedAt: new Date().toISOString() }), { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
async function readShowcase() {
  const host = blobHost();
  if (host) {
    const r = await fetch(host + SHOW_CURRENT + "?t=" + Math.floor(Date.now() / 30000), { cache: "no-store" });
    if (r.ok) return (await r.json()).list || [];
  }
  const { blobs } = await list({ prefix: SHOW_PREFIX + "list-" });   // fallback (before the first save in the new format)
  if (!blobs.length) return [];
  blobs.sort((a, b) => b.uploadedAt - a.uploadedAt || (b.pathname > a.pathname ? 1 : -1));
  const r = await fetch(blobs[0].url + "?t=" + Date.now(), { cache: "no-store" });
  return r.ok ? (await r.json()).list || [] : [];
}
const cleanShow = l => (Array.isArray(l) ? l : []).slice(0, 12).map(b => ({
  title: String(b.title || "").slice(0, 60),
  img: /^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//i.test(b.img || "") ? b.img : "",
  items: (Array.isArray(b.items) ? b.items : []).slice(0, 20).map(([id, q]) => [String(id).replace(/[^a-z0-9]/gi, "").slice(0, 20), Math.max(1, Math.min(50, +q || 1))]),
  pack: String(b.pack || "none").replace(/[^a-z0-9]/gi, "").slice(0, 20),
})).filter(b => b.img);

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
    if (a === "inbox" && req.method === "POST") {   // public: called by the builder when a customer sends an order
      const today = new Date().toISOString().slice(0, 10);
      if (today !== inboxDay) { inboxDay = today; inboxCount = 0; }
      if (++inboxCount > INBOX_DAILY) { res.status(429).json({ error: "limit" }); return; }
      const o = await readBody(req);
      const raw = JSON.stringify(o || {});
      if (raw.length > 40000 || !/^NOYA-[A-Z0-9-]{4,24}$/i.test(String(o?.ref || ""))) { res.status(400).json({ error: "bad order" }); return; }
      o.receivedAt = new Date().toISOString();
      if (/^NOYA-LOADTEST/i.test(String(o.ref))) { res.status(200).json({ ok: true, test: true }); return; }   // load test: validated, never stored or mailed
      await put(`${INBOX_PREFIX}${String(o.ref).replace(/[^A-Z0-9-]/gi, "")}.bin`, encrypt(Buffer.from(JSON.stringify(o))), { access: "public", contentType: "application/octet-stream", addRandomSuffix: true });
      if (o.kind !== "lead" && o.kind !== "addr" && !mailedRefs.has(o.ref)) { mailedRefs.add(o.ref); if (mailedRefs.size > 2000) mailedRefs.clear(); await orderMail(o).catch(() => {}); }
      res.status(200).json({ ok: true }); return;
    }
    if (a === "showcase" && req.method === "GET") {   // public, read by every builder visit
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");   // edge-cached
      res.status(200).json({ list: await readShowcase() }); return;
    }
    if (a === "backup") {   // daily Vercel Cron: copy the latest (encrypted) database to office/backups/, kept 30 days
      const cronOk = process.env.CRON_SECRET ? req.headers.authorization === `Bearer ${process.env.CRON_SECRET}` : /vercel-cron/i.test(req.headers["user-agent"] || "");
      if (!cronOk && !authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
      const v = await dbVersions();
      if (!v.length) { res.status(200).json({ ok: true, skipped: "no data" }); return; }
      const r = await fetch(v[0].url, { cache: "no-store" });
      if (!r.ok) throw new Error("db read " + r.status);
      const day = new Date().toISOString().slice(0, 10);
      const b = await put(`office/backups/db-${day}.bin`, Buffer.from(await r.arrayBuffer()), { access: "public", contentType: "application/octet-stream", addRandomSuffix: true });
      const { blobs } = await list({ prefix: "office/backups/" });
      blobs.sort((x, y) => new Date(y.uploadedAt) - new Date(x.uploadedAt));
      const old = blobs.slice(30).map(x => x.url); if (old.length) await del(old).catch(() => {});
      res.status(200).json({ ok: true, backup: b.pathname, kept: Math.min(blobs.length, 30) }); return;
    }
    if (a === "jackpot" && req.method === "GET") {
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
      const s = await readJack(); res.status(200).json({ meals: s.meals, perWin: JACK_MEALS }); return;
    }
    if (a === "spin" && req.method === "POST") {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== spinDay) { spinDay = today; spinIp = new Map(); }
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
      const me = spinIp.get(ip) || { n: 0, won: false }; me.n++; spinIp.set(ip, me);
      if (me.n > 400 || me.won || crypto.randomInt(JACK_ODDS) !== 0) { res.status(200).json({ jackpot: false }); return; }
      const s = await readJack(), last = s.wins[0];
      if (last && Date.now() - new Date(last.at).getTime() < JACK_GAP) { res.status(200).json({ jackpot: false }); return; }
      const id = crypto.randomBytes(5).toString("hex");
      s.wins.unshift({ id, at: new Date().toISOString(), shown: false, donated: false }); await saveJack(s); me.won = true;
      res.status(200).json({ jackpot: true, id }); return;
    }
    if ((a === "spinshown" || a === "spinvoid") && req.method === "POST") {
      const { id } = await readBody(req); const s = await readJack(); const w = s.wins.find(x => x.id === String(id || ""));
      if (w && !w.donated) {
        if (a === "spinshown") { const first = !w.shown; w.shown = true; if (first) { await saveJack(s); await jackMail(w); res.status(200).json({ ok: true }); return; } }
        else if (!w.shown && Date.now() - new Date(w.at).getTime() < 5 * 60e3) s.wins = s.wins.filter(x => x !== w);
        await saveJack(s);
      }
      res.status(200).json({ ok: true }); return;
    }
    if (a === "logout") { setCookie(res, "", 0); res.status(200).json({ ok: true }); return; }
    if (!authed(req)) { res.status(401).json({ error: "צריך להתחבר" }); return; }
    if (a === "me") { res.status(200).json({ ok: true }); return; }
    if (a === "jackpots" && req.method === "GET") { res.status(200).json({ ...(await readJack()), mail: !!process.env.RESEND_API_KEY }); return; }
    if (a === "notifytest" && req.method === "POST") { const r = await jackMail({ at: new Date().toISOString() }, true); res.status(r.ok ? 200 : 400).json(r); return; }
    if ((a === "jackpotdone" || a === "jackpotdel") && req.method === "POST") {
      const { id } = await readBody(req); const s = await readJack(); const w = s.wins.find(x => x.id === String(id || ""));
      if (!w) { res.status(404).json({ error: "לא נמצא" }); return; }
      if (a === "jackpotdone" && !w.donated) { w.donated = true; w.donatedAt = new Date().toISOString(); s.meals += JACK_MEALS; }
      if (a === "jackpotdel" && !w.donated) s.wins = s.wins.filter(x => x !== w);
      await saveJack(s); res.status(200).json(s); return;
    }

    if (a === "showcase" && req.method === "PUT") {
      const { list: l } = await readBody(req);
      const clean = cleanShow(l);
      const payload = JSON.stringify({ list: clean, savedAt: new Date().toISOString() });
      await put(SHOW_CURRENT, payload, { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
      await put(`${SHOW_PREFIX}list-${Date.now()}.json`, payload, { access: "public", contentType: "application/json", addRandomSuffix: true });   // history
      if (Math.random() < 0.2) {   // prune old history now and then, not on every save
        const { blobs } = await list({ prefix: SHOW_PREFIX + "list-" });
        blobs.sort((x, y) => y.uploadedAt - x.uploadedAt);
        const old = blobs.slice(10).map(b => b.url); if (old.length) await del(old);
      }
      res.status(200).json({ ok: true, list: clean }); return;
    }
    if (a === "showcaseimg" && req.method === "POST") {
      const { image } = await readBody(req);
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(image || "");
      if (!m) { res.status(400).json({ error: "bad image" }); return; }
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > MAX_FILE) { res.status(413).json({ error: "too big" }); return; }
      const b = await put(`${SHOW_PREFIX}img-${crypto.randomBytes(6).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`, buf, { access: "public", contentType: `image/${m[1]}`, addRandomSuffix: false });
      res.status(200).json({ url: b.url }); return;
    }
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
    if (a === "extract" && req.method === "POST") {
      const body = await readBody(req);
      let content;
      if (body.text) content = [{ type: "input_text", text: `Document "${String(body.name || "sheet").slice(0, 100)}" as CSV:\n` + String(body.text).slice(0, 120000) }];
      else {
        if (!blobUrlOk(body.url)) { res.status(400).json({ error: "bad url" }); return; }
        const r = await fetch(body.url, { cache: "no-store" });
        if (!r.ok) { res.status(404).json({ error: "הקובץ לא נמצא" }); return; }
        const buf = decrypt(Buffer.from(await r.arrayBuffer()));
        const type = String(body.type || "");
        if (/pdf/.test(type) || buf.subarray(0, 4).toString() === "%PDF") content = [{ type: "input_file", filename: "document.pdf", file_data: "data:application/pdf;base64," + buf.toString("base64") }];
        else if (/^image\/(jpeg|png|webp|gif)$/.test(type)) content = [{ type: "input_image", image_url: `data:${type};base64,` + buf.toString("base64") }];
        else { res.status(400).json({ error: "אפשר לשלוף מ-PDF, מתמונה או מאקסל" }); return; }
      }
      res.status(200).json({ result: await extractWithAI(content) }); return;
    }
    if (a === "inbox" && req.method === "GET") {
      const { blobs } = await list({ prefix: INBOX_PREFIX, limit: 300 });
      const orders = [];
      for (const b of blobs) {
        try { const r = await fetch(b.url, { cache: "no-store" }); if (r.ok) orders.push({ ...JSON.parse(decrypt(Buffer.from(await r.arrayBuffer())).toString()), _url: b.url }); } catch (e) {}
      }
      res.status(200).json({ orders }); return;
    }
    if (a === "inboxdone" && req.method === "POST") {
      const { urls } = await readBody(req);
      const ok = (Array.isArray(urls) ? urls : []).filter(u => { try { const x = new URL(u); return x.hostname.endsWith(".blob.vercel-storage.com") && x.pathname.startsWith("/" + INBOX_PREFIX); } catch (e) { return false; } });
      if (ok.length) await del(ok);
      res.status(200).json({ ok: true, removed: ok.length }); return;
    }
    if (a === "retouch" && req.method === "POST") {   // GPT Image: place the exact product on a neutral studio background
      const key = process.env.OPENAI_API_KEY; if (!key) { res.status(500).json({ error: "OPENAI_API_KEY לא מוגדר" }); return; }
      const { image, prompt, quality, ref } = await readBody(req);
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(image || "");
      if (!m) { res.status(400).json({ error: "bad image" }); return; }
      const form = new FormData();
      form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
      form.append("prompt", String(prompt || "").slice(0, 4000));
      form.append("quality", ["low","medium","high"].includes(quality) ? quality : "high"); form.append("size", "1024x1024"); form.append("output_format", "png");
      form.append("image[]", new Blob([Buffer.from(m[2], "base64")], { type: `image/${m[1]}` }), `product.${m[1] === "jpeg" ? "jpg" : m[1]}`);
      const rm = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(ref || "");   // optional style reference (second image)
      if (rm) form.append("image[]", new Blob([Buffer.from(rm[2], "base64")], { type: `image/${rm[1]}` }), `style.${rm[1] === "jpeg" ? "jpg" : rm[1]}`);
      const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: j?.error?.message || `OpenAI ${r.status}` }); return; }
      const b64 = j?.data?.[0]?.b64_json; if (!b64) { res.status(502).json({ error: "no image returned" }); return; }
      const blob = await put(`office/retouch/${crypto.randomBytes(9).toString("hex")}.png`, Buffer.from(b64, "base64"), { access: "public", contentType: "image/png", addRandomSuffix: true });
      res.status(200).json({ url: blob.url }); return;
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
