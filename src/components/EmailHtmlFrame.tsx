// Nothing remote loads (tracking pixels, remote images, fonts); only inline styles and data: images.
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

const BASE_STYLE =
  "body{margin:12px;font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif;font-size:14px;" +
  "line-height:1.6;color:#17150f;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}";

/**
 * Shows an email's HTML as laid out by the sender, isolated from the app: the sandbox allows no scripts
 * and gives the frame its own origin, and the CSP meta comes before the email's markup so it can't be loosened.
 * Links open in a new tab.
 */
export function EmailHtmlFrame({ html }: { html: string }) {
  const doc =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<base target="_blank"><style>${BASE_STYLE}</style></head><body>${html}</body></html>`;
  return (
    <div className="h-[520px] min-h-[200px] resize-y overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white">
      <iframe
        title="メール本文"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        className="w-full h-full"
      />
    </div>
  );
}
