// Pre-push safety check: parses every page the way a browser does (each inline <script> ends at the
// first literal </script>) and compiles it, compiles every API file, and validates vercel.json.
// Run: node tools/check.mjs   (the git pre-push hook runs it and blocks the push on any error)
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

const root = new URL("..", import.meta.url).pathname;
let bad = 0;
const fail = (where, msg) => { bad++; console.error(`✗ ${where}: ${String(msg).split("\n").slice(0, 4).join(" | ")}`); };

for (const f of readdirSync(root).filter(f => f.endsWith(".html"))) {
  const s = readFileSync(join(root, f), "utf8");
  const re = /<script([^>]*)>/gi; let m, pos = 0, n = 0;
  while ((re.lastIndex = pos, m = re.exec(s))) {
    const end = s.indexOf("</script>", m.index + m[0].length);
    if (end < 0) { fail(f, "unclosed <script>"); break; }
    pos = end + 9;
    if (/src=/i.test(m[1])) continue;
    const code = s.slice(m.index + m[0].length, end);
    if (/json/i.test(m[1])) { try { JSON.parse(code); } catch (e) { fail(`${f} ld+json`, e.message); } continue; }
    n++;
    const isModule = /type=["']?module/i.test(m[1]);
    const tmp = join(tmpdir(), `chk-${process.pid}-${n}.${isModule ? "mjs" : "js"}`);
    writeFileSync(tmp, code);
    try { execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" }); }
    catch (e) { fail(`${f} script #${n} (line ~${s.slice(0, m.index).split("\n").length})`, e.stderr?.toString() || e.message); }
  }
}
for (const f of readdirSync(join(root, "api")).filter(f => f.endsWith(".js"))) {
  try { execFileSync(process.execPath, ["--check", join(root, "api", f)], { stdio: "pipe" }); }
  catch (e) { fail(`api/${f}`, e.stderr?.toString() || e.message); }
}
try { JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")); } catch (e) { fail("vercel.json", e.message); }

if (bad) { console.error(`\n${bad} error(s) – push blocked.`); process.exit(1); }
console.log("✓ all pages, scripts and API files are valid");
