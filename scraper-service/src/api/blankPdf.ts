/**
 * AI detection of the listing broker's company details on a 販売図面 so they can
 * be blanked before the sheet is forwarded (帯替え). The browser renders pages to
 * JPEG and does the blanking; this only asks Gemini where the boxes go.
 */
import { Router, type Request } from "express";
import { HttpError, requireUserId } from "../auth/authz";
import { route } from "./handler";

const MAX_PAGES = 10;

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
