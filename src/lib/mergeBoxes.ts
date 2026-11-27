interface Box { pageIndex: number; x: number; y: number; w: number; h: number; label?: string }

/**
 * Unions boxes on the same page that touch or sit within `gap` (page fraction)
 * of each other, so a footer band split into fragments is blanked as one area.
 */
export function mergeNearby<T extends Box>(boxes: T[], gap = 0.02): T[] {
  const out = boxes.map((b) => ({ ...b }));
  const near = (a: Box, b: Box) =>
    a.pageIndex === b.pageIndex &&
    a.x - gap <= b.x + b.w && b.x - gap <= a.x + a.w &&
    a.y - gap <= b.y + b.h && b.y - gap <= a.y + a.h;
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i], b = out[j];
        if (!near(a, b)) continue;
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        out[i] = { ...a, x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, label: "会社情報" };
        out.splice(j, 1);
        merged = true;
      }
    }
  }
  return out;
}
