// Shared admin check for the builder's admin endpoints (catalog, cutout).
// The underscore prefix keeps this file from being deployed as its own endpoint.
//
// Preferred: the back-office session cookie (noya_office), set by POST /api/office?a=login, which already has
// a lockout, a delay on every wrong password and an HttpOnly cookie. The page never holds the password.
// Transitional: the old x-admin-key header still works for now, but every wrong attempt is slowed down and
// counted, and after 8 wrong attempts in 15 minutes the header path is locked for 15 minutes.
import crypto from "node:crypto";

const COOKIE = "noya_office";
const secretBase = () => process.env.OFFICE_KEY || process.env.BLOB_READ_WRITE_TOKEN || "";
const sessKey = () => crypto.createHash("sha256").update("noya-office-sess-v1:" + (process.env.ADMIN_PASSWORD || "") + ":" + secretBase()).digest();

export function sessionOk(req) {
  try {
    if (!process.env.ADMIN_PASSWORD) return false;
    const t = (String(req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "=")) || "").slice(COOKIE.length + 1);
    if (!t.includes(".")) return false;
    const [body, sig] = t.split(".");
    const good = crypto.createHmac("sha256", sessKey()).update(body).digest("base64url");
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
    return JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now();
  } catch (e) { return false; }
}

function samePassword(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

let fails = [], lockUntil = 0;   // per server instance, like the back-office login

// → {ok:true} | {ok:false, status:401|429, error}
export async function adminOk(req) {
  if (!process.env.ADMIN_PASSWORD) return { ok: false, status: 401, error: "סיסמת מנהל שגויה" };
  if (sessionOk(req)) return { ok: true };
  const key = req.headers["x-admin-key"];
  if (!key) return { ok: false, status: 401, error: "צריך להתחבר מחדש" };
  const now = Date.now();
  if (now < lockUntil) return { ok: false, status: 429, error: "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות." };
  if (samePassword(key, process.env.ADMIN_PASSWORD)) return { ok: true };
  fails = fails.filter(t => now - t < 15 * 60e3); fails.push(now);
  if (fails.length >= 8) { lockUntil = now + 15 * 60e3; fails = []; }
  await new Promise(r => setTimeout(r, 800));
  return { ok: false, status: 401, error: "סיסמת מנהל שגויה" };
}
