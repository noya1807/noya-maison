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
  const list = items.map((it, i) => `${i + 1}. ${it.name} — quantity ${it.qty}, about ${it.heightCm} cm tall, role: ${it.role}${it.kind === "candleholder" ? " — candle holder" + (it.parts ? ` SET: ${it.parts.length} separate pieces per set with DIFFERENT heights — ${it.parts.map((h, k) => `${k === 0 ? "tall" : k === it.parts.length - 1 ? "short" : "middle"} ${h} cm`).join(", ")} (show all ${it.parts.length * it.qty} pieces, each at its own true height)` : "") : it.kind === "surface" ? " — serving surface (board / tray / plate)" : it.kind === "diffuser" ? " — reed diffuser" : it.kind === "bowl" ? " — decorative bowl" : ""}${it.box ? " — WITH ITS OWN RETAIL BOX behind it" : ""}`).join("\n");
  const boxed = items.filter(i => i.box), holders = items.filter(i => i.kind === "candleholder"), surfaces = items.filter(i => i.kind === "surface"), diffusers = items.filter(i => i.kind === "diffuser"), bowls = items.filter(i => i.kind === "bowl");
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
Reproduce each product as photographed: same shape, proportions, colours, materials, and any logo or label text that is physically printed on it. Keep true relative sizes from the heights given. Do not add, duplicate or remove products, and do not invent brands.
STRICT PRODUCT FIDELITY: the products are real items for sale and must look identical to their photos and to the layout sketch. Do not restyle, redesign, recolour, reshape, simplify or "improve" any product; keep every ridge, groove, pattern, speckle, texture, finish and proportion exactly as shown. When in doubt, copy the product more literally, not more creatively.
CLEAN LIGHTING ON PRODUCTS: the product photos were shot in other light and may contain baked-in shadows, dark patches, grey shading or reflections from that shoot. These are NOT part of the product: remove them and relight every product evenly with this scene's soft light, so each surface shows its true clean colour (a white piece stays clean white all over). Keep only natural soft scene shading and a gentle contact shadow on the surface beneath each item.
${boxed.length ? `ORIGINAL RETAIL BOXES (style them like a top prop stylist): each product marked "WITH ITS OWN RETAIL BOX" comes with its own branded box, visible in its photo. Place that box directly BEHIND its own product as an elegant backdrop for it:
- The box stands upright on the same surface or riser, one step back, offset about a quarter to one side of the product and turned 10–20° toward the camera, so its front panel and logo read clearly.
- The product stands in front and overlaps the lower third of its box; the box is never in front of, beside, or far away from its product, never lying flat, never open, never floating.
- Keep true scale (a box is only slightly taller and wider than its product) and reproduce it exactly as in the photo — same colour, size, finish and printed design.
- Boxes form the back layer of the composition: taller boxes furthest back, staggered heights, each box partly hidden by its product, with soft natural shadows between box and product.
- Only these ${boxed.length} product(s) get a box; do not add or duplicate boxes for any other product.
` : ""}${holders.length ? `CANDLE HOLDERS: most candle holder products are sold as a SET of one TALL and one SHORT piece (sometimes three). For every holder listed as a SET, show exactly that number of separate pieces with clearly different heights in the listed proportions (for example 17.5 cm next to 13 cm): the taller one slightly behind, the shorter one in front. Never make the pieces the same height, never merge them into one, never show only one piece of a set. Keep all candle holders together, standing side by side as one family group (a pair or trio), close enough to almost touch, tall one slightly behind and the shorter one in front of it so the heights step down gracefully. A candle holder pair is never split up or placed apart from its partner.
` : ""}${surfaces.length ? `FLAT TRAY AS THE STAGE — style like a senior set designer: the flat tray (or board/plate) becomes the centre of the design. Lay it flat on the surface, turned slightly diagonal to the camera, and style 2–3 of the set's products ON it, in this order of priority:
1. ${diffusers.length ? `The reed diffuser ("${diffusers[0].name}") stands at the back of the tray, a little to one side, its reeds rising up — the tallest item on the tray.` : "If there is a reed diffuser in the set, it stands at the back of the tray, a little to one side, reeds rising up — the tallest item on the tray."}
2. ${holders.length ? "The candle holder set stands beside it on the tray if it fits naturally: tall piece behind, short piece in front." : "If there is a candle holder pair and it fits naturally, it stands beside the diffuser: tall piece behind, short piece in front."}
3. One small item from the set in front to close the group — a candle, a small vase or a small cup (only products that are in the set; never add new ones). If a product has its own retail box, the box stands behind the tray, not on it.
- Leave about a third of the tray surface empty so it still clearly reads as a tray.
- Every item stands fully on the tray: nothing hangs over the edge, nothing is stacked on another item.
- Heights step down from back to front (diffuser → tall holder → short holder → small item) in a gentle pyramid.
- Never place textiles, boards, other trays or large boxes on the tray. If there is more than one surface, use the flattest/largest as the stage and overlap the others underneath in a relaxed layer. A long board with a handle may instead lean upright at the back.
- Products that are not on the tray are arranged around it as part of the same composition.
` : ""}${bowls.length ? `DECORATIVE BOWL: a bowl may also act as a small stage — at most 1–2 small items inside it, and only if it looks natural; otherwise leave it empty and show its shape.
` : ""}NO ADDED TEXT: do not add any words, letters, numbers, logos, captions, signs, tags, cards or watermarks anywhere in the image. The only text allowed is what is already printed on a product in its photo.

