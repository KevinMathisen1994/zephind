/** Body extraction for Gmail API payloads, plus the HTML-to-text used for Outlook too. */

const MAX_HTML = 300_000;

// Labels mail clients use that TextDecoder doesn't know.
const CHARSET_ALIASES: Record<string, string> = { cp932: "shift_jis", "x-cp932": "shift_jis", "ms932": "shift_jis" };

/**
 * Decodes part bytes. The declared charset can't be trusted alone: some mail labelled iso-2022-jp arrives as
 * UTF-8 bytes, and decoding those as ISO-2022-JP turned every Japanese byte into U+FFFD.
 * ESC bytes mean real ISO-2022-JP; otherwise valid UTF-8 wins; otherwise the declared charset (e.g. Shift_JIS).
 */
export function decodeBytes(bytes: Uint8Array, declared: string): string {
  const label = CHARSET_ALIASES[declared] ?? declared;
  if (!bytes.includes(0x1b)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // Not UTF-8: fall through to the declared charset.
    }
  }
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // Unknown label: TextDecoder throws on construction.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function decodePart(part: any): string {
  const contentType: string =
    (part.headers || []).find((h: any) => h.name?.toLowerCase() === "content-type")?.value || "";
  const charset = /charset="?([^";\s]+)/i.exec(contentType)?.[1]?.toLowerCase() || "utf-8";
  return decodeBytes(Buffer.from(part.body.data, "base64url"), charset);
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** HTML to readable text that keeps the email's line structure (br, p, div, tr, li break lines). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
      if (e[0] === "#" && e !== "#39") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text and HTML bodies of a Gmail message payload. Attachment parts (with a filename) are skipped. */
export function extractGmailBody(payload: any): { bodyText: string; bodyHtml: string } {
  let plain = "";
  let html = "";
  const walk = (part: any) => {
    if (!part) return;
    if (!part.filename && part.body?.data) {
      if (part.mimeType === "text/plain") plain += decodePart(part) + "\n";
      else if (part.mimeType === "text/html") html += decodePart(part);
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return { bodyText: (plain.trim() || htmlToText(html)), bodyHtml: html.slice(0, MAX_HTML) };
}
