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
import { blobHost, readCatalog } from "./catalog.js";
import { readFile as readFileFs } from "node:fs/promises";
import pathMod from "node:path";
import crypto from "node:crypto";
import * as AI from "./_ai.js";

const DB_PREFIX = "office/db/";
const DOC_PREFIX = "office/docs/";
const INBOX_PREFIX = "office/inbox/";
const SHOW_PREFIX = "public/showcase/";
const INBOX_DAILY = +(process.env.INBOX_DAILY_LIMIT || Infinity);
let inboxDay = "", inboxCount = 0;
const KEEP_VERSIONS = 30;                         // older database versions are pruned (they double as history)
const MAX_FILE = Math.floor(4.3 * 1024 * 1024);   // Vercel function body limit is 4.5 MB
const SESSION_HOURS = 48;   // Moshe asked for 48 h (was 12 h); the cookie stays HttpOnly + Secure + SameSite=Strict
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
// ---------- AI management layer: its own encrypted store (office/ai/), never the business database ----------
const AI_PREFIX = "office/ai/";
async function aiVersions() { const { blobs } = await list({ prefix: AI_PREFIX + "state", limit: 1000 }); return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)); }
async function readAi() {
  const v = await aiVersions(); if (!v.length) return { store: { tasks: [], reports: {}, ceo: [], board: [], runs: [], settings: {} }, rev: "" };
  const r = await fetch(v[0].url, { cache: "no-store" }); if (!r.ok) throw new Error("ai read " + r.status);
  return { store: JSON.parse(decrypt(Buffer.from(await r.arrayBuffer())).toString()), rev: v[0].pathname };
}
// read → change → write, retried if another writer (a cron run, another tab) saved in between
async function updateAi(fn) {
  for (let i = 0; i < 4; i++) {
    const { store, rev } = await readAi(); const next = await fn(JSON.parse(JSON.stringify(store)));
    const v = await aiVersions(); if ((v[0]?.pathname || "") !== rev) continue;
    next.savedAt = new Date().toISOString();
    const b = await put(AI_PREFIX + "state.bin", encrypt(Buffer.from(JSON.stringify(next))), { access: "public", contentType: "application/octet-stream", addRandomSuffix: true });
    const old = v.slice(9).map(x => x.url); if (old.length) await del(old).catch(() => {});
    return { store: next, rev: b.pathname };
  }
  throw new Error("שמירת נתוני ה-AI נכשלה, נסו שוב");
}
// money / key problems with the AI model → one e-mail to Moshe a day + a banner in the Command Center
const AI_MONEY = /credit balance|too low|billing|insufficient|quota|invalid x-api-key|authentication|permission|api key|ANTHROPIC_API_KEY/i;
async function aiAlert(errors) {
  const bad = (errors || []).find(e => AI_MONEY.test(e)); if (!bad) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const credit = /credit|too low|billing|insufficient|quota/i.test(bad);
  const text = credit ? "נגמר הקרדיט של Claude, ולכן צוות ה-AI לא רץ. כל שאר המערכת עובדת כרגיל." : "מפתח Claude לא עובד, ולכן צוות ה-AI לא רץ. כל שאר המערכת עובדת כרגיל.";
  const { store } = await readAi();
  if (store.alert?.day === today) return store.alert;
  const alert = { day: today, at: new Date().toISOString(), credit, text };
  await updateAi(st => { st.alert = alert; return st; });
  await notify(credit ? "⚠️ נגמר הקרדיט של צוות ה-AI" : "⚠️ מפתח Claude לא עובד", `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#3f271c"><p><b>${escH(text)}</b></p><p>${credit ? "מה לעשות: להיכנס ל-platform.claude.com ← Billing ולטעון קרדיט (או להפעיל טעינה אוטומטית). אם המנוי מחובר – הקרדיט יתחדש בתחילת החודש." : "מה לעשות: לבדוק ב-Vercel שהמפתח ANTHROPIC_API_KEY נכון ופעיל ב-platform.claude.com."}</p><p style="color:#8a7563;font-size:13px">ההודעה נשלחת פעם אחת ביום לכל היותר.</p></div>`).catch(() => {});
  return alert;
}
// customer prices as the builder shows them (saved catalogue, else the built-in one in index.html): builder id → price before VAT
async function builderPrices() {
  try { const c = await readCatalog(); if (c?.products?.length) return Object.fromEntries(c.products.filter(p => +p.price > 0).map(p => [String(p.id), +p.price])); } catch (e) {}
  try { const html = await readFileFs(pathMod.join(process.cwd(), "index.html"), "utf8"); const m = /const P=(\[.*?\]);\n/s.exec(html); if (m) return Object.fromEntries(JSON.parse(m[1]).filter(p => +p.price > 0).map(p => [String(p.id), +p.price])); } catch (e) {}
  return {};
}
const cronAuth = req => process.env.CRON_SECRET ? req.headers.authorization === `Bearer ${process.env.CRON_SECRET}` : /vercel-cron/i.test(req.headers["user-agent"] || "");

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
     <p>👤 ${escH(c.name)}${c.org ? ` · ${escH(c.org)}` : ""}${c.vat ? ` · ח.פ ${escH(c.vat)}` : ""}${o.agent ? `<br>🧑‍💼 יועץ/ת מארזים / הגעה: <b>${escH(o.agent)}</b>` : ""}${o.quoteRef ? `<br>📝 לפי הצעת מחיר <b>${escH(o.quoteRef)}</b>` : ""}<br>📞 ${escH(c.phone)}${c.email ? `<br>✉️ ${escH(c.email)}` : ""}</p>
     <p>📦 ${n} מארזים${o.perBox ? ` · ₪${escH(o.perBox)} למארז` : ""}${goods ? ` · סה״כ מוצרים ₪${goods.toLocaleString("he-IL")} לפני מע״מ` : ""}${types ? `<br>${types}` : ""}<br>🚚 ${escH(o.dlv?.name || "")}${o.dlv?.city ? ` · ${escH(o.dlv.city)}` : ""}</p>
     ${o.text ? `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#faf6f1;padding:10px;border-radius:8px">${escH(String(o.text).slice(0, 4000))}</pre>` : ""}
     <p>היא כבר ממתינה בממשק הניהול ← הזמנות (לחצו "בדיקת הזמנות חדשות").</p></div>`);
}
// ---------- morning digest (Vercel Cron ~07:30 Israel): what is stuck today, by e-mail ----------
function digestOf(db) {
  const now = Date.now(), H = 36e5, D = 864e5, orders = Array.isArray(db?.orders) ? db.orders : [];
  const ful = o => o.status !== "approved" ? "" : (o.ful || (o.engrave ? "engrave" : "packing"));
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" })); today.setHours(0, 0, 0, 0);
  const days = o => o.date ? Math.round((new Date(String(o.date).slice(0, 10) + "T00:00") - today) / D) : null;
  const open = o => !["cancelled", "lead", "won", "lost"].includes(o.status) && ful(o) !== "shipped";
  const who = o => escH(o.customer?.org || o.customer?.name || "") + ` <span style="color:#8a7563">${escH(o.ref || "")}</span>`;
  const G = [], g = (icon, title, items) => { if (items.length) G.push({ icon, title, items }); };
  g("⏳", "ממתינות לאישור שלך יותר מ-24 שעות", orders.filter(o => o.status === "pending" && now - new Date(o.createdAt) > 24 * H).map(o => `${who(o)} · ${o.boxes} מארזים`));
  g("⏰", "תאריך היעד קרוב (עד 3 ימים) ועוד לא מוכנה", orders.filter(o => o.status === "approved" && ["engrave", "packing"].includes(ful(o)) && days(o) !== null && days(o) <= 3)
    .sort((a, b) => days(a) - days(b)).map(o => { const d = days(o); return `${who(o)} · ${d < 0 ? `באיחור ${-d} ימים` : d === 0 ? "היום" : d === 1 ? "מחר" : `עוד ${d} ימים`}`; }));
  g("📎", "משלוח לכל מקבל – קובץ הכתובות עוד לא הגיע", orders.filter(o => ["pending", "approved"].includes(o.status) && open(o) && ["indiv", "vip"].includes(o.dlvMode) && !(o.addrFiles || []).length).map(o => `${who(o)} · ${escH(o.customer?.phone || "")}`));
  g("📦", "מוכנות יותר מיומיים ועוד לא יצאו", orders.filter(o => o.status === "approved" && ful(o) === "ready" && (() => { const l = [...(o.fulLog || [])].reverse().find(x => x.ful === "ready"); return l && now - new Date(l.at) > 48 * H; })()).map(who));
  g("📝", "הצעות מחיר שעומדות לפוג או פגו – לחזור ללקוח", orders.filter(o => o.status === "quote" && (() => { const a = (now - new Date(o.createdAt)) / D; return a >= 5 && a <= 14; })()).map(o => `${who(o)} · ${o.boxes} מארזים${o.agent ? ` · ${escH(o.agent)}` : ""} · ${escH(o.customer?.phone || "")}`));
  const approvedOpen = orders.filter(o => o.status === "approved" && ful(o) !== "shipped").length;
  return { G, approvedOpen, pending: orders.filter(o => o.status === "pending").length };
}
const trackIp = new Map();
const TRACK_STEPS = mode => [["received", "ההזמנה התקבלה"], ["approved", "אושרה סופית"], ["packing", "בהכנה ואריזה"], ["ready", mode === "pickup" ? "מוכנה לאיסוף" : "ארוזה ומוכנה"], ["shipped", mode === "pickup" ? "נאספה" : "יצאה למשלוח"]];
const saveJack = s => put(JACK_CUR, JSON.stringify({ meals: s.meals, wins: s.wins.slice(0, 200), savedAt: new Date().toISOString() }), { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
// personal company links (?c=code): name + logo + consultant, readable by the builder (no personal data)
const CLIENTS_CUR = "public/clients/list.json";
async function readClients() { const host = blobHost(); if (!host) return []; try { const r = await fetch(host + CLIENTS_CUR + "?t=" + Math.floor(Date.now() / 30000), { cache: "no-store" }); if (r.ok) return (await r.json()).list || []; } catch (e) {} return []; }
const MAP_CUR = "public/map/cities.json";   // where boxes were delivered: { city: count } (no names of customers)
async function readMap() { const host = blobHost(); if (!host) return null; try { const r = await fetch(host + MAP_CUR + "?t=" + Math.floor(Date.now() / 60000), { cache: "no-store" }); if (r.ok) return await r.json(); } catch (e) {} return null; }
// holiday countdown bar: name, date, order deadline, production capacity → % of places left (from the orders in the database)
let seasonCache = { at: 0, v: null };
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
      if (raw.length > 40000 || !/^(NOYA|Q)-[A-Z0-9-]{4,24}$/i.test(String(o?.ref || ""))) { res.status(400).json({ error: "bad order" }); return; }
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
    if (a === "aidaily" || a === "aiboard") {   // Vercel Cron (06:30 daily / Sunday 07:00), or the owner's "run now"
      const owner = authed(req);
      if (!cronAuth(req) && !owner) { res.status(401).json({ error: "unauthorized" }); return; }
      const { db } = await readDb();
      if (!process.env.ANTHROPIC_API_KEY) { if (db?.settings?.ai?.on) await aiAlert(["ANTHROPIC_API_KEY missing"]).catch(() => {}); res.status(200).json({ ok: false, error: "ANTHROPIC_API_KEY לא מוגדר ב-Vercel" }); return; }
      if (!owner && !db?.settings?.ai?.on) { res.status(200).json({ ok: true, skipped: "AI כבוי בהגדרות" }); return; }
      const { store } = await readAi();
      if (a === "aidaily") {
        const run = await AI.runDaily(db || {}, store, { prices: await builderPrices() });
        const saved = await updateAi(s => { const m = AI.mergeDaily(s, run); if (!run.log.errors.some(e => AI_MONEY.test(e))) delete m.alert; return m; });
        const alert = await aiAlert(run.log.errors).catch(() => null);
        res.status(200).json({ ok: true, alert: alert?.text || "", tasks: run.tasks.length, ceo: !!run.ceo, calls: run.log.calls, errors: run.log.errors, rev: saved.rev }); return;
      }
      const body = req.method === "POST" ? await readBody(req).catch(() => ({})) : {};
      const b = await AI.runBoard(db || {}, store, { topic: body.topic || "", prices: await builderPrices() });
      const saved = await updateAi(s => { s.board = [b.report, ...(s.board || [])].slice(0, 20); s.runs = [b.log, ...(s.runs || [])].slice(0, 60); return s; });
      await aiAlert(b.log.errors).catch(() => null);
      res.status(200).json({ ok: true, directors: Object.keys(b.report.opinions).length, errors: b.log.errors, rev: saved.rev }); return;
    }
    if (a === "digest") {   // daily Vercel Cron (and the owner can trigger it from the admin)
      const cronOk = process.env.CRON_SECRET ? req.headers.authorization === `Bearer ${process.env.CRON_SECRET}` : /vercel-cron/i.test(req.headers["user-agent"] || "");
      if (!cronOk && !authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
      const { db } = await readDb();
      const d = digestOf(db || {});
      const { blobs } = await list({ prefix: INBOX_PREFIX, limit: 300 });
      const n = d.G.reduce((t, x) => t + x.items.length, 0);
      let aiHtml = "";
      try { const { store } = await readAi(); const c = store.ceo?.[0], today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
        if (c && String(c.at).slice(0, 10) >= today.slice(0, 10) && (c.brief || c.decisions?.length)) aiHtml = `<div style="background:#f6efe6;border-radius:10px;padding:10px 14px;margin:12px 0"><p style="margin:0 0 6px"><b>🤖 מנכ״ל ה-AI – החלטות להיום</b></p><p style="margin:0 0 6px">${escH(c.brief || "")}</p>${(c.decisions || []).length ? `<ol style="margin:0;padding-inline-start:18px">${c.decisions.map(x => { const t = (store.tasks || []).find(y => y.id === x.id); return `<li><b>${escH(t?.title || "")}</b> – ${escH(x.recommend || "")}</li>`; }).join("")}</ol>` : ""}<p style="margin:6px 0 0;font-size:13px">לאישור או דחייה: ממשק הניהול ← מרכז שליטה</p></div>`; } catch (e) {}
      if (!n && !blobs.length && !aiHtml && !req.query.force) { res.status(200).json({ ok: true, sent: false, reason: "nothing stuck" }); return; }
      const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#3f271c">
        <p style="font-size:18px"><b>☀️ בוקר טוב משה – מה דורש טיפול היום</b></p>
        ${aiHtml}
        <p>${blobs.length ? `🆕 <b>${blobs.length}</b> פריטים חדשים מהבונה מחכים בממשק (הזמנות / הצעות / לידים) · ` : ""}ממתינות לאישור: <b>${d.pending}</b> · בעבודה: <b>${d.approvedOpen}</b></p>
        ${n ? d.G.map(x => `<p style="margin:14px 0 4px"><b>${x.icon} ${x.title} (${x.items.length})</b></p><ul style="margin:0;padding-inline-start:18px">${x.items.slice(0, 30).map(i => `<li>${i}</li>`).join("")}</ul>`).join("") : "<p>✅ שום דבר לא תקוע.</p>"}
        <p style="margin-top:16px"><a href="https://build.noyaglobal.com/admin" style="background:#7a5230;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">פתיחת ממשק הניהול</a></p>
        <p style="color:#8a7563;font-size:12.5px">חוסרי מלאי מופיעים בממשק עצמו (לוח בקרה ← דורש טיפול היום).</p></div>`;
      const r = await notify(`☀️ דורש טיפול היום: ${n} פריטים${blobs.length ? ` · ${blobs.length} חדשים מהבונה` : ""}`, html);
      res.status(200).json({ ok: r.ok, sent: r.ok, items: n, error: r.error }); return;
    }
    if (a === "track" && req.method === "GET") {   // public: the customer's personal order page (order number + private key from the order)
      const ref = String(req.query.ref || "").toUpperCase(), k = String(req.query.k || "");
      if (!/^NOYA-[A-Z0-9-]{4,24}$/.test(ref) || !/^[a-z0-9]{8,32}$/.test(k)) { res.status(400).json({ error: "bad" }); return; }
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      const t = trackIp.get(ip) || []; const now = Date.now(); const recent = t.filter(x => now - x < 60e3); recent.push(now); trackIp.set(ip, recent); if (trackIp.size > 5000) trackIp.clear();
      if (recent.length > 30) { res.status(429).json({ error: "slow down" }); return; }
      res.setHeader("Cache-Control", "no-store");
      const { db } = await readDb();
      const o = (db?.orders || []).find(x => String(x.ref).toUpperCase() === ref);
      if (o && o.lateKey !== k) { res.status(404).json({ error: "not found" }); return; }
      if (!o) {   // not pulled into the admin yet: it is still waiting in the inbox
        const { blobs } = await list({ prefix: INBOX_PREFIX + ref.replace(/[^A-Z0-9-]/g, ""), limit: 5 });
        res.status(200).json(blobs.length ? { stage: "received", steps: TRACK_STEPS("ship"), at: 0 } : { stage: "unknown" }); return;
      }
      const ful = o.status !== "approved" ? "" : (o.ful || (o.engrave ? "engrave" : "packing"));
      const stage = o.status === "cancelled" ? "cancelled" : o.status === "pending" ? "received" : o.status === "approved" ? ({ engrave: "approved", packing: "packing", ready: "ready", shipped: "shipped" }[ful] || "approved") : "received";
      res.status(200).json({ stage, steps: TRACK_STEPS(o.dlvMode), org: o.customer?.org || "", boxes: +o.boxes || 0, dlvMode: o.dlvMode || "", engrave: !!o.engrave,
        date: o.date || "", needAddr: ["indiv", "vip"].includes(o.dlvMode), addrCount: (o.addrFiles || []).reduce((t, f) => t + (+f.count || 0), 0), addrFiles: (o.addrFiles || []).length,
        updatedAt: (o.fulLog || []).slice(-1)[0]?.at || o.approvedAt || o.createdAt || "" }); return;
    }
    if (a === "client" && req.method === "GET") {   // public: one personal link
      const c = String(req.query.c || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
      const it = c ? (await readClients()).find(x => x.code === c && !x.off) : null;
      res.setHeader("Cache-Control", "public, max-age=60");
      if (!it) { res.status(404).json({ error: "not found" }); return; }
      res.status(200).json({ code: it.code, name: it.name, logo: it.logo || "", agent: it.agent || "" }); return;
    }
    if (a === "map" && req.method === "GET") { const m = await readMap(); res.setHeader("Cache-Control", "public, max-age=300"); res.status(200).json(m || { cities: {} }); return; }
    if (a === "season" && req.method === "GET") {   // public: holiday countdown bar
      if (Date.now() - seasonCache.at > 60e3) {
        const { db } = await readDb(); const se = db?.settings?.season || null; let v = null;
        if (se && se.on && se.date) {
          const from = se.from ? new Date(se.from) : new Date(Date.now() - 120 * 864e5);
          const used = (db.orders || []).filter(o => ["approved", "pending"].includes(o.status) && new Date(o.createdAt) >= from).reduce((t, o) => t + (+o.boxes || 0), 0);
          const cap = +se.capacity || 0;
          v = { name: String(se.name || "").slice(0, 40), date: se.date, deadline: se.deadline || "", deadlineLabel: String(se.deadlineLabel || "").slice(0, 60), leftPct: cap ? Math.max(0, Math.min(100, Math.round((1 - used / cap) * 100))) : null };
        }
        seasonCache = { at: Date.now(), v };
      }
      res.setHeader("Cache-Control", "public, max-age=60");
      res.status(200).json(seasonCache.v || { off: true }); return;
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
    if (a === "ai" && req.method === "GET") {   // the AI store for the Command Center
      const { store, rev } = await readAi();
      res.status(200).json({ store, rev, configured: !!process.env.ANTHROPIC_API_KEY, managers: AI.MANAGERS, directors: AI.DIRECTORS }); return;
    }
    if (a === "aiact" && req.method === "POST") {   // Moshe decides on a proposal: approve | reject | done | reopen | note. Records the decision only.
      const { id, action, note } = await readBody(req);
      if (!["approve", "reject", "done", "reopen", "note"].includes(action)) { res.status(400).json({ error: "bad action" }); return; }
      const out = await updateAi(s => { const t = (s.tasks || []).find(x => x.id === id); if (!t) throw Object.assign(new Error("not found"), { code: 404 });
        const at = new Date().toISOString(); t.thread = [...(t.thread || []), { from: "moshe", at, action, text: String(note || "").slice(0, 500) }];
        if (action !== "note") { t.status = { approve: "approved", reject: "rejected", done: "done", reopen: "open" }[action]; t.decidedAt = at; t.decidedBy = "moshe"; }
        return s; });
      res.status(200).json({ ok: true, rev: out.rev }); return;
    }
    if (a === "aitask" && req.method === "POST") {   // Moshe adds a task / question for a manager, the CEO or the board
      const { to, title, body } = await readBody(req);
      const ok = ["ceo", "board", ...AI.MANAGERS.map(m => m.id)];
      if (!ok.includes(to) || !String(title || "").trim()) { res.status(400).json({ error: "bad task" }); return; }
      const at = new Date().toISOString();
      const out = await updateAi(s => { s.tasks = [{ id: "moshe-" + Date.now().toString(36), at, from: "moshe", to, kind: "handoff", title: String(title).slice(0, 80), body: String(body || "").slice(0, 600), evidence: [], impact: { amount: 0, note: "" }, refs: {}, priority: 2, status: "open", thread: [] }, ...(s.tasks || [])]; return s; });
      res.status(200).json({ ok: true, rev: out.rev }); return;
    }
    if (a === "aiset" && req.method === "POST") {   // which managers run
      const { managers } = await readBody(req);
      const ids = (Array.isArray(managers) ? managers : []).filter(m => AI.MANAGERS.some(x => x.id === m));
      const out = await updateAi(s => { s.settings = { ...(s.settings || {}), managers: ids }; return s; });
      res.status(200).json({ ok: true, rev: out.rev }); return;
    }
    if (a === "me") { res.status(200).json({ ok: true }); return; }
    if (a === "jackpots" && req.method === "GET") { res.status(200).json({ ...(await readJack()), mail: !!process.env.RESEND_API_KEY }); return; }
    if (a === "notifytest" && req.method === "POST") { const r = await jackMail({ at: new Date().toISOString() }, true); res.status(r.ok ? 200 : 400).json(r); return; }
    if (a === "mapdata" && req.method === "POST") {   // owner only: delivered cities (counts only)
      const b = await readBody(req) || {}; const cities = {};
      Object.entries(b.cities || {}).slice(0, 2000).forEach(([k, v]) => { const n = String(k).slice(0, 40).trim(); if (n && +v > 0) cities[n] = Math.round(+v); });
      const places = Math.max(0, Math.min(5000, Math.round(+b.places || 0)));
      await put(MAP_CUR, JSON.stringify({ cities, places, updatedAt: new Date().toISOString() }), { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 300 });
      res.status(200).json({ ok: true, count: Object.keys(cities).length }); return;
    }
    if (a === "clients" && req.method === "POST") {   // owner only: save the personal links list
      const b = await readBody(req) || {};
      const list = (Array.isArray(b.list) ? b.list : []).slice(0, 500).map(x => ({ code: String(x.code || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30), name: String(x.name || "").slice(0, 80), logo: /^https:\/\//.test(x.logo || "") ? String(x.logo).slice(0, 400) : "", agent: String(x.agent || "").slice(0, 40), off: !!x.off, at: x.at || new Date().toISOString() })).filter(x => x.code && x.name);
      await put(CLIENTS_CUR, JSON.stringify({ list, savedAt: new Date().toISOString() }), { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
      seasonCache.at = 0; res.status(200).json({ ok: true, count: list.length }); return;
    }
    if (a === "icount" && req.method === "GET") {   // connection check (read-only call: the document types of the account)
      const tok = process.env.ICOUNT_TOKEN; if (!tok) { res.status(200).json({ ok: false, error: "no token" }); return; }
      if (!req.query.test) { res.status(200).json({ ok: true }); return; }
      const probe = String(req.query.probe || "");   // owner-only READ calls (lists), used to plan the item sync
      if (probe) { if (!/^(inventory\/(get_items|get_list|list|items|info)|item\/(get_list|list|info)|items\/(get_list|list))$/.test(probe)) { res.status(400).json({ ok: false, error: "not allowed" }); return; }
        const r = await fetch("https://api.icount.co.il/api/v3.php/" + probe, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ limit: 5000, ...(req.query.page ? { page: +req.query.page } : {}) }) });
        const j = await r.json().catch(() => ({})); res.status(200).json({ http: r.status, ...j }); return; }
      try { const r = await fetch("https://api.icount.co.il/api/v3.php/doc/types", { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: "{}" });
        const j = await r.json().catch(() => ({})); res.status(200).json(r.ok && j.status !== false ? { ok: true, live: true, types: j.doctypes || j.data?.doctypes || null } : { ok: false, error: j.reason || j.message || j.error || ("status " + r.status) });
      } catch (e) { res.status(200).json({ ok: false, error: String(e.message || e) }); } return;
    }
    if (a === "icountinv" && req.method === "POST") {   // owner only: iCount inventory calls (backup → delete old items → add the products), approved by the owner
      const tok = process.env.ICOUNT_TOKEN; if (!tok) { res.status(200).json({ status: false, reason: "no token" }); return; }
      const b = await readBody(req) || {}; const m = String(b.method || "");
      if (!/^inventory\/[a-z_]{2,40}$/.test(m) && !/^doc\/(info|search|list|get_doc_url)$/.test(m) && m !== "bank/get_list" && !/^client\/(find|get_list|info)$/.test(m)) { res.status(400).json({ status: false, reason: "not allowed" }); return; }
      try { const r = await fetch("https://api.icount.co.il/api/v3.php/" + m, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(b.body || {}) });
        const j = await r.json().catch(() => ({})); delete j.api; res.status(200).json(j); } catch (e) { res.status(200).json({ status: false, reason: String(e.message || e) }); } return;
    }
    if (a === "icount" && req.method === "POST") {   // owner only: create a document in iCount from an approved order (token in ICOUNT_TOKEN, set by the owner in Vercel)
      const tok = process.env.ICOUNT_TOKEN; if (!tok) { res.status(200).json({ ok: false, error: "חסר ICOUNT_TOKEN ב-Vercel" }); return; }
      const b = await readBody(req) || {};
      const doctype = ["deal", "offer", "order", "invoice", "invrec", "delcert"].includes(b.doctype) ? b.doctype : "deal";
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 200).map(i => ({ description: String(i.description || "").slice(0, 200), quantity: Math.max(0, +i.quantity || 0), unitprice: Math.round((+i.unitprice || 0) * 100) / 100,
        ...(i.sku ? { sku: String(i.sku).slice(0, 40) } : {}), ...(+i.inventory_item_id ? { inventory_item_id: +i.inventory_item_id } : {}) })).filter(i => i.description && i.quantity);
      if (!items.length || !b.client_name) { res.status(400).json({ ok: false, error: "חסרים לקוח או שורות" }); return; }
      const body = { doctype, lang: "he", currency_code: "ILS", client_name: String(b.client_name).slice(0, 120), items, hwc: String(b.comments || "").slice(0, 500) };
      if (+b.client_id > 0) body.client_id = +b.client_id;   // existing customer card in iCount
      if (b.email) body.email = String(b.email).slice(0, 120);
      if (b.phone) body.client_phone = String(b.phone).slice(0, 30);
      if (b.vat_id) body.vat_id = String(b.vat_id).slice(0, 20);
      if (doctype === "invrec") {   // a tax invoice-receipt must say how the customer paid
        const p = b.pay || {}, sum = Math.round((+p.sum || 0) * 100) / 100, date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : new Date().toISOString().slice(0, 10);
        if (!(sum > 0)) { res.status(400).json({ ok: false, error: "חסר סכום תשלום" }); return; }
        if (p.method === "cash") body.cash = { sum };
        else if (p.method === "cheque") body.cheques = [{ sum, date, bank: +p.bank || 0, branch: +p.branch || 0, account: String(p.account || ""), number: String(p.number || "") }];
        else if (p.method === "cc") { const n = Math.max(1, Math.min(36, parseInt(p.payments) || 1)), first = Math.round((sum - Math.floor(sum / n * 100) / 100 * (n - 1)) * 100) / 100;
          if (!/^\d{4}$/.test(String(p.last4 || "")) || !p.conf) { res.status(400).json({ ok: false, error: "באשראי צריך 4 ספרות אחרונות ומספר אישור" }); return; }
          body.cc = [{ sum, date, num_of_payments: n, first_payment: n > 1 ? first : sum, card_type: ["VISA", "MASTERCARD", "ISRACARD", "AMEX", "DINERS"].includes(p.cardType) ? p.cardType : "VISA", card_number: String(p.last4), confirmation_code: String(p.conf).slice(0, 20) }]; }
        else body.banktransfer = { sum, date, account: 1 };
      }
      try {
        const r = await fetch("https://api.icount.co.il/api/v3.php/doc/create", { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.status === false) { res.status(200).json({ ok: false, error: j.reason || j.message || j.error || ("status " + r.status) }); return; }
        const d = j.data || j;
        let clientId = +b.client_id || 0;
        if (!clientId && (d.docnum || d.doc_number)) { try { const ri = await fetch("https://api.icount.co.il/api/v3.php/doc/info", { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ doctype, docnum: +(d.docnum || d.doc_number) }) }); const ji = await ri.json(); clientId = +ji?.doc_info?.client_id || 0; } catch (e) {} }
        res.status(200).json({ ok: true, doctype, docnum: d.docnum || d.doc_number || "", url: d.pdf_link || d.doc_url || "", client_id: clientId }); return;
      } catch (e) { res.status(200).json({ ok: false, error: String(e.message || e) }); return; }
    }
    if (a === "custmail" && req.method === "POST") {   // owner only: status update e-mail to a customer (needs a verified sending domain in Resend)
      const b = await readBody(req); const to = String(b?.to || "").trim(), text = String(b?.text || "").slice(0, 4000), subject = String(b?.subject || "נויה במתנה").slice(0, 150);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || !text) { res.status(400).json({ ok: false, error: "חסר מייל או תוכן" }); return; }
      const key = process.env.RESEND_API_KEY; if (!key) { res.status(200).json({ ok: false, error: "חסר RESEND_API_KEY" }); return; }
      const from = process.env.CUSTOMER_FROM || "";
      if (!from) { res.status(200).json({ ok: false, error: "עוד לא אומת דומיין שליחה (noyaglobal.com) ב-Resend" }); return; }
      const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.7;color:#3f271c;white-space:pre-wrap">${escH(text).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</div>`;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], reply_to: process.env.NOTIFY_EMAIL || "moshe@noyaglobal.com", subject, html, text }) });
      const j = await r.json().catch(() => ({})); res.status(200).json(r.ok ? { ok: true } : { ok: false, error: j.message || ("status " + r.status) }); return;
    }
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
    if (a === "data" && req.method === "PUT") { seasonCache.at = 0;
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
