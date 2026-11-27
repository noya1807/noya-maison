// NOYA AI management layer: managers, AI CEO and board. Imported by api/office.js (the underscore keeps it from
// being its own endpoint).
//
// SAFETY: this file only READS the business data it is given and returns recommendations. It never writes
// the business database, never calls iCount, never sends e-mail or messages, never changes an order, a price,
// stock or a product. Everything it produces lands in a separate encrypted store (office/ai/) as proposals.
// A proposal becomes real only when Moshe approves it in the back office and then does (or confirms) it there.
// tools/test-ai.mjs checks these rules on every push.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { num, isoDay, addDays, stockAll, shipCalc, shipPayments, cashForecast, receivables, salesBetween } from "../js/biz.mjs";

export const MANAGERS = [
  { id: "finance", name: "מנהל כספים ותזרים" },
  { id: "stock", name: "מנהל מלאי ויבוא" },
  { id: "orders", name: "מנהל הזמנות ורווחיות" },
  { id: "sales", name: "מנהל מכירות" },
  { id: "marketing", name: "מנהל שיווק" },
  { id: "product", name: "מנהל פיתוח מוצרים" },
  { id: "ops", name: "מנהל תפעול" },
  { id: "service", name: "מנהל שירות לקוחות" },
];
export const DIRECTORS = [
  { id: "auditor", name: "דירקטור כספים ומבקר" },
  { id: "risk", name: "דירקטור סיכונים" },
  { id: "growth", name: "דירקטור צמיחה ואסטרטגיה" },
];
const WHO = Object.fromEntries([...MANAGERS, ...DIRECTORS, { id: "ceo", name: "מנכ״ל AI" }, { id: "moshe", name: "משה" }].map(x => [x.id, x.name]));
export const whoName = id => WHO[id] || id;

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";            // managers
const MODEL_TOP = () => process.env.ANTHROPIC_MODEL_TOP || "claude-opus-5-5";      // CEO + board
const MAX_CALLS = () => +(process.env.AI_MAX_CALLS || 14);                          // hard cap per run (cost guard)

// ---------- helpers ----------
const day = v => String(v || "").slice(0, 10);
const r0 = v => Math.round(num(v));
const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 864e5);
const orgOf = o => clip(o.customer?.org || o.customer?.name || "", 60);   // company / customer name only: no phone, e-mail or address

