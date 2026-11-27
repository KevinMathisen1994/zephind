import { describe, expect, it } from "vitest";
import { clearRunStyle, layoutRuns, normalizeRuns, plainText, styleRange } from "./richText";

describe("styleRange", () => {
  it("bolds a middle word and keeps the rest", () => {
    expect(styleRange([{ text: "abc def ghi" }], 4, 7, { bold: true })).toEqual([
      { text: "abc " }, { text: "def", bold: true }, { text: " ghi" },
    ]);
  });
  it("spans runs and merges equal neighbours", () => {
    const runs = styleRange([{ text: "ab", size: 0.02 }, { text: "cd" }], 1, 3, { size: 0.03 });
    expect(runs).toEqual([{ text: "a", size: 0.02 }, { text: "bc", size: 0.03 }, { text: "d" }]);
    expect(plainText(runs)).toBe("abcd");
  });
  it("counts surrogate pairs as one character", () => {
    expect(styleRange([{ text: "𠮷野家" }], 1, 2, { bold: true })).toEqual([{ text: "𠮷" }, { text: "野", bold: true }, { text: "家" }]);
  });
  it("clears overrides", () => {
    expect(clearRunStyle([{ text: "a", bold: true }, { text: "b" }], "bold")).toEqual([{ text: "ab" }]);
    expect(normalizeRuns([{ text: "" }, { text: "x" }])).toEqual([{ text: "x" }]);
  });
});

describe("layoutRuns", () => {
  const measure = (t: string, s: { size?: number }) => Array.from(t).length * (s.size ?? 1);
  it("breaks at newlines and keeps empty lines", () => {
    const lines = layoutRuns([{ text: "ab\n\ncd" }], 1, 0, measure);
    expect(lines.map((l) => l.segs.map((s) => s.text).join(""))).toEqual(["ab", "", "cd"]);
  });
  it("wraps per character across styles and tracks the line's largest size", () => {
    const lines = layoutRuns([{ text: "aa" }, { text: "bb", size: 2 }], 1, 4, measure);
    expect(lines.map((l) => [l.segs.map((s) => s.text).join(""), l.width, l.maxSize])).toEqual([["aab", 4, 2], ["b", 2, 2]]);
  });
});