ART DIRECTION
- Asymmetric pyramid composition; ${hero ? `"${hero.name}" is the hero, slightly elevated near the optical centre` : "pick the most premium item as the hero, slightly elevated near the optical centre"}.
- Tall pieces behind, mid-height supporting items around the hero, small accents in front; lying items placed diagonally to lead the eye.
- Natural 15–30% overlap so the set reads as one group, with any product label still readable. Height rhythm: avoid neighbours of equal height.
- Balanced colours: spread dark items, keep one accent colour per side. Rich and abundant but never cluttered; some negative space above.
- Neutral styling props allowed (travertine risers, a soft linen drape, a few dried botanicals) — they must not look like products.
- Set: ${moods[variant % moods.length]}.
- Camera: elevated three-quarter view, about 45–50° above the set, looking clearly down onto it so the top surfaces, the riser tops and the surface in front are clearly visible; keep every product upright, true to shape and undistorted.
- Framing: a closer shot — the product group fills about 75–85% of the frame width, with only a modest margin of backdrop around it; do not crop any product.
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
      .map(i => ({ id: i.id, name: clean(i.name), qty: Math.max(1, Math.min(20, +i.qty || 1)), role: clean(i.role, 12), heightCm: Math.max(1, Math.min(80, +i.heightCm || 10)), box: !!i.box, kind: ["candleholder", "surface", "diffuser", "bowl"].includes(i.kind) ? i.kind : "", parts: Array.isArray(i.parts) && i.parts.length > 1 ? i.parts.slice(0, 4).map(h => Math.max(1, Math.min(80, +h || 0))).filter(h => h > 0) : null }));
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
      if (/^[a-z0-9]{1,12}$/i.test(it.id)) {   // catalogue products: clean product photo shipped with the site
        const buf = await readFile(path.join(ROOT, "img", "orig", `${it.id}.jpg`)).catch(() => null);
        if (buf) { add(buf, `product_${it.id}.jpg`, "image/jpeg"); continue; }
      }
      // products added in the admin screen: original photo lives in Blob storage
      cat = cat || await readCatalog().catch(() => null);
      const url = cat?.products?.find(p => p.id === it.id)?.origUrl;
      if (url) { const r = await fetch(url); if (r.ok) add(Buffer.from(await r.arrayBuffer()), `product_${it.id}.jpg`, r.headers.get("content-type") || "image/jpeg"); }
    }
    const pf = PACK_FILES[pack.id];
    if (pf) add(await readFile(path.join(ROOT, "img", pf)), `packaging.${pf.split(".").pop()}`, pf.endsWith("webp") ? "image/webp" : "image/jpeg");
    else if (pack.id && pack.id !== "none") {   // catalogue packaging: clean photo shipped with the site
      const pb = await readFile(path.join(ROOT, "img", "orig", `${pack.id.replace(/[^a-z0-9]/gi, "")}.jpg`)).catch(() => null);
      if (pb) add(pb, "packaging.jpg", "image/jpeg");
    }
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