// ---------- the snapshot each manager sees (numbers and ids, no personal contact details) ----------
export function snapshot(db, today = isoDay(new Date())) {
  db = db || {}; const orders = db.orders || [], products = db.products || [], ships = db.shipments || [];
  const pName = Object.fromEntries(products.map(p => [p.sku, clip(p.name, 60)]));
  const S = stockAll(db), F = cashForecast(db, { today });
  const monthStart = today.slice(0, 8) + "01", prevStart = addDays(monthStart, -1).slice(0, 8) + "01", prevEnd = addDays(monthStart, -1);
  const lyFrom = addDays(today, -365), lyTo = addDays(today, -365 + 60);
  // sales velocity: units per sku in approved orders of the last 60 days
  const vel = {}; orders.filter(o => o.status === "approved" && day(o.approvedAt) >= addDays(today, -60)).forEach(o => (o.lines || []).forEach(l => [l.sku, ...(l.extraSkus || [])].filter(Boolean).forEach(k => { vel[k] = (vel[k] || 0) + num(l.qty); })));
  const ful = o => o.status !== "approved" ? "" : (o.ful || (o.engrave ? "engrave" : "packing"));
  const minMargin = num(db.settings?.minMargin) / 100 || 0;
  const thisSeasonOrgs = new Set(orders.filter(o => day(o.createdAt) >= addDays(today, -90)).map(orgOf));
  return {
    today,
    finance: {
      forecast: { start: r0(F.start), hasStart: F.hasStart, totalIn: r0(F.totalIn), totalOut: r0(F.totalOut), lowest: F.lowest && { week: F.lowest.from, balance: r0(F.lowest.balance) },
        weeks: F.weeks.map(w => ({ from: w.from, in: r0(w.in), out: r0(w.out), balance: r0(w.balance) })) },
      overdue: F.overdue.map(r => ({ order: r.id, ref: r.ref, org: clip(r.who, 60), amount: r0(r.amount), daysLate: daysBetween(r.due, today) })).slice(0, 30),
      upcomingOut: F.weeks.slice(0, 5).flatMap(w => w.items.filter(i => i.kind === "out").map(i => ({ what: clip(i.label, 80), amount: r0(i.amount), due: i.due, ship: i.ship || null }))).slice(0, 30),
      unscheduledOut: F.noDate.map(i => ({ what: clip(i.label, 80), amount: r0(i.amount), ship: i.ship })).slice(0, 20),
      pipeline: r0(F.pipeline),
      thisMonth: salesBetween(db, monthStart, today), lastMonth: salesBetween(db, prevStart, prevEnd),
      expenses: (db.expenses || []).filter(e => !e.off).map(e => ({ name: clip(e.name, 40), amount: r0(e.amount), every: e.every })),
    },
    stock: {
      items: products.map(p => { const x = S[p.sku] || {}; return { sku: p.sku, name: pName[p.sku], available: r0(x.available), reserved: r0(x.reserved), inTransit: r0(x.transit), eta: x.eta || "", min: r0(p.minStock), sold60d: r0(vel[p.sku]) }; })
        .filter(i => i.available || i.reserved || i.inTransit || i.min || i.sold60d).sort((a, b) => (a.available - a.min) - (b.available - b.min)).slice(0, 120),
      shipments: ships.filter(s => s.status !== "wh").map(s => { const c = shipCalc(JSON.parse(JSON.stringify(s))); return { ship: s.id, name: clip(s.name, 60), status: s.status, eta: s.eta || "", totalIls: r0(c.total), missingFx: c.missing, missingCbm: c.missingCbm, lines: (s.items || []).length, open: r0(shipPayments(JSON.parse(JSON.stringify(s))).left) }; }),
      season: db.settings?.season ? { name: clip(db.settings.season.name, 30), date: day(db.settings.season.date), deadline: day(db.settings.season.deadline), capacity: num(db.settings.season.capacity) } : null,
    },
    orders: {
      inWork: orders.filter(o => o.status === "approved" && ful(o) !== "shipped").map(o => ({ order: o.id, ref: o.ref, org: orgOf(o), boxes: num(o.boxes), stage: ful(o), wanted: day(o.date), daysLeft: o.date ? daysBetween(today, day(o.date)) : null, margin: o.frozen ? +num(o.frozen.margin).toFixed(3) : null })).slice(0, 80),
      pendingApproval: orders.filter(o => o.status === "pending").map(o => ({ order: o.id, ref: o.ref, org: orgOf(o), boxes: num(o.boxes), gross: r0(o.gross), hoursWaiting: Math.round((Date.now() - new Date(o.createdAt)) / 36e5) })).slice(0, 40),
      lowMargin: orders.filter(o => o.status === "approved" && o.frozen && minMargin && num(o.frozen.margin) < minMargin && day(o.approvedAt) >= addDays(today, -60)).map(o => ({ order: o.id, ref: o.ref, org: orgOf(o), margin: +num(o.frozen.margin).toFixed(3), net: r0(o.frozen.net) })).slice(0, 30),
      minMargin,
    },
    sales: {
      quotes: orders.filter(o => ["quote", "won", "lost"].includes(o.status) && day(o.createdAt) >= addDays(today, -60)).map(o => ({ order: o.id, ref: o.ref, org: orgOf(o), status: o.status, ageDays: daysBetween(day(o.createdAt), today), boxes: num(o.boxes), gross: r0(o.gross), agent: clip(o.agent, 30) })).slice(0, 60),
      byAgentThisMonth: salesBetween(db, monthStart, today).byAgent,
      lastYearSameTime: [...new Set(orders.filter(o => o.status === "approved" && day(o.approvedAt) >= lyFrom && day(o.approvedAt) <= lyTo).map(orgOf))].filter(n => n && !thisSeasonOrgs.has(n)).slice(0, 40),
    },
    marketing: {
      channels: Object.entries(orders.filter(o => day(o.createdAt) >= addDays(today, -90)).reduce((m, o) => { const k = clip(o.agent || "לא צוין", 30); m[k] = (m[k] || 0) + 1; return m; }, {})).map(([channel, orders]) => ({ channel, orders })),
      note: "אין חיבור לנתוני פרסום (Google/Meta). הערוץ נקבע לפי מה שהלקוח או היועץ בחרו בטופס.",
    },
    product: {
      items: products.filter(p => !p.hidden).map(p => ({ sku: p.sku, name: pName[p.sku], salePrice: num(p.salePrice), landedCost: +num(p.landedCost).toFixed(2), sold60d: r0(vel[p.sku]), available: r0(S[p.sku]?.available) })).slice(0, 160),
    },
    ops: {
      byStage: ["engrave", "packing", "ready"].map(st => ({ stage: st, orders: orders.filter(o => ful(o) === st).length, boxes: orders.filter(o => ful(o) === st).reduce((t, o) => t + num(o.boxes), 0) })),
      next14Days: orders.filter(o => o.status === "approved" && ful(o) !== "shipped" && o.date && daysBetween(today, day(o.date)) <= 14).map(o => ({ order: o.id, ref: o.ref, wanted: day(o.date), boxes: num(o.boxes), stage: ful(o), engrave: !!o.engrave })).slice(0, 60),
    },
    service: {
      late: orders.filter(o => o.status === "approved" && ful(o) !== "shipped" && o.date && day(o.date) < today).map(o => ({ order: o.id, ref: o.ref, org: orgOf(o), wanted: day(o.date), stage: ful(o) })).slice(0, 40),
      recentlyShipped: orders.filter(o => ful(o) === "shipped" && (o.fulLog || []).some(l => l.ful === "shipped" && day(l.at) >= addDays(today, -7))).map(o => ({ order: o.id, ref: o.ref, org: orgOf(o) })).slice(0, 40),
      quotesExpiring: orders.filter(o => o.status === "quote").map(o => ({ order: o.id, ref: o.ref, org: orgOf(o), ageDays: daysBetween(day(o.createdAt), today) })).filter(q => q.ageDays >= 5 && q.ageDays <= 14).slice(0, 30),
    },
  };
}

