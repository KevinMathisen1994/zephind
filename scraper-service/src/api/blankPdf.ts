/**
 * AI detection of the listing broker's company details on a 販売図面 so they can
 * be blanked before the sheet is forwarded (帯替え). The browser renders pages to
 * JPEG and does the blanking; this only asks Gemini where the boxes go.
 */
import { Router, type Request } from "express";
import { HttpError, listOwned, requireOwned, requireUserId } from "../auth/authz";
import { db } from "../db";
import { route } from "./handler";

const MAX_PAGES = 10;
// The browser downscales to 1200px before upload; this caps a stored row.
const MAX_IMAGE_CHARS = 4_000_000;
const DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

const PROMPT = `
These images are pages of a Japanese real-estate sales sheet (販売図面 / マイソク).
Find every element that identifies the broker or company that issued the sheet (元付業者), so it can be blanked before the sheet is forwarded to a client.

BLANK:
- Company name, logo, slogan/tagline, company address
- TEL, FAX, mobile numbers, email, website URL, QR codes
- 宅建免許番号, 所属団体 / 保証協会, 担当者 / 取引士 names and their contact cells
- Internal reference codes of the company (社内管理項目, 物件番号, document IDs printed by the company)
Company details usually sit in a band (帯) along the bottom or top edge. Return ONE box covering that entire band edge to edge, frame included, together with any deal-terms cells inside it (取引態様, 手数料/報酬, 広告, 担当, 連絡先), because the whole band gets replaced.

KEEP (never box these):
- Property name, price, address/location of the property, access/stations, land/building data, legal restrictions
- Photos, maps, floor plans, rent rolls, yields, 備考 about the property, 引渡

Return JSON only:
{
  "companyTexts": ["distinctive strings exactly as printed: company name, phone/fax numbers, email, URL, license number. No field labels like 物件番号 or HP"],
  "boxes": [{ "page": 0, "label": "会社名", "box_2d": [ymin, xmin, ymax, xmax] }]
}
box_2d is normalized to 0-1000 on the page image. page is the 0-based index given before each image.
Labels are short Japanese (会社名, 連絡先, 免許番号, 担当者, 会社情報 etc.).
If nothing is found return {"companyTexts": [], "boxes": []}.
`.trim();

export interface DetectedBox {
  pageIndex: number;
  label: string;
  bbox: { x: number; y: number; width: number; height: number };
}

/** Converts Gemini's box_2d output to page-normalized boxes, dropping anything malformed or page-sized. */
export function parseDetection(raw: any, pageIndices: number[]): { companyTexts: string[]; boxes: DetectedBox[] } {
  const pages = new Set(pageIndices);
  const boxes: DetectedBox[] = [];
  for (const b of Array.isArray(raw?.boxes) ? raw.boxes : []) {
    const [ymin, xmin, ymax, xmax] = Array.isArray(b?.box_2d) ? b.box_2d.map(Number) : [];
    if (!pages.has(b?.page) || ![ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) continue;
    const x = Math.max(0, xmin / 1000), y = Math.max(0, ymin / 1000);
    const width = Math.min(1, xmax / 1000) - x, height = Math.min(1, ymax / 1000) - y;
    // A box over half the page would wipe property data; treat it as a model error.
    if (width <= 0.002 || height <= 0.002 || width * height > 0.5) continue;
    boxes.push({ pageIndex: b.page, label: String(b.label || "会社情報"), bbox: { x, y, width, height } });
  }
  const companyTexts = (Array.isArray(raw?.companyTexts) ? raw.companyTexts : [])
    .map((t: unknown) => String(t).trim())
    .filter((t: string) => t.length >= 3);
  return { companyTexts, boxes };
}

export const blankPdfRouter = Router();

/** Body: { pages: [{ pageIndex, image }] } with image as base64 JPEG. */
blankPdfRouter.post("/detect", route(async (req: Request) => {
  requireUserId(req);
  const pages = req.body?.pages;
  if (
    !Array.isArray(pages) || pages.length === 0 || pages.length > MAX_PAGES ||
    !pages.every((p: any) => Number.isInteger(p?.pageIndex) && typeof p?.image === "string")
  ) {
    throw new HttpError(400, `pages must be 1-${MAX_PAGES} items of { pageIndex, image }`);
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(500, "GEMINI_API_KEY not configured");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const parts: any[] = [{ text: PROMPT }];
  for (const p of pages) {
    parts.push({ text: `page ${p.pageIndex}:` });
    parts.push({ inline_data: { mime_type: "image/jpeg", data: p.image } });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    },
  );
  const body: any = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(502, `Gemini検出に失敗しました (HTTP ${res.status}): ${body?.error?.message ?? ""}`);
  const text = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") || "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(502, `Gemini検出結果がJSON形式ではありません: ${text.slice(0, 200)}`);
  }
  return parseDetection(parsed, pages.map((p: any) => p.pageIndex));
}));

/** Checks a saved-image upload; returns the row fields or throws 400. */
export function parseImage(body: any) {
  const { name, src, w, h } = body ?? {};
  if (typeof name !== "string" || !name.trim() || name.length > 200) throw new HttpError(400, "name is required");
  if (typeof src !== "string" || src.length > MAX_IMAGE_CHARS || !DATA_URL.test(src)) {
    throw new HttpError(400, "src must be a PNG or JPEG data URL under 4MB");
  }
  if (![w, h].every((n) => Number.isInteger(n) && n > 0 && n <= 10000)) throw new HttpError(400, "w and h must be pixel sizes");
  return { name: name.trim(), src, w, h };
}

