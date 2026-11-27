/**
 * 帯 signature block (company name, address, license, TEL/FAX, 取引態様) drawn to a transparent PNG,
 * so the editor places it like any image and the export burns it in.
 */
export interface SignatureFields {
  companyName: string;
  address?: string;
  license?: string;
  tel?: string;
  fax?: string;
  dealType?: string;
  showLogo?: boolean;
  /** "stacked": address / big name + TEL / license. "compact": name + address / license + 電話番号 + Fax番号. */
  layout?: "stacked" | "compact";
  /** Text size multipliers (0.6–1.6). big: 会社名・TEL in 3段; small: the other lines, and all text in 2段. */
  bigScale?: number;
  smallScale?: number;
}
export interface SavedSignature { _id: string; name: string; fields: SignatureFields }

export type SignatureKey = "companyName" | "address" | "license" | "tel" | "fax" | "dealType";
/** Per-line overrides set by clicking a line on the page. */
export type SignatureStyles = Partial<Record<SignatureKey, { scale?: number; bold?: boolean }>>;
/** A drawn line's box in PNG pixels, for hit-testing clicks. */
export interface SignatureLine { key: SignatureKey; x: number; y: number; w: number; h: number; text: string; size: number; bold: boolean }
export interface RenderedSignature { src: string; w: number; h: number; lines: SignatureLine[]; logo?: { x: number; y: number; size: number } }

const FONT = '"Noto Sans JP", "Hiragino Sans", sans-serif';
const BRAND = "#3d6b3f";
// Zephind butterfly, same paths as the app logo (24x24 viewBox).
const BUTTERFLY = [
  "M11 11C10 6 7 3 3.500 3.500 2.500 6 4 10 8 12c1 .5 2 .2 3-1z",
  "M13 11c1-5 4-8 7.500-7.500C21.500 6 20 10 16 12c-1 .5-2 .2-3-1z",
  "M10.500 13.500C8 12.500 5 14 5 17c0 2.500 2.500 4 4.500 3 1.500-.8 2-3.500 1-6.500z",
  "M13.500 13.500c2.500-1 5.500.5 5.500 3.500 0 2.500-2.500 4-4.500 3-1.500-.8-2-3.500-1-6.500z",
];
// Sizes in px at render scale; the PNG is scaled down on the page, so this only sets sharpness.
const PAD = 12;
const GAP = 40;

interface Item { key: SignatureKey; text: string; size: number }
interface Row { items: Item[]; right?: Item; indent: boolean }

/** Rows for the chosen layout, with each item's base size before per-line overrides. */
function layoutRows(f: SignatureFields): Row[] {
  const big = 76 * (f.bigScale ?? 1);
  const small = (f.layout === "compact" ? 48 : 40) * (f.smallScale ?? 1);
  const it = (key: SignatureKey, text: string | undefined, size: number): Item[] => (text ? [{ key, text, size }] : []);
  const deal = f.dealType ? { key: "dealType" as const, text: `取引態様：${f.dealType}`, size: small } : undefined;
  if (f.layout === "compact") {
    return [
      { items: [...it("companyName", f.companyName, small), ...it("address", f.address, small)], right: deal, indent: true },
      { items: [...it("license", f.license, small), ...it("tel", f.tel && `電話番号${f.tel}`, small), ...it("fax", f.fax && `Fax番号${f.fax}`, small)], indent: true },
    ].filter((r) => r.items.length || r.right);
  }
  return [
    { items: it("address", f.address, small), right: deal, indent: false },
    { items: [...it("companyName", f.companyName, big), ...it("tel", f.tel && `TEL ${f.tel}`, big)], indent: true },
    { items: [...it("license", f.license, small), ...it("fax", f.fax && `FAX ${f.fax}`, small)], indent: true },
  ].filter((r) => r.items.length || r.right);
}

/**
 * Draws the signature. With maxWidth (PNG px) the block is that wide and items that do not fit
 * wrap onto a new line; text size never changes with the width.
 */