// ---------- prompts ----------
const AGENT_DIR = path.join(process.cwd(), "agents");
async function brief(id) { try { return await readFile(path.join(AGENT_DIR, id + ".md"), "utf8"); } catch (e) { return ""; } }

const RULES = `אתה חלק מהנהלת AI של "נויה במתנה" – חברת מארזי מתנה לארגונים בישראל. הבעלים: משה. כתוב בעברית פשוטה וקצרה.
כללים מחייבים:
- אתה רק מנתח וממליץ. אינך מבצע שום פעולה. כל פעולה כספית, רכש, שינוי מלאי או מחיר, או הודעה ללקוח/ספק – דורשת אישור של משה.
- כל טענה חייבת להישען על מספרים מהנתונים שקיבלת. אל תמציא נתונים. אם חסר מידע – כתוב מה חסר.
- מחירים ללקוחות מוצגים לפני מע״מ. מחיר מכירה בסיסי = פי 3 מעלות הקנייה. הזמנה מינימלית ₪3,000.
- עדיף מעט פריטים חשובים מאשר הרבה רעש. אם אין משהו חשוב – החזר רשימה ריקה.
- refs: השתמש רק במזהים שמופיעים בנתונים (order / ship / sku).
החזר JSON בלבד, בלי טקסט מסביב.`;

const ITEM_SCHEMA = `{"summary":"2-3 משפטים על המצב בתחום שלך",
"items":[{"kind":"finding|recommendation|approval|handoff","title":"עד 80 תווים","body":"עד 400 תווים: מה, למה, ומה להמליץ",
"evidence":[{"label":"…","value":"…"}],"impact":{"amount":0,"note":"…"},"refs":{"order":"","ship":"","sku":""},
"priority":1,"to":"moshe|ceo|finance|stock|orders|sales|marketing|product|ops|service"}]}
kind=approval כשנדרשת החלטה של משה (כסף, רכש, מחיר, הודעה החוצה). kind=handoff כשמנהל אחר צריך לבדוק משהו (to = המנהל). priority: 1 דחוף, 2 חשוב, 3 לידיעה. עד 6 פריטים.`;

