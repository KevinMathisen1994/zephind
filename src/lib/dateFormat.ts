/**
 * Japanese date formatting for anything shown in the UI.
 *
 * Built by hand rather than through `toLocaleString("ja-JP", …)`: that produced
 * slash dates ("8/18 00:59", "2026/8/17") whose meaning depends on the reader's
 * conventions, and its hour padding varies by ICU version. 年月日 is unambiguous
 * and identical on every machine.
 *
 * All of these take epoch milliseconds (Convex's `_creationTime`, `postedAt`,
 * `lastScrapeAt`) and return "" for a missing value, so a caller can drop the
 * result straight into JSX without guarding twice.
 */

const two = (n: number) => String(n).padStart(2, "0");

/** 2026年8月18日 */
export function formatJaDate(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 8月18日 — for places where the year is obvious from context. */
export function formatJaDateShort(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 2026年8月18日 00:59 */
export function formatJaDateTime(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${formatJaDate(ms)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** 8月18日 00:59 — same, without the year. */
export function formatJaDateTimeShort(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${formatJaDateShort(ms)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** 00:59 */
export function formatJaTime(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}
