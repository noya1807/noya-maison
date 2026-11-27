// NOYA business core — pure calculations, no network, no secrets. Used by:
//   • admin.html (Command Center, via dynamic import("/js/biz.mjs"))
//   • the server (api/office.js → AI managers' daily snapshot)
// shipCalc / shipPayments / stockAll mirror the functions of the same name in admin.html line for line.
// tools/test-biz.mjs checks on every push that both give exactly the same results, so they cannot drift apart.

export const num = v => { const n = parseFloat(String(v ?? "").replace(/[,₪$€\s]/g, "")); return isFinite(n) ? n : 0; };

// ---------- import / containers (same as admin.html) ----------
export const COSTS = [["originFreight", "הובלה בארץ המקור עד הנמל (₪)", "vol"], ["freight", "הובלה ימית (₪)", "vol"], ["port", "נמל ואחסנה (₪)", "vol"], ["clearance", "עמיל מכס ושחרור (₪)", "vol"], ["local", "הובלה למחסן (₪)", "vol"], ["customs", "מכס ומיסים (₪)", "val"], ["fees", "עמלות – Alibaba, בנק וכו׳ (₪)", "val"], ["other", "אחר (₪)", "val"]];
const costMethod = (s, k) => (s.costMethod && s.costMethod[k]) || COSTS.find(c => c[0] === k)[2];
function normShip(s) {
  s.costs ??= {}; s.items ??= []; s.docs ??= []; s.fxRates ??= {};
  if (s.fx && !s.fxRates[s.currency]) { s.fxRates[s.currency] = s.fx; } delete s.fx;
  return s;
}
const lineCur = (s, i) => i.currency || s.currency || "USD";
const rateOf = (s, cur) => cur === "ILS" ? 1 : num(s.fxRates?.[cur]);
const shipCurs = s => [...new Set([s.currency || "USD", ...(s.items || []).map(i => lineCur(s, i))])];

export function shipCalc(s) {
  normShip(s);
  const missing = shipCurs(s).filter(c => (s.items || []).some(i => lineCur(s, i) === c && num(i.qty) * num(i.unitPrice)) && !rateOf(s, c));
  const lines0 = s.items.map(i => { const cur = lineCur(s, i), r = rateOf(s, cur), v = num(i.qty) * num(i.unitPrice); return { ...i, cur, orig: v, valueIls: v * r }; });
  const goodsIls = lines0.reduce((t, l) => t + l.valueIls, 0);
  const byCur = {}; lines0.forEach(l => { byCur[l.cur] = (byCur[l.cur] || 0) + l.orig; });
  const extra = COSTS.reduce((t, [k]) => t + num(s.costs?.[k]), 0);
  const volCosts = COSTS.reduce((t, [k]) => t + (costMethod(s, k) === "vol" ? num(s.costs?.[k]) : 0), 0), valCosts = extra - volCosts;
  const totalCbm = lines0.reduce((t, l) => t + num(l.cbm), 0);
  const missingCbm = lines0.filter(l => l.valueIls && !(num(l.cbm) > 0)).length;
  const byVol = volCosts > 0 && totalCbm > 0 && !missingCbm;
  const total = goodsIls + extra;
  const lines = lines0.map(l => { const sv = goodsIls > 0 ? l.valueIls / goodsIls : 0, sc = byVol ? num(l.cbm) / totalCbm : sv;
    const share = valCosts * sv + volCosts * sc; return { ...l, share, landed: num(l.qty) > 0 && l.valueIls ? (l.valueIls + share) / num(l.qty) : 0 }; });
  const bySup = {}; lines.forEach(l => { const k = String(l.supplier || s.supplier || "ללא ספק").trim() || "ללא ספק"; const o = bySup[k] ??= { goodsIls: 0, landed: 0, lines: 0 }; o.goodsIls += l.valueIls; o.landed += l.landed * num(l.qty); o.lines++; });
  return { ok: !missing.length, missing, goodsIls, byCur, extra, volCosts, valCosts, totalCbm, missingCbm, byVol, total, lines, bySup, factor: goodsIls > 0 ? total / goodsIls : 0 };
}