// ---------- model call (Anthropic Messages API) ----------
export async function callModel({ system, user, model, maxTokens = 1800 }, fetchImpl = fetch) {
  const key = String(process.env.ANTHROPIC_API_KEY || "").trim().replace(/^["']|["']$/g, "");   // tolerate a stray space or quotes from copy-paste
  if (!key) throw Object.assign(new Error("ANTHROPIC_API_KEY לא מוגדר"), { code: "nokey" });
  const r = await fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Anthropic ${r.status}`);
  return { text: (j.content || []).filter(c => c.type === "text").map(c => c.text).join(""), usage: j.usage || {} };
}
export function parseJson(text) {
  const s = String(text || ""); const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

// ---------- turn model output into safe task records ----------
const KINDS = ["finding", "recommendation", "approval", "handoff"];
const TARGETS = ["moshe", "ceo", ...MANAGERS.map(m => m.id)];
export function sanitizeItems(out, from, db, at) {
  const ids = { order: new Set((db?.orders || []).map(o => o.id)), ship: new Set((db?.shipments || []).map(s => s.id)), sku: new Set((db?.products || []).map(p => p.sku)) };
  const items = Array.isArray(out?.items) ? out.items.slice(0, 8) : [];
  return items.map((it, i) => {
    const kind = KINDS.includes(it?.kind) ? it.kind : "finding";
    let to = TARGETS.includes(it?.to) ? it.to : (kind === "approval" ? "moshe" : "ceo");
    if (to === from) to = "ceo";
    const refs = {}; ["order", "ship", "sku"].forEach(k => { const v = String(it?.refs?.[k] || ""); if (v && ids[k].has(v)) refs[k] = v; });
    return {
      id: `${from}-${at.replace(/\D/g, "").slice(0, 12)}-${i}`, at, from, to, kind,
      title: clip(it?.title, 80) || "(ללא כותרת)", body: clip(it?.body, 600),
      evidence: (Array.isArray(it?.evidence) ? it.evidence : []).slice(0, 6).map(e => ({ label: clip(e?.label, 40), value: clip(e?.value, 60) })),
      impact: { amount: Math.round(num(it?.impact?.amount)), note: clip(it?.impact?.note, 120) },
      refs, priority: [1, 2, 3].includes(+it?.priority) ? +it.priority : 2,
      status: kind === "approval" ? "awaiting" : "open", thread: [],
    };
  }).filter(t => t.title && t.title !== "(ללא כותרת)");
}

// ---------- the daily run: managers in parallel, then the AI CEO ----------
export async function runDaily(db, store, { today = isoDay(new Date()), fetchImpl = fetch } = {}) {
  const at = new Date().toISOString(), snap = snapshot(db, today), log = { at, kind: "daily", calls: 0, errors: [], tokens: 0 };
  const open = (store.tasks || []).filter(t => ["open", "awaiting"].includes(t.status));
  let budget = MAX_CALLS();
  const call = async args => { if (budget-- <= 0) throw new Error("תקרת קריאות לריצה"); log.calls++; const r = await callModel(args, fetchImpl); log.tokens += (r.usage.input_tokens || 0) + (r.usage.output_tokens || 0); return r; };

  const reports = {};
  const one = async m => {
    const inbox = open.filter(t => t.to === m.id).slice(0, 10).map(t => ({ from: whoName(t.from), title: t.title, body: t.body }));
    const user = `תאריך: ${today}\nהתפקיד שלך: ${m.name}\n\nהנתונים שלך:\n${JSON.stringify(snap[m.id])}\n\nמשימות שמנהלים אחרים העבירו אליך:\n${JSON.stringify(inbox)}\n\nהחזר JSON במבנה:\n${ITEM_SCHEMA}`;
    try { const r = await call({ system: RULES + "\n\n" + (await brief(m.id)), user, model: MODEL() }); const out = parseJson(r.text);
      if (!out) throw new Error("תשובה לא תקינה"); reports[m.id] = { summary: clip(out.summary, 600), items: sanitizeItems(out, m.id, db, at) }; }
    catch (e) { log.errors.push(`${m.name}: ${clip(e.message, 120)}`); if (e.code === "nokey") throw e; }
  };
  const ids = (store.settings?.managers || MANAGERS.map(m => m.id));
  const list = MANAGERS.filter(m => ids.includes(m.id));
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(one));

  const all = Object.values(reports).flatMap(r => r.items);
  let ceo = null;
  if (all.length || Object.keys(reports).length) {
    const user = `תאריך: ${today}\nדוחות המנהלים:\n${JSON.stringify(Object.fromEntries(Object.entries(reports).map(([k, r]) => [whoName(k), { summary: r.summary, items: r.items.map(t => ({ id: t.id, kind: t.kind, to: t.to, title: t.title, body: t.body, impact: t.impact, priority: t.priority })) }])))}\n\nהחזר JSON:\n{"brief":"סיכום בוקר למשה, עד 5 שורות","decisions":[{"id":"מזהה פריט מהדוחות","why":"למה זה חשוב היום","recommend":"מה אתה ממליץ למשה להחליט"}],"conflicts":["סתירה בין מנהלים, אם יש"]}\nבחר עד 5 החלטות, הכי חשובות קודם.`;
    try { const r = await call({ system: RULES + "\n\n" + (await brief("ceo")), user, model: MODEL_TOP(), maxTokens: 2000 }); const out = parseJson(r.text);
      if (out) { const valid = new Set(all.map(t => t.id));
        ceo = { at, brief: clip(out.brief, 900), conflicts: (out.conflicts || []).slice(0, 5).map(c => clip(c, 200)),
          decisions: (out.decisions || []).filter(d => valid.has(d?.id)).slice(0, 5).map(d => ({ id: d.id, why: clip(d.why, 300), recommend: clip(d.recommend, 300) })) };
        ceo.decisions.forEach(d => { const t = all.find(x => x.id === d.id); if (t) { t.status = "awaiting"; t.ceo = { why: d.why, recommend: d.recommend }; } }); } }
    catch (e) { log.errors.push(`מנכ״ל AI: ${clip(e.message, 120)}`); }
  }
  return { tasks: all, reports, ceo, log, snapshotAt: today };
}

// ---------- weekly board ----------
export async function runBoard(db, store, { today = isoDay(new Date()), fetchImpl = fetch, topic = "" } = {}) {
  const at = new Date().toISOString(), log = { at, kind: "board", calls: 0, errors: [], tokens: 0 };
  const snap = snapshot(db, today);
  const ctx = { today, topic: clip(topic, 400), ceoBriefs: (store.ceo || []).slice(0, 7), openDecisions: (store.tasks || []).filter(t => t.status === "awaiting").slice(0, 15).map(t => ({ id: t.id, from: whoName(t.from), title: t.title, body: t.body, impact: t.impact })),
    kpis: { forecast: snap.finance.forecast, overdue: snap.finance.overdue.length, thisMonth: snap.finance.thisMonth, lastMonth: snap.finance.lastMonth, pipeline: snap.finance.pipeline } };
  const opinions = {};
  await Promise.all(DIRECTORS.map(async d => {
    try { log.calls++; const r = await callModel({ system: RULES + "\n\n" + (await brief(d.id)), model: MODEL_TOP(), maxTokens: 1500,
      user: `אתה ${d.name} בדירקטוריון. תפקידך לבקר ולאתגר, לא להסכים אוטומטית.\nהנתונים:\n${JSON.stringify(ctx)}\n\nהחזר JSON:\n{"verdict":"שורה אחת","challenges":["איפה ההנהלה טועה או מפספסת"],"risks":["סיכון + כמה הוא יכול לעלות"],"questions":["שאלה למשה"],"support":["החלטות פתוחות שאתה תומך בהן (id)"],"oppose":["החלטות שאתה מתנגד להן (id) + למה"]}` }, fetchImpl);
      log.tokens += (r.usage.input_tokens || 0) + (r.usage.output_tokens || 0);
      const o = parseJson(r.text) || {}; const L = (a, n) => (Array.isArray(a) ? a : []).slice(0, 6).map(x => clip(x, n));
      opinions[d.id] = { verdict: clip(o.verdict, 200), challenges: L(o.challenges, 300), risks: L(o.risks, 300), questions: L(o.questions, 200), support: L(o.support, 120), oppose: L(o.oppose, 300) }; }
    catch (e) { log.errors.push(`${d.name}: ${clip(e.message, 120)}`); }
  }));
  return { report: { at, today, topic: ctx.topic, opinions }, log };
}

// ---------- store maintenance (office/ai/state.bin) ----------
export function mergeDaily(store, run) {
  const s = { tasks: [], reports: {}, ceo: [], board: [], runs: [], settings: {}, ...store };
  const keep = s.tasks.filter(t => !(t.status === "open" && t.from !== "moshe" && t.kind !== "handoff" && run.reports[t.from]));   // yesterday's plain findings of a manager that reported again are replaced
  const cutoff = addDays(isoDay(new Date()), -90);
  s.tasks = [...run.tasks, ...keep].filter(t => ["open", "awaiting"].includes(t.status) || day(t.decidedAt || t.at) >= cutoff).slice(0, 400);
  s.reports = { ...s.reports, ...Object.fromEntries(Object.entries(run.reports).map(([k, r]) => [k, { at: run.log.at, summary: r.summary, count: r.items.length }])) };
  if (run.ceo) s.ceo = [run.ceo, ...s.ceo].slice(0, 30);
  s.runs = [run.log, ...s.runs].slice(0, 60);
  return s;
}
