/**
 * The signature block appended to every proposal mail.
 *
 * 宅建免許番号 and 取引態様 are legally expected on a brokerage's property
 * solicitation, and the company block below them is what the recipient replies
 * to — so this is generated automatically rather than retyped per mail. The text
 * is editable in 提案メール設定 (stored per user in convex/emailSettings.js); this
 * constant is only the starting point for an account that has never saved one.
 *
 * Kept as plain text, not HTML: the mail is sent as text/plain through the Gmail
 * or Graph API and also feeds 本文をコピー / mailto:, so the alignment has to
 * survive as characters.
 * Full-width (U+3000) spaces are used for the indentation so it lines up in the
 * proportional fonts mail clients use.
 */
// The full-width spaces in the literal below ARE the layout — they indent the
// company block and push 取引態様 to the right in a mail client. Not accidental.
export const DEFAULT_EMAIL_SIGNATURE = [
  "東京都知事(9)第55866号　　　　　　　　　　　　　　　　取引態様：媒介",
  "--------------------------------------------------------------",
  "〒151-0053　東京都渋谷区代々木2-44-7",
  "　　　　　　　株式会社ゼフィール",
  "　　　　　　　　柴田　政裕",
  "　　　　　℡03-5388-9055　Mobile 090-3900-8855",
  "　　　　　E-mail shibata@zephyr-jp.net",
].join("\n");

/** Appends the signature to a body, with one blank line between. */
export function withSignature(body: string, signature: string): string {
  const sig = signature.trim();
  if (!sig) return body;
  return `${body.replace(/\s+$/, "")}\n\n${sig}`;
}