// open payments of a container (labels without currency formatting; amounts identical to admin.html)
export function shipPayments(s) {
  const c = shipCalc(s); s.paid ??= {}; s.due ??= {};
  const rows = [];
  if (c.goodsIls) rows.push({ k: "goods", label: "סחורה לספקים", amount: c.goodsIls });
  COSTS.forEach(([k, l]) => { const v = num(s.costs?.[k]); if (v) rows.push({ k, label: l.replace(" (₪)", ""), amount: v }); });
  const vr = num(s.vatRate ?? 18); if (c.total && vr) rows.push({ k: "vat", label: `מע״מ ${vr}% (חוזר בקיזוז)`, amount: c.total * vr / 100 });
  rows.forEach(r => { r.paid = !!s.paid[r.k]; r.due = s.due[r.k] || s.eta || ""; });
  const open = rows.filter(r => !r.paid);
  return { rows, open, left: open.reduce((t, r) => t + r.amount, 0), ok: c.ok };
}

// ---------- stock (same as admin.html) ----------
export function stockAll(db) {
  const m = {}; const o = k => m[k] ??= { received: 0, consumed: 0, reserved: 0, adj: 0, transit: 0, eta: "" };
  (db.shipments || []).forEach(s => (s.items || []).forEach(it => { if (!it.sku) return; const x = o(it.sku); if (s.status === "wh") x.received += num(it.qty); else { x.transit += num(it.qty); if (s.eta && (!x.eta || s.eta < x.eta)) x.eta = s.eta; } }));
  (db.orders || []).forEach(ord => { if (["cancelled", "quote", "lead", "won", "lost"].includes(ord.status)) return; (ord.lines || []).forEach(l => { if (!l.sku) return; [l.sku, ...(l.extraSkus || [])].forEach(k => { const x = o(k); if (ord.status === "approved") x.consumed += num(l.qty); else x.reserved += num(l.qty); }); }); });
  (db.stockAdj || []).forEach(a => { o(a.sku).adj += num(a.qty); });
  Object.values(m).forEach(x => { x.stock = x.received + x.adj - x.consumed; x.available = x.stock - x.reserved; });
  return m;
}

// ---------- dates ----------
export const isoDay = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDay(d); };
const dayOf = v => String(v || "").slice(0, 10);

// ---------- money coming in: approved orders not fully paid ----------
// due date = the order's own "payDue" if set, else approval date + payment terms (settings.payTermsDays, default 30)
export function receivables(db, today) {
  const terms = num(db.settings?.payTermsDays) || 30;
  return (db.orders || []).filter(o => o.status === "approved" && !o.paid?.full).map(o => {
    const left = Math.max(0, num(o.gross) - num(o.paid?.sum));
    const base = dayOf(o.approvedAt) || dayOf(o.createdAt) || today;
    const due = dayOf(o.payDue) || addDays(base, terms);
    return { id: o.id, ref: o.ref || "", who: o.customer?.org || o.customer?.name || o.ref || "", amount: left, due, late: due < today };
  }).filter(r => r.amount > 0);
}
// orders still waiting for approval (not counted as certain money, shown apart)
export function pipeline(db) {
  return (db.orders || []).filter(o => o.status === "pending").reduce((t, o) => t + num(o.gross), 0);
}