/** The caller's rows plus rows shared with everyone; `mine` tells the UI whether edit/delete is allowed. */
async function listVisible(req: Request, table: string) {
  const userId = requireUserId(req);
  const [own, shared] = await Promise.all([listOwned(req, table), db.list(table, { where: { shared: true } })]);
  return [...own, ...shared.filter((d) => d.userId !== userId)]
    .sort((a, b) => Number(b._creationTime) - Number(a._creationTime))
    // Other users' ids are not sent to the browser.
    .map(({ userId: owner, ...d }) => ({ ...d, mine: owner === userId }));
}

blankPdfRouter.get("/images", route(async (req) => listVisible(req, "pdfImages")));

blankPdfRouter.post("/images", route(async (req) => {
  const userId = requireUserId(req);
  const id = await db.insert("pdfImages", { ...parseImage(req.body), userId });
  return { id };
}));

blankPdfRouter.delete("/images/:id", route(async (req) => {
  await requireOwned(req, "pdfImages", req.params.id, "画像");
  await db.delete("pdfImages", req.params.id);
  return { ok: true };
}));

/** Checks an item saved from the editor; returns the row fields or throws 400. The browser renders it, so only shape and size are checked. */
export function parseItem(body: any) {
  const { name, item } = body ?? {};
  if (typeof name !== "string" || !name.trim() || name.length > 200) throw new HttpError(400, "name is required");
  if (!item || typeof item !== "object" || !(typeof item.aspect === "number" && item.aspect > 0 && item.aspect <= 10)) throw new HttpError(400, "item.aspect is required");
  if (!Array.isArray(item.anns) || item.anns.length < 1 || item.anns.length > 20) throw new HttpError(400, "item.anns must hold 1-20 items");
  for (const a of item.anns) {
    if (!a || !["box", "text", "image"].includes(a.kind)) throw new HttpError(400, "item kind must be box, text or image");
    if (![a.x, a.y, a.w, a.h].every((n) => typeof n === "number" && n >= 0 && n <= 10)) throw new HttpError(400, "item positions must be page fractions");
    if (a.src !== undefined && (typeof a.src !== "string" || !DATA_URL.test(a.src))) throw new HttpError(400, "item src must be a PNG or JPEG data URL");
  }
  if (JSON.stringify(item).length > MAX_IMAGE_CHARS + 100_000) throw new HttpError(400, "item is too large");
  return { name: name.trim(), item };
}

blankPdfRouter.get("/items", route(async (req) => listOwned(req, "pdfItems")));

blankPdfRouter.post("/items", route(async (req) => {
  const userId = requireUserId(req);
  return { id: await db.insert("pdfItems", { ...parseItem(req.body), userId }) };
}));

blankPdfRouter.delete("/items/:id", route(async (req) => {
  await requireOwned(req, "pdfItems", req.params.id, "アイテム");
  await db.delete("pdfItems", req.params.id);
  return { ok: true };
}));

const SIGNATURE_TEXT_FIELDS = ["companyName", "address", "license", "tel", "fax", "dealType"] as const;

/** Checks a signature from the editor; returns the row fields or throws 400. */
export function parseSignature(body: any) {
  const raw = body?.fields ?? {};
  const fields: Record<string, string | boolean | number> = {};
  for (const k of SIGNATURE_TEXT_FIELDS) {
    const v = raw[k];
    if (v == null || v === "") continue;
    if (typeof v !== "string" || v.length > 100) throw new HttpError(400, `${k} must be text up to 100 characters`);
    fields[k] = v.trim();
  }
  if (!fields.companyName) throw new HttpError(400, "会社名を入力してください");
  fields.showLogo = raw.showLogo === true;
  fields.layout = raw.layout === "compact" ? "compact" : "stacked";
  for (const k of ["bigScale", "smallScale"]) {
    const v = raw[k];
    if (v == null) continue;
    if (typeof v !== "number" || !(v >= 0.6 && v <= 1.6)) throw new HttpError(400, `${k} must be between 0.6 and 1.6`);
    fields[k] = v;
  }
  return { name: fields.companyName as string, fields };
}

blankPdfRouter.get("/signatures", route(async (req) => listVisible(req, "pdfSignatures")));

blankPdfRouter.post("/signatures", route(async (req) => {
  const userId = requireUserId(req);
  return { id: await db.insert("pdfSignatures", { ...parseSignature(req.body), userId }) };
}));

blankPdfRouter.put("/signatures/:id", route(async (req) => {
  const userId = requireUserId(req);
  const doc = await db.get("pdfSignatures", req.params.id);
  // Shared templates are team-wide, so anyone may edit them; deleting stays with the owner.
  if (!doc || (doc.userId !== userId && !doc.shared)) throw new HttpError(404, "署名 が見つかりません");
  await db.patch("pdfSignatures", req.params.id, parseSignature(req.body));
  return { ok: true };
}));

blankPdfRouter.delete("/signatures/:id", route(async (req) => {
  await requireOwned(req, "pdfSignatures", req.params.id, "署名");
  await db.delete("pdfSignatures", req.params.id);
  return { ok: true };
}));
