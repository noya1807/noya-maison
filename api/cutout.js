// Background removal for products added in the admin screen (GPT Image, transparent output). Admin only.
// POST {image: dataURL} as a logged-in admin (session cookie; old x-admin-key header is transitional) → {image: dataURL (PNG with transparency)}
import { adminOk } from "./_auth.js";
export const config = { maxDuration: 120 };
const MODEL = process.env.OPENAI_CUTOUT_MODEL || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  { const a = await adminOk(req); if (!a.ok) { res.status(a.status).json({ error: a.error }); return; } }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(500).json({ error: "OPENAI_API_KEY is not set" }); return; }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(body.image || "");
    if (!m) { res.status(400).json({ error: "bad image" }); return; }
    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", "Cut out the product from this studio photo onto a fully transparent background. Keep the product exactly as photographed: same shape, proportions, colours, materials, logos and label text. Remove the backdrop, surface, cast shadows and reflections. Frame the product centred with a small margin.");
    form.append("background", "transparent");
    form.append("output_format", "png");
    form.append("quality", process.env.OPENAI_CUTOUT_QUALITY || "medium");
    form.append("size", "auto");
    form.append("image[]", new Blob([Buffer.from(m[2], "base64")], { type: `image/${m[1]}` }), `product.${m[1] === "jpeg" ? "jpg" : m[1]}`);
    const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    const j = await r.json();
    if (!r.ok) { res.status(502).json({ error: j?.error?.message || `OpenAI ${r.status}` }); return; }
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) { res.status(502).json({ error: "no image returned" }); return; }
    res.status(200).json({ image: `data:image/png;base64,${b64}` });
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 200) }); }
}