export async function renderSignature(f: SignatureFields, styles: SignatureStyles = {}, maxWidth?: number): Promise<RenderedSignature> {
  const rows = layoutRows(f).map((r) => {
    const style = (i: Item) => ({ ...i, size: i.size * (styles[i.key]?.scale ?? 1), bold: !!styles[i.key]?.bold });
    return { ...r, items: r.items.map(style), right: r.right && style(r.right) };
  });
  type Styled = Item & { bold: boolean };
  const fontOf = (i: { size: number; bold: boolean }) => `${i.bold ? 700 : 400} ${i.size}px ${FONT}`;
  await Promise.all(rows.flatMap((r) => [...r.items, ...(r.right ? [r.right] : [])]).map((i) => document.fonts.load(fontOf(i))));

  const ctx0 = document.createElement("canvas").getContext("2d")!;
  const width = (i: Styled) => {
    ctx0.font = fontOf(i);
    return ctx0.measureText(i.text).width;
  };
  const compact = f.layout === "compact";
  const companyRow = rows.findIndex((r) => r.items.some((i) => i.key === "companyName"));
  const lineH = (items: Styled[]) => Math.max(...items.map((i) => i.size)) * 1.45;
  // Logo size depends only on font sizes, so it is known before wrapping.
  const logoSize = !f.showLogo ? 0 : compact
    ? rows.reduce((n, r) => n + lineH([...r.items, ...(r.right ? [r.right] : [])]), 0) * 0.8
    : lineH(rows[companyRow]?.items ?? []) * 0.95;
  const indent = logoSize ? logoSize + 24 : 0;
  const natural = Math.max(...rows.map((r) =>
    (r.indent ? indent : 0) + r.items.reduce((n, i) => n + width(i), 0) + GAP * Math.max(0, r.items.length - 1) +
    (r.right ? GAP * 2 + width(r.right) : 0)));
  const widest = Math.max(...rows.flatMap((r) => [...r.items, ...(r.right ? [r.right] : [])].map((i) => (r.indent ? indent : 0) + width(i))));
  // Any width the user drags to; never narrower than the widest single item.
  const inner = maxWidth ? Math.max(maxWidth - PAD * 2, widest) : natural;

  // Flow each row's items into visual lines of at most `inner` px; 取引態様 stays right-aligned when it fits.
  type Placed = { item: Styled; x: number; right?: boolean };
  const visual: { placed: Placed[]; h: number; row: number }[] = [];
  rows.forEach((r, n) => {
    const start = r.indent ? indent : 0;
    let line: Placed[] = [];
    let x = start;
    const flush = () => {
      if (line.length) visual.push({ placed: line, h: lineH(line.map((p) => p.item)), row: n });
      line = [];
      x = start;
    };
    for (const i of r.items) {
      const w = width(i);
      if (line.length && x + w > inner) flush();
      line.push({ item: i, x });
      x += w + GAP;
    }
    if (r.right) {
      const w = width(r.right);
      if (line.length && x - GAP + GAP * 2 + w > inner) flush();
      line.push({ item: r.right, x: inner - w, right: true });
    }
    flush();
  });
  // 2段: items on a line spread out to fill the block's width, like flex space-between.
  if (compact) for (const v of visual) {
    if (v.placed.length < 2) continue;
    const start = v.placed[0].x;
    const free = inner - start - v.placed.reduce((n, p) => n + width(p.item), 0);
    let x = start;
    for (const p of v.placed) {
      p.x = x;
      x += width(p.item) + free / (v.placed.length - 1);
    }
  }

  const W = Math.ceil(inner + PAD * 2);
  const H = Math.ceil(PAD * 2 + visual.reduce((n, v) => n + v.h, 0));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "middle";
  const lines: SignatureLine[] = [];
  let y = PAD;
  let logo: RenderedSignature["logo"];
  for (const v of visual) {
    const mid = y + v.h / 2;
    for (const p of v.placed) {
      ctx.font = fontOf(p.item);
      ctx.fillStyle = "#111";
      ctx.fillText(p.item.text, PAD + p.x, mid);
      lines.push({ key: p.item.key, x: PAD + p.x, y, w: width(p.item), h: v.h, text: p.item.text, size: p.item.size, bold: p.item.bold });
    }
    if (logoSize && !logo && (compact || v.row === companyRow)) {
      logo = { x: PAD, y: compact ? (H - logoSize) / 2 : mid - logoSize / 2, size: logoSize };
      drawLogo(ctx, logo.x, logo.y, logoSize);
    }
    y += v.h;
  }
  return { src: canvas.toDataURL("image/png"), w: W, h: H, lines, logo };
}

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = BRAND;
  for (const d of BUTTERFLY) ctx.fill(new Path2D(d));
  ctx.restore();
}

/** The butterfly alone as a PNG, for a signature split into separate items. */
export function logoPng(size = 256): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  drawLogo(canvas.getContext("2d")!, 0, 0, size);
  return canvas.toDataURL("image/png");
}
