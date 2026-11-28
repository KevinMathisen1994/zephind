import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument } from "pdf-lib";
import { type Run, type RunStyle, layoutRuns } from "./richText";
import type { SignatureFields, SignatureLine, SignatureStyles } from "./signature";

/**
 * What a placed signature was drawn from, so it can be restyled and reflowed on the page.
 * w/h/lines are the PNG's; sx/sy are page fractions per PNG px (fixed, so text size never changes);
 * maxWidth is the wrap width in PNG px once the block has been resized.
 */
export interface PlacedSignature {
  fields: SignatureFields; styles: SignatureStyles; w: number; h: number; lines: SignatureLine[];
  sx?: number; sy?: number; maxWidth?: number;
}

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;

/** Position and size are fractions of the page; fontSize is a fraction of page width. */
export interface Annotation {
  id: string;
  pageIndex: number;
  kind: "box" | "text" | "image";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** Plain text of the box, kept in sync with runs. */
  text?: string;
  /** Styled pieces of text; absent on boxes made before rich text (then text is one run). */
  runs?: Run[];
  align?: "left" | "center" | "right";
  fontSize?: number;
  bold?: boolean;
  label?: string;
  /** Image that must keep its proportions (signatures): only corner handles. */
  keepRatio?: boolean;
  signature?: PlacedSignature;
  /** Items with the same group move and save together (a split signature's text and logo). */
  group?: string;
  /** Border only, no fill. */
  outline?: boolean;
  /** Id from FONTS. */
  font?: string;
  /** Image data URL, for kind "image". */
  src?: string;
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

const canvasFont = (a: Annotation, px: number, bold = a.bold) => `${bold ? "bold " : ""}${px}px ${fontCss(a.font)}`;
export const runsOf = (a: Annotation): Run[] => a.runs ?? (a.text ? [{ text: a.text }] : []);
export const LINE_HEIGHT = 1.25;
/** Outline stroke as a fraction of page width (~1.5pt on A4). */
export const OUTLINE_WIDTH = 0.0025;
const AI_PAGE_LIMIT = 10;
const EXPORT_SCALE = 3; // ~216 DPI, keeps small print in 図面 readable

// pdfjs detaches the buffer it is given, so it always gets a copy.
export const loadPdf = (bytes: ArrayBuffer) => pdfjs.getDocument({ data: bytes.slice(0) }).promise;

/** All pages' text, for showing what a PDF says without rendering it. */
export async function pdfText(bytes: ArrayBuffer) {
  const doc = await loadPdf(bytes);
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const { items } = await (await doc.getPage(i)).getTextContent();
      pages.push(items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
    }
    return pages.join("\n\n");
  } finally {
    await doc.destroy();
  }
}

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

export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation, W: number, H: number, img?: HTMLImageElement) {
  if (a.kind === "image") {
    if (img) ctx.drawImage(img, a.x * W, a.y * H, a.w * W, a.h * H);
    return;
  }
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
  const base = a.fontSize ?? 0.015;
  const fontOf = (s: RunStyle) => canvasFont(a, (s.size ?? base) * W, s.bold ?? a.bold);
  const measure = (t: string, s: RunStyle) => {
    ctx.font = fontOf(s);
    return ctx.measureText(t).width;
  };
  const lines = layoutRuns(runsOf(a), base, a.w * W, measure);
  // Same line box as CSS: each line is LINE_HEIGHT x its largest size (the box size counts too), baselines aligned.
  ctx.font = canvasFont(a, 100);
  const m = ctx.measureText("あ");
  const asc = m.fontBoundingBoxAscent / 100, desc = m.fontBoundingBoxDescent / 100;
  const boxW = a.w > 0 ? a.w * W : Math.max(0, ...lines.map((l) => l.width));
  ctx.textBaseline = "alphabetic";
  let y = a.y * H;
  for (const line of lines) {
    const size = line.maxSize * W;
    const baseline = y + size * (asc + (LINE_HEIGHT - asc - desc) / 2);
    let x = a.x * W + (a.align === "center" ? (boxW - line.width) / 2 : a.align === "right" ? boxW - line.width : 0);
    for (const s of line.segs) {
      ctx.font = fontOf(s.style);
      ctx.fillStyle = s.style.color ?? a.color;
      ctx.fillText(s.text, x, baseline);
      x += ctx.measureText(s.text).width;
    }
    y += size * LINE_HEIGHT;
  }
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
    const imgs = new Map<string, HTMLImageElement>();
    for (const a of anns) {
      if (a.kind === "text") for (const bold of [false, true]) await document.fonts.load(canvasFont(a, 16, bold), a.text);
      if (a.kind === "image" && a.src) imgs.set(a.id, await loadImage(a.src));
    }
    for (const a of anns) drawAnnotation(ctx, a, canvas.width, canvas.height, imgs.get(a.id));
    const jpg = await out.embedJpg(await (await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.92))).arrayBuffer());
    const page = out.addPage([canvas.width / EXPORT_SCALE, canvas.height / EXPORT_SCALE]);
    page.drawImage(jpg, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  return out.save();
}

async function loadImage(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** Drag payload for anything placed as an image (saved logos, signatures). width is a page-width fraction. */
export const IMAGE_MIME = "application/x-zephind-image";
export interface ImageDrop { src: string; w: number; h: number; name: string; width: number; keepRatio?: boolean; signature?: PlacedSignature }

/**
 * Placed items saved for reuse (right-click → 保存): one item or a whole group, positions relative to the group's top-left.
 * aspect is the page's height/width, to convert heights onto another page.
 */
type LegacyTemplate = Omit<Annotation, "id" | "pageIndex" | "x" | "y"> & { aspect: number };
export type ItemTemplate = { aspect: number; anns: Omit<Annotation, "id" | "pageIndex" | "group">[] } | LegacyTemplate;
/** Saved before groups existed: one item without a position. */
export const templateAnns = (t: ItemTemplate) => ("anns" in t ? t.anns : [{ ...t, x: 0, y: 0 }]);
export interface SavedItem { _id: string; name: string; item: ItemTemplate }
/** Everything that can be dragged onto a page. */
export type Drop = ImageDrop | { item: ItemTemplate; name: string };

export interface SavedImage { _id: string; name: string; src: string; w: number; h: number; /** false for another user's shared image. */ mine?: boolean }
const IMAGE_MAX_PX = 1200;

/** Downscales so a logo stays a small row in Supabase; JPEG stays JPEG, everything else becomes PNG to keep transparency. */
export async function fileToSavedImage(file: File): Promise<Omit<SavedImage, "_id">> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, IMAGE_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const src = file.type === "image/jpeg" ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
    return { name: file.name, src, w: canvas.width, h: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
