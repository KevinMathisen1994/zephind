/**
 * Word-style text: a box holds runs of text, each optionally overriding the box's size, bold and color.
 * "\n" inside a run's text is a line break. size is a fraction of page width, like Annotation.fontSize.
 */
export interface Run { text: string; size?: number; bold?: boolean; color?: string }
export type RunStyle = Omit<Run, "text">;

const sameStyle = (a: RunStyle, b: RunStyle) => a.size === b.size && a.bold === b.bold && a.color === b.color;

/** Drops empty runs and merges neighbours with equal style. */
export function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

export const plainText = (runs: Run[]) => runs.map((r) => r.text).join("");

/** Sets style keys on characters [start, end); undefined values clear the override. */
export function styleRange(runs: Run[], start: number, end: number, style: RunStyle): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const chars = Array.from(r.text);
    const a = Math.max(0, Math.min(chars.length, start - pos));
    const b = Math.max(0, Math.min(chars.length, end - pos));
    out.push({ ...r, text: chars.slice(0, a).join("") });
    out.push({ ...r, ...style, text: chars.slice(a, b).join("") });
    out.push({ ...r, text: chars.slice(b).join("") });
    pos += chars.length;
  }
  return normalizeRuns(out.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as Run));
}

/** Removes one style key from every run, so the box-level value shows everywhere. */
export const clearRunStyle = (runs: Run[], key: keyof RunStyle) =>
  normalizeRuns(runs.map((r) => { const c = { ...r }; delete c[key]; return c; }));

export interface Seg { text: string; style: RunStyle }
export interface LaidLine { segs: Seg[]; width: number; maxSize: number }

/**
 * Splits runs into lines: at "\n", and per character once a line passes maxWidth (0 = never),
 * the same as CSS pre-wrap + break-all. measure(text, style) returns the width in the caller's units.
 */
export function layoutRuns(runs: Run[], baseSize: number, maxWidth: number, measure: (text: string, style: RunStyle) => number): LaidLine[] {
  const lines: LaidLine[] = [];
  let segs: Seg[] = [];
  let done = 0; // width of this line's segments before the open (last) one
  const close = () => {
    const width = done + (segs.length ? measure(segs[segs.length - 1].text, segs[segs.length - 1].style) : 0);
    lines.push({ segs, width, maxSize: Math.max(baseSize, ...segs.map((s) => s.style.size ?? baseSize)) });
    segs = [];
    done = 0;
  };
  for (const r of runs) {
    const style: RunStyle = { size: r.size, bold: r.bold, color: r.color };
    for (const ch of Array.from(r.text)) {
      if (ch === "\n") { close(); continue; }
      let last: Seg | undefined = segs[segs.length - 1];
      if (maxWidth > 0 && last) {
        // done excludes the open segment, so measure it whole (keeps kerning like the browser).
        const same = sameStyle(last.style, style);
        const w = done + (same ? measure(last.text + ch, style) : measure(last.text, last.style) + measure(ch, style));
        if (w > maxWidth) { close(); last = undefined; }
      }
      if (last && sameStyle(last.style, style)) last.text += ch;
      else {
        if (last) done += measure(last.text, last.style);
        segs.push({ text: ch, style });
      }
    }
  }
  close();
  return lines;
}

// ---- contentEditable helpers. Line breaks are "\n" in text nodes or <br>; styled text sits in spans with data-* attributes.

const BLOCKS = new Set(["DIV", "P"]);

/** Reads runs back from an editor element. */
export function readRuns(root: HTMLElement): Run[] {
  const out: Run[] = [];
  const walk = (n: Node, style: RunStyle) => {
    if (n.nodeType === Node.TEXT_NODE) return void out.push({ ...style, text: n.textContent ?? "" });
    if (!(n instanceof HTMLElement)) return;
    if (n.tagName === "BR") return void out.push({ ...style, text: "\n" });
    // Pasted or browser-made blocks start a new line.
    if (n !== root && BLOCKS.has(n.tagName) && out.length && !plainText(out).endsWith("\n")) out.push({ ...style, text: "\n" });
    const d = n.dataset;
    const s: RunStyle = {
      ...style,
      ...(d.size && { size: Number(d.size) }),
      ...(d.bold && { bold: d.bold === "1" }),
      ...(d.color && { color: d.color }),
    };
    n.childNodes.forEach((c) => walk(c, s));
  };
  root.childNodes.forEach((c) => walk(c, {}));
  // Trailing empty lines are invisible, and Chrome adds a placeholder one after Enter at the end.
  const runs = normalizeRuns(out);
  while (runs.length && /\n+$/.test(runs[runs.length - 1].text)) {
    const last = runs[runs.length - 1];
    last.text = last.text.replace(/\n+$/, "");
    if (last.text) break;
    runs.pop();
  }
  return runs;
}

/** Replaces the editor's content with spans for the runs. */
export function writeRuns(root: HTMLElement, runs: Run[]) {
  root.replaceChildren(...runs.map((r) => {
    const span = document.createElement("span");
    span.textContent = r.text;
    if (r.size !== undefined) { span.dataset.size = String(r.size); span.style.fontSize = `${r.size * 100}cqw`; }
    if (r.bold !== undefined) { span.dataset.bold = r.bold ? "1" : "0"; span.style.fontWeight = r.bold ? "700" : "400"; }
    if (r.color !== undefined) { span.dataset.color = r.color; span.style.color = r.color; }
    return span;
  }));
}

/** Character offsets of the current selection inside root, or null when it is elsewhere. */
export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const r = sel.getRangeAt(0);
  const offsetOf = (node: Node, offset: number) => {
    const pre = document.createRange();
    pre.setStart(root, 0);
    pre.setEnd(node, offset);
    let n = 0;
    const walk = (x: Node) => {
      if (x.nodeType === Node.TEXT_NODE) n += Array.from(x.textContent ?? "").length;
      else if (x.nodeName === "BR") n += 1;
      else x.childNodes.forEach(walk);
    };
    walk(pre.cloneContents());
    return n;
  };
  return { start: offsetOf(r.startContainer, r.startOffset), end: offsetOf(r.endContainer, r.endOffset) };
}

/** Selects characters [start, end) inside root. */
export function setSelectionOffsets(root: HTMLElement, start: number, end: number) {
  const pointAt = (target: number): [Node, number] => {
    let left = target;
    let found: [Node, number] | null = null;
    const walk = (x: Node) => {
      if (found) return;
      if (x.nodeType === Node.TEXT_NODE) {
        const chars = Array.from(x.textContent ?? "");
        if (left <= chars.length) found = [x, chars.slice(0, left).join("").length];
        else left -= chars.length;
      } else if (x.nodeName === "BR") {
        if (left === 0) found = [x.parentNode!, Array.prototype.indexOf.call(x.parentNode!.childNodes, x)];
        else left -= 1;
      } else x.childNodes.forEach(walk);
    };
    walk(root);
    return found ?? [root, root.childNodes.length];
  };
  const range = document.createRange();
  range.setStart(...pointAt(start));
  range.setEnd(...pointAt(end));
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
