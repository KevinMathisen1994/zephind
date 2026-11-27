/** Greedy per-character wrap, same as CSS `word-break: break-all` + `white-space: pre-wrap`, so export matches the editor. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of Array.from(para)) {
      if (line && measure(line + ch) > maxWidth) {
        out.push(line);
        line = "";
      }
      line += ch;
    }
    out.push(line);
  }
  return out;
}
