// AI safety + behaviour test (runs in tools/check.mjs before every push).
// 1. api/_ai.js may not touch the business database, iCount, e-mail, Blob storage or the network except the AI model.
// 2. The snapshot sent to the model carries no phone numbers, e-mails or street addresses.
// 3. Model answers are cleaned: unknown kinds/targets/refs dropped, approvals always wait for Moshe.
// 4. A full daily run with a fake model produces tasks and a CEO brief, within the call cap.
import { readFileSync } from "fs";
import assert from "assert/strict";

const root = new URL("..", import.meta.url).pathname;
const src = readFileSync(root + "api/_ai.js", "utf8").split("\n").map(l => l.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n");   // code only, comments removed

// 1 — static rules
for (const bad of ["@vercel/blob", "office/db", "icount", "resend", "nodemailer", "writeFile", "/api/office"])
  assert.ok(!src.toLowerCase().includes(bad.toLowerCase()), `_ai.js must not contain "${bad}"`);
assert.ok(!/(^|[^A-Za-z0-9_.])(put|del|list)\(/.test(src), "_ai.js must not call storage functions (put / del / list)");
const hosts = [...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1]);
assert.deepEqual([...new Set(hosts)], ["api.anthropic.com"], "the only network host allowed in _ai.js is the AI model");

process.env.ANTHROPIC_API_KEY = "test-key";
const AI = await import(root + "api/_ai.js");

// sample business data with personal details that must NOT reach the model
const today = "2026-12-01";
const db = {
  settings: { payTermsDays: 30, minMargin: 25, cashStart: { amount: 40000 }, season: { name: "פסח", date: "2027-04-21", capacity: 8000 } },
  products: [{ sku: "KT01", name: "קרש עץ", minStock: 200, salePrice: 30, landedCost: 9 }, { sku: "CN02", name: "נר", minStock: 0, salePrice: 25, landedCost: 8 }],
  shipments: [{ id: "s1", name: "מכולה ינואר", status: "sea", currency: "USD", fxRates: { USD: 3.7 }, eta: "2027-01-15", costs: { freight: 4000 }, items: [{ sku: "KT01", qty: 1000, unitPrice: 2, cbm: 4 }] },
              { id: "s0", name: "ישנה", status: "wh", currency: "USD", fxRates: { USD: 3.7 }, items: [{ sku: "KT01", qty: 300, unitPrice: 2 }, { sku: "CN02", qty: 500, unitPrice: 2 }], paid: { goods: true, vat: true } }],
  orders: [
    { id: "o1", ref: "NOYA-AAA1", status: "approved", approvedAt: "2026-10-15T09:00:00Z", createdAt: "2026-10-14T09:00:00Z", gross: 23600, boxes: 200, date: "2026-12-05", ful: "packing",
      customer: { org: "חברת דוגמה בע״מ", name: "דנה", phone: "054-1234567", email: "dana@example.com" }, dlv: { street: "הרצל 12", city: "תל אביב" }, frozen: { net: 20000, cost: 16000, profit: 4000, margin: 0.2 },
      lines: [{ sku: "KT01", qty: 200 }] },
    { id: "o2", ref: "NOYA-BBB2", status: "pending", createdAt: "2026-11-29T09:00:00Z", gross: 5900, boxes: 50, customer: { org: "ארגון ב", phone: "050-7654321" }, lines: [{ sku: "CN02", qty: 50 }] },
    { id: "o3", ref: "Q-CCC3", status: "quote", createdAt: "2026-11-24T09:00:00Z", gross: 9000, boxes: 80, agent: "אפרת", customer: { org: "ארגון ג", email: "x@y.co.il" } }],
  stockAdj: [], expenses: [{ id: "e1", name: "שכירות", amount: 7000, every: "month", day: 10 }],
};

// 2 — snapshot privacy
const snap = AI.snapshot(JSON.parse(JSON.stringify(db)), today);
const text = JSON.stringify(snap);
for (const secret of ["054-1234567", "050-7654321", "dana@example.com", "x@y.co.il", "הרצל 12", "דנה"])
  assert.ok(!text.includes(secret), `snapshot leaks "${secret}"`);
assert.ok(text.includes("חברת דוגמה"), "company names are allowed (needed for collection and sales)");
assert.equal(snap.finance.overdue.length, 1);                     // o1: approved 15.10 + 30 days, unpaid
assert.equal(snap.finance.overdue[0].amount, 23600);
assert.ok(snap.stock.items.find(i => i.sku === "KT01").inTransit === 1000);
assert.equal(snap.orders.lowMargin.length, 1);                     // 20% margin < 25% minimum, approved within 60 days
assert.equal(snap.service.quotesExpiring.length, 1);

// 3 — sanitizing model output
const at = "2026-12-01T04:30:00.000Z";
const clean = AI.sanitizeItems({ items: [
  { kind: "approval", title: "להזמין 2,000 קרשים", body: "…", refs: { sku: "KT01", order: "nope" }, priority: 1, to: "stock" },
  { kind: "delete-everything", title: "x", to: "hacker" },
  { kind: "handoff", title: "לבדוק תזרים למכולה", to: "finance" },
  { title: "" } ] }, "stock", db, at);
assert.equal(clean.length, 3);
assert.equal(clean[0].status, "awaiting");                         // approvals always wait for Moshe
assert.equal(clean[0].to, "ceo");                                  // cannot address itself
assert.deepEqual(clean[0].refs, { sku: "KT01" });                  // unknown order id dropped
assert.equal(clean[1].kind, "finding"); assert.equal(clean[1].to, "ceo");
assert.equal(clean[2].to, "finance");

// 4 — a full run with a fake model
let calls = 0;
const fakeFetch = async (url, opt) => {
  assert.equal(url, "https://api.anthropic.com/v1/messages"); calls++;
  const body = JSON.parse(opt.body);
  const isCeo = body.messages[0].content.includes("דוחות המנהלים");
  const out = isCeo ? { brief: "בוקר טוב", decisions: [{ id: "finance-202612010430-0", why: "כסף תקוע", recommend: "לבקש תשלום" }, { id: "fake", why: "", recommend: "" }] }
                    : { summary: "סיכום", items: [{ kind: "recommendation", title: "גבייה מחברת דוגמה", body: "23,600 ₪ באיחור", refs: { order: "o1" }, priority: 1, to: "moshe" }] };
  return { ok: true, json: async () => ({ content: [{ type: "text", text: "```json\n" + JSON.stringify(out) + "\n```" }], usage: { input_tokens: 100, output_tokens: 50 } }) };
};
const RealDate = Date; global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [at])); } static now() { return new RealDate(at).getTime(); } };
const run = await AI.runDaily(JSON.parse(JSON.stringify(db)), { tasks: [] }, { today, fetchImpl: fakeFetch });
global.Date = RealDate;
assert.equal(calls, 9, "8 managers + CEO");
assert.equal(run.log.calls, 9); assert.equal(run.log.errors.length, 0);
assert.equal(run.tasks.length, 8);
assert.ok(run.ceo && run.ceo.decisions.length === 1, "CEO decisions limited to real task ids");
assert.equal(run.tasks.find(t => t.id === "finance-202612010430-0").status, "awaiting");
const merged = AI.mergeDaily({ tasks: [{ id: "old", from: "finance", status: "open", kind: "finding", at: "2026-11-30T04:30:00Z" }, { id: "dec", from: "stock", status: "approved", kind: "approval", at: "2026-11-30T04:30:00Z", decidedAt: "2026-11-30T09:00:00Z" }] }, run);
assert.ok(!merged.tasks.some(t => t.id === "old"), "yesterday's plain findings are replaced");
assert.ok(merged.tasks.some(t => t.id === "dec"), "decisions are kept");
assert.equal(merged.ceo.length, 1); assert.equal(merged.runs.length, 1);

// no key → clear error, no call
delete process.env.ANTHROPIC_API_KEY;
await assert.rejects(AI.callModel({ system: "", user: "", model: "x" }, async () => { throw new Error("must not be called"); }), /ANTHROPIC_API_KEY/);
console.log("✓ AI layer: safe, private, and behaves (all checks)");