// ---------- fixed expenses (db.expenses: {id,name,amount,every:"month"|"week"|"year"|"once",day,date,start,end,off}) ----------
export function expenseDates(e, from, to) {
  if (e.off) return [];
  const out = [], start = dayOf(e.start) || from, end = dayOf(e.end) || to;
  const lo = start > from ? start : from, hi = end < to ? end : to;
  if (lo > hi) return out;
  if (e.every === "once") { const d = dayOf(e.date); if (d && d >= lo && d <= hi) out.push(d); return out; }
  if (e.every === "week") { let d = lo; const wd = Math.min(6, Math.max(0, num(e.day))); while (new Date(d + "T12:00").getDay() !== wd) d = addDays(d, 1); for (; d <= hi; d = addDays(d, 7)) out.push(d); return out; }
  const dom = Math.min(28, Math.max(1, num(e.day) || 1));
  let y = +lo.slice(0, 4), m = +lo.slice(5, 7);
  for (let i = 0; i < 400; i++) {
    const d = `${y}-${String(m).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;
    if (d > hi) break;
    if (d >= lo && (e.every !== "year" || m === (+dayOf(e.start).slice(5, 7) || m))) out.push(d);
    if (e.every === "year") y++; else { m++; if (m > 12) { m = 1; y++; } }
  }
  return out;
}

// ---------- 90-day cash forecast, by week ----------
// in = receivables by due date (overdue ones land in the first week) · out = open container payments + fixed expenses
// balance starts from settings.cashStart.amount when Moshe entered it, otherwise from 0 (then it reads as "net flow")
export function cashForecast(db, { today, days = 90 } = {}) {
  today = today || isoDay(new Date());
  const end = addDays(today, days - 1), weeks = [];
  for (let d = today; d <= end; d = addDays(d, 7)) weeks.push({ from: d, to: addDays(d, 6) < end ? addDays(d, 6) : end, in: 0, out: 0, items: [] });
  const wk = d => { if (!d || d < today) return weeks[0]; return weeks.find(w => d >= w.from && d <= w.to) || null; };
  const rec = receivables(db, today);
  rec.forEach(r => { const w = wk(r.due); if (w) { w.in += r.amount; w.items.push({ kind: "in", label: r.who, ref: r.ref, amount: r.amount, due: r.due, late: r.late }); } });
  const noDate = [];
  (db.shipments || []).forEach(s => { const P = shipPayments(s); P.open.forEach(p => { const item = { kind: "out", label: `${s.name || "מכולה"} · ${p.label}`, amount: p.amount, due: p.due, ship: s.id };
    if (!p.due) { noDate.push(item); return; } const w = wk(p.due); if (w) { w.out += p.amount; w.items.push(item); } }); });
  (db.expenses || []).forEach(e => expenseDates(e, today, end).forEach(d => { const w = wk(d); if (w) { w.out += num(e.amount); w.items.push({ kind: "out", label: e.name || "הוצאה", amount: num(e.amount), due: d, expense: e.id }); } }));
  const start = num(db.settings?.cashStart?.amount); let bal = start, low = null;
  weeks.forEach(w => { w.net = w.in - w.out; bal += w.net; w.balance = bal; if (!low || bal < low.balance) low = { from: w.from, balance: bal }; });
  return { today, end, weeks, start, hasStart: !!db.settings?.cashStart, totalIn: weeks.reduce((t, w) => t + w.in, 0), totalOut: weeks.reduce((t, w) => t + w.out, 0), lowest: low, noDate, overdue: rec.filter(r => r.late), pipeline: pipeline(db) };
}

// ---------- sales and profit for a period (approved orders, frozen calculation at approval) ----------
export function salesBetween(db, from, to) {
  const list = (db.orders || []).filter(o => o.status === "approved" && dayOf(o.approvedAt) >= from && dayOf(o.approvedAt) <= to);
  const net = list.reduce((t, o) => t + num(o.frozen?.net), 0), cost = list.reduce((t, o) => t + num(o.frozen?.cost), 0);
  const byAgent = {}; list.forEach(o => { const k = o.agent || "לא צוין"; const a = byAgent[k] ??= { orders: 0, net: 0, profit: 0 }; a.orders++; a.net += num(o.frozen?.net); a.profit += num(o.frozen?.profit); });
  return { orders: list.length, boxes: list.reduce((t, o) => t + num(o.boxes), 0), net, cost, profit: net - cost, margin: net > 0 ? (net - cost) / net : 0, byAgent };
}
