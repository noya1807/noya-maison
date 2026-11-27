// Parity test: js/biz.mjs must calculate exactly like admin.html (shipCalc, shipPayments, stockAll).
// Takes the functions out of admin.html as written, runs both on the same sample data, compares the results.
// Run: node tools/test-biz.mjs   (tools/check.mjs runs it too, so a push with a difference is blocked)
import { readFileSync } from "fs";
import vm from "vm";
import assert from "assert/strict";

const root = new URL("..", import.meta.url).pathname;
const admin = readFileSync(root + "admin.html", "utf8");
const B = await import(root + "js/biz.mjs");

// pull one top-level declaration (const …; or function …{…}) out of admin.html by its start text
function grab(start) {
  const i = admin.indexOf(start); if (i < 0) throw new Error("not found in admin.html: " + start);
  if (start.startsWith("function")) { let d = 0, j = admin.indexOf("{", i); for (; j < admin.length; j++) { if (admin[j] === "{") d++; else if (admin[j] === "}" && --d === 0) break; } return admin.slice(i, j + 1); }
  return admin.slice(i, admin.indexOf("\n", i));
}
const code = ["function skuCosts", "const num=", "const money=", "const COSTS=", "const costMethod=", "function normShip", "const lineCur=", "const rateOf=", "const shipCurs=", "function shipCalc", "function shipPayments", "function stockAll"].map(grab).join("\n");
const ctx = vm.createContext({ db: null });
vm.runInContext(code + "\nthis.A={shipCalc,shipPayments,stockAll,skuCosts};", ctx);
const A = ctx.A;

const clone = o => JSON.parse(JSON.stringify(o));
const sample = {
  products: [], suppliers: [], stockAdj: [{ sku: "KT01", qty: -3 }, { sku: "CN02", qty: 10 }],
  shipments: [
    { id: "s1", name: "מכולה 1", status: "wh", currency: "USD", fxRates: { USD: 3.7, CNY: 0.51 }, eta: "2026-10-01", vatRate: 18,
      costs: { freight: 4200, customs: 1800, clearance: 900, fees: 120 }, costMethod: { freight: "vol" }, paid: { goods: true }, due: { freight: "2026-12-10" },
      items: [{ sku: "KT01", qty: 500, unitPrice: 2.4, cbm: 3.2, supplier: "Yiwu A" }, { sku: "CN02", qty: 1200, unitPrice: 9.5, currency: "CNY", cbm: 6.1 }, { name: "no sku", qty: 10, unitPrice: 1 }] },
    { id: "s2", name: "מכולה 2", status: "sea", currency: "USD", fx: 3.65, eta: "2027-01-20", costs: { freight: 3000, other: 200 },
      items: [{ sku: "KT01", qty: 800, unitPrice: 2.2 }, { sku: "HM05", qty: 300, unitPrice: 4, currency: "EUR" }] },
    { id: "s3", name: "ריקה", status: "order", items: [] }],
  orders: [
    { id: "o1", status: "approved", gross: 11800, lines: [{ sku: "KT01", qty: 100 }, { sku: "CN02", qty: 50, extraSkus: ["HM05"] }] },
    { id: "o2", status: "pending", gross: 5900, lines: [{ sku: "KT01", qty: 40 }] },
    { id: "o3", status: "quote", lines: [{ sku: "KT01", qty: 999 }] },
    { id: "o4", status: "cancelled", lines: [{ sku: "CN02", qty: 999 }] }],
};

let n = 0;
for (const s of sample.shipments) {
  assert.deepEqual(B.shipCalc(clone(s)), JSON.parse(JSON.stringify(A.shipCalc(clone(s)))), "shipCalc differs for " + s.id);
  const a = JSON.parse(JSON.stringify(A.shipPayments(clone(s)))), b = JSON.parse(JSON.stringify(B.shipPayments(clone(s))));
  assert.deepEqual(b.open.map(r => [r.k, +r.amount.toFixed(6), r.due, r.paid]), a.open.map(r => [r.k, +r.amount.toFixed(6), r.due, r.paid]), "shipPayments differs for " + s.id);
  assert.equal(+b.left.toFixed(6), +a.left.toFixed(6)); n += 2;
}
ctx.db = clone(sample);
assert.deepEqual(B.stockAll(clone(sample)), JSON.parse(JSON.stringify(vm.runInContext("A.stockAll()", ctx))), "stockAll differs"); n++;
assert.deepEqual(B.skuCosts(clone(sample)), JSON.parse(JSON.stringify(vm.runInContext("A.skuCosts()", ctx))), "skuCosts differs"); n++;

// forecast sanity: money in, money out, balance
const db = clone(sample);
db.settings = { payTermsDays: 30, cashStart: { amount: 50000, date: "2026-12-01" } };
db.orders[0].approvedAt = "2026-11-20T10:00:00Z"; db.orders[0].paid = { sum: 1800 };
db.expenses = [{ id: "e1", name: "שכירות", amount: 6000, every: "month", day: 10 }, { id: "e2", name: "פעם אחת", amount: 1000, every: "once", date: "2026-12-15" }];
const f = B.cashForecast(db, { today: "2026-12-01", days: 90 });
assert.equal(f.weeks.length, 13);
assert.equal(Math.round(f.totalIn), 10000);                       // 11,800 − 1,800 paid, due 2026-12-20
assert.ok(f.weeks.some(w => w.items.some(i => i.label === "שכירות" && i.due === "2026-12-10")));
assert.equal(f.weeks.flatMap(w => w.items).filter(i => i.label === "שכירות").length, 3);   // Dec 10, Jan 10, Feb 10
assert.equal(Math.round(f.weeks.at(-1).balance), Math.round(50000 + f.totalIn - f.totalOut));
n += 5;
console.log(`✓ biz.mjs matches admin.html (${n} checks)`);
