export type Restack = "front" | "forward" | "backward" | "back";

/** Moves an item in drawing order among items on the same page; later items paint on top. */
export function restack<T extends { id: string; pageIndex: number }>(list: T[], id: string, to: Restack): T[] {
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return list;
  const item = list[i];
  const rest = list.filter((_, k) => k !== i);
  const samePage = rest.map((a, k) => (a.pageIndex === item.pageIndex ? k : -1)).filter((k) => k >= 0);
  // Index in `rest` to insert before.
  let at: number;
  if (to === "front") at = rest.length;
  else if (to === "back") at = samePage.length ? samePage[0] : i;
  else if (to === "forward") {
    const next = samePage.find((k) => k >= i);
    at = next === undefined ? i : next + 1;
  } else {
    const prev = samePage.filter((k) => k < i).pop();
    at = prev === undefined ? i : prev;
  }
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}
