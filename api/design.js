// NOYA AI Gift Designer — server function (Vercel, Node 18+). Holds the OpenAI key; the page never sees it.
// POST {layout: dataURL (live composition sketch), items:[{id,name,qty,role,heightCm}], pack:{id,name}, background, variant}
// → {image: dataURL}
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readCatalog } from "./catalog.js";

export const config = { maxDuration: 120 };

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || "medium";      // low | medium | high
const SIZE = process.env.OPENAI_IMAGE_SIZE || "1536x1024";
const FIDELITY = process.env.OPENAI_INPUT_FIDELITY || "";          // set "high" if the model supports it
const DAILY_LIMIT = +(process.env.DAILY_LIMIT || 300);             // soft guard per server instance
const ROOT = process.cwd();
let day = "", count = 0;

const clean = (s, n = 60) => String(s || "").replace(/[^\p{L}\p{N} +\-.'"]/gu, "").slice(0, n);
const PACK_FILES = { box0: "pack/box0.webp", box1: "pack/box1.webp", box2: "pack/box2.webp", "42": "pack/42.webp", "31": "pack/31.webp", "39": "pack/39.webp" };

function prompt(items, pack, variant, manual) {
  const list = items.map((it, i) => `${i + 1}. ${it.name} — quantity ${it.qty}, about ${it.heightCm} cm tall, role: ${it.role}`).join("\n");
  const hero = items.find(i => i.role === "hero");
  const noPack = pack.id === "none"; // customer chose no packaging: products only
  const moods = [
    "warm beige seamless backdrop with soft palm-leaf shadows from an upper-left window",
    "creamy limestone backdrop, gentle morning light, delicate leaf shadows on the wall",
    "soft sand-coloured studio sweep, golden late-afternoon light, long soft shadows",
    "light linen-toned backdrop, airy diffused daylight, subtle botanical shadows",
  ];
  return `You are the senior gift stylist and editorial product photographer of NOYA MAISON — luxury lifestyle, premium gift styling, elegant French home aesthetic.
Create ONE photorealistic catalogue photograph of a styled gift set.

INPUT IMAGES
- Image 1: a rough layout sketch built from the real products. Use it for which products appear, their relative scale and a starting arrangement${manual ? " — the customer arranged it by hand, so keep their placement closely" : ", then improve the styling like a professional designer would"}.
- Next images: the ONLY products in the set, one photo each (in the order listed below)${noPack ? "" : ", followed by the packaging"}.
- Last image: style reference for mood, light, palette and propping only. Never copy its products.

PRODUCTS (include every one, exactly this quantity, nothing else):
${list}
${noPack ? "No packaging: arrange the products freely on the surface as an open styled set, with no box, bag or gift container." : `Packaging: ${pack.name}, standing at the back as the backdrop of the set.`}

FIDELITY
Reproduce each product as photographed: same shape, proportions, colours, materials, logos and label text (e.g. NOYA, MAISON NOYA). Keep true relative sizes from the heights given. Do not add, duplicate or remove products, and do not invent brands.

ART DIRECTION
- Asymmetric pyramid composition; ${hero ? `"${hero.name}" is the hero, slightly elevated near the optical centre` : "pick the most premium item as the hero, slightly elevated near the optical centre"}.
- Tall pieces behind, mid-height supporting items around the hero, small accents in front; lying items placed diagonally to lead the eye.
- Natural 15–30% overlap so the set reads as one group, with every label still readable. Height rhythm: avoid neighbours of equal height.
- Balanced colours: spread dark items, keep one accent colour per side. Rich and abundant but never cluttered; generous negative space above.
- Neutral styling props allowed (travertine risers, a soft linen drape, a few dried botanicals) — they must not look like products.
- Set: ${moods[variant % moods.length]}.
- Camera: slightly elevated three-quarter view, about 25–30° above the set, looking gently down so the top surfaces, the riser tops and some of the floor in front are visible; keep every product upright, true to shape and undistorted.
- Lighting: soft directional daylight, realistic contact shadows, gentle depth of field, high-end commercial catalogue quality.`;
}

export default async function handler(req, res) {
  if (req.method === "GET") { res.status(200).json({ ok: !!process.env.OPENAI_API_KEY, model: MODEL }); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(500).json({ error: "OPENAI_API_KEY is not set" }); return; }
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; count = 0; }
  if (++count > DAILY_LIMIT) { res.status(429).json({ error: "daily limit reached" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const items = (body.items || []).filter(i => /^[a-z0-9]{2,20}$/i.test(i.id)).slice(0, 12)
      .map(i => ({ id: i.id, name: clean(i.name), qty: Math.max(1, Math.min(20, +i.qty || 1)), role: clean(i.role, 12), heightCm: Math.max(1, Math.min(80, +i.heightCm || 10)) }));
    if (items.length < 1) { res.status(400).json({ error: "need at least 1 product" }); return; }
    const pack = { id: clean(body.pack?.id, 8), name: clean(body.pack?.name) };
    const variant = Math.abs(+body.variant || 0);

    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", prompt(items, pack, variant, !!body.manual));
    form.append("size", SIZE);
    form.append("quality", QUALITY);
    form.append("n", "1");
    if (FIDELITY) form.append("input_fidelity", FIDELITY);
    const add = (buf, name, type) => form.append("image[]", new Blob([buf], { type }), name);

    const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(body.layout || "");
    if (m) add(Buffer.from(m[2], "base64"), `layout.${m[1] === "jpeg" ? "jpg" : m[1]}`, `image/${m[1]}`);
    let cat = null;
    for (const it of items) {
      if (/^\d{2}$/.test(it.id)) { add(await readFile(path.join(ROOT, "img", "orig", `${it.id}.jpg`)), `product_${it.id}.jpg`, "image/jpeg"); continue; }
      // products added in the admin screen: original photo lives in Blob storage
      cat = cat || await readCatalog().catch(() => null);
      const url = cat?.products?.find(p => p.id === it.id)?.origUrl;
      if (url) { const r = await fetch(url); if (r.ok) add(Buffer.from(await r.arrayBuffer()), `product_${it.id}.jpg`, r.headers.get("content-type") || "image/jpeg"); }
    }
    const pf = PACK_FILES[pack.id];
    if (pf) add(await readFile(path.join(ROOT, "img", pf)), `packaging.${pf.split(".").pop()}`, pf.endsWith("webp") ? "image/webp" : "image/jpeg");
    add(await readFile(path.join(ROOT, "img", "style", `s${(variant % 5) + 1}.jpg`)), "style_reference.jpg", "image/jpeg");

    const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    const j = await r.json();
    if (!r.ok) { res.status(502).json({ error: j?.error?.message || `OpenAI ${r.status}` }); return; }
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) { res.status(502).json({ error: "no image returned" }); return; }
    res.status(200).json({ image: `data:image/png;base64,${b64}` });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
