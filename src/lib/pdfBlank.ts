import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument } from "pdf-lib";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;

/** Position and size are fractions of the page; fontSize is a fraction of page width. */
export interface Annotation {
  id: string;
  pageIndex: number;
  kind: "box" | "text";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text?: string;
  fontSize?: number;
  bold?: boolean;
  label?: string;
  /** Border only, no fill. */
  outline?: boolean;
  /** Id from FONTS. */
  font?: string;
}

export const FONT_FAMILY = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';

/** Google web fonts, so the editor and the export look the same on every PC. */
export const FONTS = [
  { id: "noto-sans", label: "ゴシック (Noto Sans JP)", family: "Noto Sans JP", fallback: "sans-serif", weights: "400;700" },
  { id: "noto-serif", label: "明朝 (Noto Serif JP)", family: "Noto Serif JP", fallback: "serif", weights: "400;700" },
  { id: "biz-gothic", label: "BIZ UDPゴシック", family: "BIZ UDPGothic", fallback: "sans-serif", weights: "400;700" },
  { id: "biz-mincho", label: "BIZ UDP明朝", family: "BIZ UDPMincho", fallback: "serif", weights: "400;700" },
  { id: "rounded", label: "丸ゴシック (M PLUS Rounded)", family: "M PLUS Rounded 1c", fallback: "sans-serif", weights: "400;700" },
  { id: "zen-maru", label: "Zen丸ゴシック", family: "Zen Maru Gothic", fallback: "sans-serif", weights: "400;700" },
  { id: "dela", label: "極太 (Dela Gothic One)", family: "Dela Gothic One", fallback: "sans-serif", weights: "400" },
  { id: "yusei", label: "手書き風 (Yusei Magic)", family: "Yusei Magic", fallback: "sans-serif", weights: "400" },
  { id: "inter", label: "Inter (英数字)", family: "Inter", fallback: "sans-serif", weights: "400;700" },
] as const;

export const FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?" +
  FONTS.map((f) => `family=${f.family.replace(/ /g, "+")}:wght@${f.weights}`).join("&") +
  "&display=swap";

export const fontCss = (id?: string) => {
  const f = FONTS.find((x) => x.id === id);
  return f ? `"${f.family}", ${FONT_FAMILY}, ${f.fallback}` : FONT_FAMILY;
};

const canvasFont = (a: Annotation, px: number) => `${a.bold ? "bold " : ""}${px}px ${fontCss(a.font)}`;
export const LINE_HEIGHT = 1.25;
/** Outline stroke as a fraction of page width (~1.5pt on A4). */
export const OUTLINE_WIDTH = 0.0025;
const AI_PAGE_LIMIT = 10;
const EXPORT_SCALE = 3; // ~216 DPI, keeps small print in 図面 readable

// pdfjs detaches the buffer it is given, so it always gets a copy.
export const loadPdf = (bytes: ArrayBuffer) => pdfjs.getDocument({ data: bytes.slice(0) }).promise;

export async function renderPage(doc: PdfDoc, pageIndex: number, scale: number, canvas = document.createElement("canvas")) {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

/** First pages as base64 JPEG, sized so small footer text stays legible to the model. */
export async function pageImagesForAi(doc: PdfDoc) {
  const out: { pageIndex: number; image: string }[] = [];
  for (let i = 0; i < Math.min(doc.numPages, AI_PAGE_LIMIT); i++) {
    const page = await doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const canvas = await renderPage(doc, i, Math.min(3, 1600 / Math.max(base.width, base.height)));
    out.push({ pageIndex: i, image: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] });
  }
  return out;
}

/** Boxes around text-layer items containing any of the given strings; catches repeats the model did not box. */
export async function findTextBoxes(doc: PdfDoc, needles: string[]) {
  const norm = (s: string) => s.replace(/\s+/g, "").normalize("NFKC");
  const wanted = needles.map(norm).filter((n) => n.length >= 3);
  const found: { pageIndex: number; label: string; x: number; y: number; w: number; h: number }[] = [];
  if (wanted.length === 0) return found;
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    for (const item of items) {
      if (!("str" in item)) continue;
      const hit = wanted.find((n) => norm(item.str).includes(n));
      if (!hit) continue;
      const [a, b, c, d, e, f] = pdfjs.Util.transform(vp.transform, item.transform);
      // shortcut: horizontal text only, rotated runs are left to the model's image boxes.
      if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) continue;
      const fontH = Math.abs(d);
      found.push({
        pageIndex: i,
        label: hit,
        x: e / vp.width,
        y: (f - fontH) / vp.height,
        w: (item.width * vp.scale) / vp.width,
        h: (fontH * 1.2) / vp.height,
      });
    }
  }
  return found;
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation, W: number, H: number) {
  ctx.fillStyle = a.color;
  if (a.kind === "box" && a.outline) {
    const lw = OUTLINE_WIDTH * W;
    ctx.strokeStyle = a.color;
    ctx.lineWidth = lw;
    // Inset by half the stroke so it stays inside the box, like the editor's CSS border.
    ctx.strokeRect(a.x * W + lw / 2, a.y * H + lw / 2, a.w * W - lw, a.h * H - lw);
    return;
  }
  if (a.kind === "box") {
    ctx.fillRect(a.x * W, a.y * H, a.w * W, a.h * H);
    return;
  }
  const px = (a.fontSize ?? 0.015) * W;
  ctx.font = canvasFont(a, px);
  ctx.textBaseline = "top";
  (a.text ?? "").split("\n").forEach((line, i) => ctx.fillText(line, a.x * W, a.y * H + i * px * LINE_HEIGHT));
}

/**
 * Every page becomes one flat image with the edits drawn into it, so no PDF
 * editor can lift a box off, select the covered text, or tell edited pages from
 * untouched ones. Metadata is blanked so the file names no tool or date.
 */
export async function exportPdf(doc: PdfDoc, annotations: Annotation[]) {
  const out = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < doc.numPages; i++) {
    const anns = annotations.filter((a) => a.pageIndex === i);
    const canvas = await renderPage(doc, i, EXPORT_SCALE);
    const ctx = canvas.getContext("2d")!;
    // Canvas silently falls back to a system font if the web font is not loaded yet.
    for (const a of anns) {
      if (a.kind === "text") await document.fonts.load(canvasFont(a, 16), a.text);
    }
    for (const a of anns) drawAnnotation(ctx, a, canvas.width, canvas.height);
    const jpg = await out.embedJpg(await (await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.92))).arrayBuffer());
    const page = out.addPage([canvas.width / EXPORT_SCALE, canvas.height / EXPORT_SCALE]);
    page.drawImage(jpg, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  return out.save();
}
