type Attachment = { id?: string; filename: string; mimeType: string };
type FetchAttachment = (args: {
  provider: string;
  messageId: string;
  attachmentId: string;
  mimeType: string;
  filename: string;
}) => Promise<{ base64?: string; mimeType?: string } | null | undefined>;

export const PDF_LOADING = "読み込み中…";

export const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// Types the browser renders without running script. Anything else (HTML, SVG, XML...) is downloaded instead.
const INLINE_SAFE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Shows an email attachment. The type comes from the sender, and a blob URL runs with the app's origin,
 * so an HTML/SVG attachment opened inline could act as the logged-in user. Those are downloaded instead.
 * `win` is a tab opened before any await (popup blockers); it is closed when the file is downloaded.
 */
export function openAttachmentBytes(bytes: Uint8Array, mimeType: string, filename: string, win: Window | null) {
  const type = (mimeType || "").toLowerCase().split(";")[0].trim();
  const inline = INLINE_SAFE_TYPES.has(type);
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: inline ? type : "application/octet-stream" }));
  if (inline) {
    if (win && !win.closed) win.location.href = url;
    else window.open(url, "_blank");
    return;
  }
  win?.close();
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "attachment";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const pdfAttachments =<A extends Attachment>(attachments: A[] | undefined) =>
  (attachments ?? []).filter((a): a is A & { id: string } => a.mimeType === "application/pdf" && !!a.id);

/**
 * Reads a message's PDF text in the browser; the sync skips pdf-parse because of the edge CPU limit.
 * onProgress gets the texts so far (PDF_LOADING for pending ones). ok is false if any download failed.
 */
export async function readMailPdfTexts(
  provider: string,
  messageId: string,
  attachments: Attachment[] | undefined,
  fetchAttachment: FetchAttachment,
  onProgress: (texts: string[]) => void,
): Promise<{ texts: string[]; ok: boolean }> {
  const pdfs = pdfAttachments(attachments);
  const texts = pdfs.map(() => PDF_LOADING);
  onProgress([...texts]);
  const { pdfText } = await import("./pdfBlank");
  let ok = true;
  await Promise.all(
    pdfs.map(async (a, i) => {
      try {
        const res = await fetchAttachment({
          provider, messageId, attachmentId: a.id, mimeType: a.mimeType, filename: a.filename,
        });
        texts[i] = res?.base64 ? await pdfText(base64ToBytes(res.base64).buffer) : "";
      } catch {
        ok = false;
        texts[i] = "";
      }
      onProgress([...texts]);
    }),
  );
  return { texts, ok };
}
