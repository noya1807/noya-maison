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
const cleanDims = s => String(s || "").replace(/[^\p{L}\p{N} +\-.,()x/]/gu, "").slice(0, 320);
// boxed products whose clean product photo shows no box: their card photo shows the real (square) retail box
const BOX_REF = { p108: "ph/p108.webp", p109: "ph/p109.webp", p110: "ph/p110.webp", p111: "ph/p111.webp" };
const PACK_FILES = { box0: "pack/box0.webp", box1: "pack/box1.webp", box2: "pack/box2.webp", "42": "pack/42.webp", "31": "pack/31.webp", "39": "pack/39.webp" };

// largest real dimension (cm) of an item: from its REAL SIZE text, else its height
function sizeCm(it) {
  const nums = (String(it.dims || "").match(/\d+(?:\.\d+)?(?=\s*cm)/g) || []).map(Number).filter(n => n > 0 && n < 400);
  const fromDims = nums.length ? Math.max(...nums.filter(n => n <= 120)) : 0;   // ignore "when open" sizes of folded textiles
  return fromDims > 0 ? fromDims : Math.max(it.heightCm, it.widthCm || 0);
}
function sizeLadder(items) {
  const L = items.map(it => ({ n: it.name, c: sizeCm(it) })).sort((a, b) => b.c - a.c);
  if (L.length < 2) return "";
  const big = L[0].c;
  const rows = L.map(x => `- ${x.n}: about ${Math.round(x.c * 10) / 10} cm at its largest = ${Math.round(x.c / big * 100)}% of the largest item`).join("\n");
  const a = L[0], z = L[L.length - 1];
  return `SIZE LADDER (true scale — the most important rule after product fidelity). Biggest to smallest, by each product's largest real dimension:
${rows}
Render these ratios literally on screen: "${a.n}" must look about ${Math.max(1, Math.round(a.c / z.c * 10) / 10)} times as big as "${z.n}". A product's on-screen size must follow this ladder, never its importance, its price or how close it is to the camera; small items stay small even when they are the hero, and a big item is never shrunk to fit. Check every pair of neighbours against the ladder before finishing.
`;
}
function prompt(items, pack, variant, manual) {
  const list = items.map((it, i) => `${i + 1}. ${it.name} — quantity ${it.qty}, ${it.dims ? `REAL SIZE: ${it.dims}` : `about ${it.heightCm} cm tall${it.widthCm ? ` and ${it.widthCm} cm wide` : ""}`}, role: ${it.role}${it.kind === "candleholder" ? " — candle holder" + (it.parts ? ` SET: ${it.parts.length} separate pieces per set with DIFFERENT heights — ${it.parts.map((h, k) => `${k === 0 ? "tall" : k === it.parts.length - 1 ? "short" : "middle"} ${h} cm`).join(", ")} (show all ${it.parts.length * it.qty} pieces, each at its own true height)` : "") : it.kind === "surface" ? " — serving surface (board / tray / plate)" : it.kind === "diffuser" ? " — reed diffuser" : it.kind === "bowl" ? " — decorative bowl" : ""}${it.box ? ` — WITH ITS OWN RETAIL BOX behind it${BOX_REF[it.id] ? ` (its box is the SQUARE box shown in image "box_reference_${it.id}"; copy that box only)` : ""}` : ""}${it.flowers ? ` — VASE WITH FLOWERS: it must hold ${it.flowers}, exactly as in its product photo (mandatory, never show this vase empty)` : ""}${it.candles ? ` — HOLDER WITH CANDLES: it must hold ${it.candles}, exactly as in its product photo (mandatory, never remove the candles)` : ""}`).join("\n");
  const boxed = items.filter(i => i.box), holders = items.filter(i => i.kind === "candleholder"), surfaces = items.filter(i => i.kind === "surface"), diffusers = items.filter(i => i.kind === "diffuser"), bowls = items.filter(i => i.kind === "bowl");
  const hero = items.find(i => i.role === "hero");
  const SALAD_BOWLS = ["p123", "p125", "p118"], SERVERS = ["p55"];
  const sBowl = items.find(i => SALAD_BOWLS.includes(i.id)), sServ = items.find(i => SERVERS.includes(i.id));
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
- Image 1: a rough layout sketch built from the real products, drawn TO TRUE SCALE. Use it for which products appear, their exact relative sizes (keep the same size ratios as in the sketch) and a starting arrangement${manual ? " — the customer arranged it by hand, so keep their placement closely" : ", then improve the styling like a professional designer would"}.
- Next images: the ONLY products in the set, one photo each (in the order listed below)${items.some(i => i.box && BOX_REF[i.id]) ? `, then "box_reference" photos that show the real retail box of some products — use them ONLY for that box's shape, colour and printed design; ignore everything else in them (books, stones, flowers, refill bottles)` : ""}${noPack ? "" : ", followed by the packaging"}.
- There is NO style reference image: build the set and mood only from the ART DIRECTION below. Every box, bag or package in the picture must come from the product photos, the box_reference photos or the chosen packaging photo — never from memory or older NOYA designs (for example, never a dark brown/black "MAISON NOYA" box with gold edges, never a cylindrical tube).

PRODUCTS (include every one, exactly this quantity, nothing else):
${list}

${sizeLadder(items)}
${noPack ? "No packaging: arrange the products freely on the surface as an open styled set, with no box, bag or gift container." : `Packaging: ${pack.name}, standing at the back as the backdrop of the set.`}

FIDELITY
Reproduce each product as photographed: same shape, proportions, colours, materials, and any logo or label text that is physically printed on it. Keep true relative sizes: use each product's REAL SIZE where given (length, width, diameter, height) and the heights for the rest, so every piece keeps its real proportions next to the others — for example a 24 cm long flat tray is clearly longer than a 21 cm vase is tall, and a 25.5 cm bowl is wide and low. Never enlarge, shrink, stretch or reshape a product to fit the composition. Each product photo is shot at its own zoom, so the size of a product inside its photo means nothing — size every product only from its REAL SIZE / height in the list and from the layout sketch. Do not add, duplicate or remove products, and do not invent brands.
CANDLE HOLDERS WITH CANDLES (mandatory): every holder marked "HOLDER WITH CANDLES" must appear with exactly the candles named for it, as in its product photo — same candle type, colour, size and whether it is lit; one candle in every piece of the set. Never remove these candles, never leave such a holder empty and never swap the candle type. They are part of the product presentation, not extra props.
VASES WITH FLOWERS (mandatory): every vase marked "VASE WITH FLOWERS" must appear holding exactly the flowers named for it, styled as in its product photo — same flower type, colour and amount, stems inside the vase, the bouquet in natural proportion to the vase (not oversized). Never show such a vase empty and never swap its flowers for others. These flowers are part of the product presentation, not extra props.
STRICT PRODUCT FIDELITY: the products are real items for sale and must look identical to their photos and to the layout sketch. Do not restyle, redesign, recolour, reshape, simplify or "improve" any product; keep every ridge, groove, pattern, speckle, texture, finish and proportion exactly as shown. When in doubt, copy the product more literally, not more creatively.
CLEAN LIGHTING ON PRODUCTS: the product photos were shot in other light and may contain baked-in shadows, dark patches, grey shading or reflections from that shoot. These are NOT part of the product: remove them and relight every product evenly with this scene's soft light, so each surface shows its true clean colour (a white piece stays clean white all over). Keep only natural soft scene shading and a gentle contact shadow on the surface beneath each item.
${boxed.length ? `ORIGINAL RETAIL BOXES (style them like a top prop stylist): each product marked "WITH ITS OWN RETAIL BOX" comes with its own branded box, visible in its photo. Place that box directly BEHIND its own product as an elegant backdrop for it:
- The box stands upright on the same surface or riser, one step back, offset about a quarter to one side of the product and turned 10–20° toward the camera, so its front panel and logo read clearly.
- The product stands in front and overlaps the lower third of its box; the box is never in front of, beside, or far away from its product, never lying flat, never open, never floating.
- Keep true scale (a box is only slightly taller and wider than its product) and reproduce it exactly as in the photo — same colour, size, finish and printed design.
- Diffuser boxes are SQUARE/rectangular cartons exactly as photographed. NEVER draw a round cylindrical tube box for any product — that is a discontinued design.
- Boxes form the back layer of the composition: taller boxes furthest back, staggered heights, each box partly hidden by its product, with soft natural shadows between box and product.
- Only these ${boxed.length} product(s) get a box; do not add or duplicate boxes for any other product.
` : ""}${holders.length ? `CANDLE HOLDERS: most candle holder products are sold as a SET of one TALL and one SHORT piece (sometimes three). For every holder listed as a SET, show exactly that number of separate pieces with clearly different heights in the listed proportions (for example 17.5 cm next to 13 cm): the taller one slightly behind, the shorter one in front. Never make the pieces the same height, never merge them into one, never show only one piece of a set. Keep all candle holders together, standing side by side as one family group (a pair or trio), close enough to almost touch, tall one slightly behind and the shorter one in front of it so the heights step down gracefully. A candle holder pair is never split up or placed apart from its partner.
` : ""}${surfaces.length ? `FLAT TRAY AS THE STAGE — style like a senior set designer: the flat tray (or board/plate) becomes the centre of the design. Lay it flat on the surface, turned slightly diagonal to the camera, and style 2–3 of the set's products ON it, in this order of priority:
1. ${diffusers.length ? `The reed diffuser ("${diffusers[0].name}") stands at the back of the tray, a little to one side, its reeds rising up — the tallest item on the tray.` : "If there is a reed diffuser in the set, it stands at the back of the tray, a little to one side, reeds rising up — the tallest item on the tray."}
2. ${holders.length ? "The candle holder set stands beside it on the tray if it fits naturally: tall piece behind, short piece in front." : "If there is a candle holder pair and it fits naturally, it stands beside the diffuser: tall piece behind, short piece in front."}
3. One small item from the set in front to close the group — a candle, a small vase or a small cup (only products that are in the set; never add new ones). If a product has its own retail box, the box stands behind the tray, not on it.
- The tray itself stays exactly as in its photo — same outline (for example a pebble shape), colour, rim and size; never swap it for a different tray.
- Leave about a third of the tray surface empty so it still clearly reads as a tray.
- Every item stands fully on the tray: nothing hangs over the edge, nothing is stacked on another item.
- Heights step down from back to front (diffuser → tall holder → short holder → small item) in a gentle pyramid.
- Never place textiles, boards, other trays or large boxes on the tray. If there is more than one surface, use the flattest/largest as the stage and overlap the others underneath in a relaxed layer. A long board with a handle may instead lean upright at the back.
- Products that are not on the tray are arranged around it as part of the same composition.
` : ""}${bowls.length ? `DECORATIVE BOWL: a bowl may also act as a small stage — at most 1–2 small items inside it, and only if it looks natural; otherwise leave it empty and show its shape.
` : ""}PACKAGING DISCIPLINE (mandatory): the only packaging allowed in the picture is ${boxed.length ? `the own retail box of each product marked "WITH ITS OWN RETAIL BOX" (each box behind its own product, with exactly that product's printed design)` : "none from the products"}${noPack ? "" : `${boxed.length ? " and " : ""}the chosen packaging "${pack.name}"`}. Never add any other box, gift box, carton, bag, tissue paper, ribbon, tag, crate, basket or container — not copied from the style reference, not invented as a prop. If a product's photo shows a box but the product is NOT marked "WITH ITS OWN RETAIL BOX", show the product alone without that box. Never move one product's box to another product and never show a box without its product. Never draw any round cylindrical tube/canister box.
COMPLETE PRODUCTS: every product appears whole — never cut by the frame edge, by another item or by the riser; never chop off a rim, a top edge, a handle, a lid or the reeds. If a product photo or the layout sketch happens to be cropped, complete the missing part naturally (a round bowl is always a full round bowl with its entire rim visible).
${sBowl && sServ ? `SALAD BOWL + SERVERS (mandatory pairing): the salad servers ("${sServ.name}") always go WITH the bowl ("${sBowl.name}") — place them inside the bowl with the spoon and fork leaning together, their handles resting on the rim and sticking out diagonally over the edge, so they clearly belong to the bowl. Only if that hides the bowl's pattern, lay them right beside the bowl, touching it. Never place the servers apart from the bowl or elsewhere in the set. The bowl keeps its full rim visible.
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
      .map(i => ({ id: i.id, name: clean(i.name), qty: Math.max(1, Math.min(20, +i.qty || 1)), role: clean(i.role, 12), heightCm: Math.max(1, Math.min(80, +i.heightCm || 10)), widthCm: Math.max(0, Math.min(120, +i.widthCm || 0)), box: !!i.box, kind: ["candleholder", "surface", "diffuser", "bowl"].includes(i.kind) ? i.kind : "", dims: cleanDims(i.dims), flowers: clean(i.flowers || "", 80), candles: clean(i.candles || "", 80), parts: Array.isArray(i.parts) && i.parts.length > 1 ? i.parts.slice(0, 4).map(h => Math.max(1, Math.min(80, +h || 0))).filter(h => h > 0) : null }));
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
    for (const it of items) if (it.box && BOX_REF[it.id]) {
      const b = await readFile(path.join(ROOT, "img", BOX_REF[it.id])).catch(() => null);
      if (b) add(b, `box_reference_${it.id}.webp`, "image/webp");
    }
    const pf = PACK_FILES[pack.id];
    if (pf) add(await readFile(path.join(ROOT, "img", pf)), `packaging.${pf.split(".").pop()}`, pf.endsWith("webp") ? "image/webp" : "image/jpeg");
    else if (pack.id && pack.id !== "none") {   // catalogue packaging: clean photo shipped with the site
      const pb = await readFile(path.join(ROOT, "img", "orig", `${pack.id.replace(/[^a-z0-9]/gi, "")}.jpg`)).catch(() => null);
      if (pb) add(pb, "packaging.jpg", "image/jpeg");
    }
    // no style reference image: the old style shots contained discontinued products/boxes that the model copied

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
