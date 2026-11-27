import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, FileUp, FolderOpen, Loader2, Minus, MousePointer2, Plus, Redo2, Sparkles, Square, SquareDashed, Trash2, Type, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "../components/ui/button";
import { useApiMutation } from "../hooks/useApi";
import { api } from "../lib/api";
import {
  type Annotation, type PdfDoc, FONTS, FONTS_CSS_URL, LINE_HEIGHT, OUTLINE_WIDTH, fontCss,
  exportPdf, findTextBoxes, loadPdf, pageImagesForAi, renderPage,
} from "../lib/pdfBlank";
import { mergeNearby } from "../lib/mergeBoxes";

type Tool = "select" | "box" | "outline" | "text";
interface LoadedPdf { name: string; doc: PdfDoc; widths: number[] }
// `recorded` is set once the undo snapshot for this drag exists, so a plain click adds no history.
// Resize modes name the edges being dragged (n/s/e/w, two for a corner); the others stay fixed.
interface Drag { id: string; mode: "move" | Handle; startX: number; startY: number; orig: Annotation; recorded: boolean }

type Handle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
const HANDLES: { c: Handle; cls: string }[] = [
  { c: "nw", cls: "-left-1.5 -top-1.5 cursor-nwse-resize" },
  { c: "ne", cls: "-right-1.5 -top-1.5 cursor-nesw-resize" },
  { c: "sw", cls: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { c: "se", cls: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
  { c: "n", cls: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize" },
  { c: "s", cls: "left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize" },
  { c: "w", cls: "top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize" },
  { c: "e", cls: "top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize" },
];
const TOOLS = [
  { t: "select", Icon: MousePointer2, label: "選択", key: "V" },
  { t: "box", Icon: Square, label: "ボックス", key: "B" },
  { t: "outline", Icon: SquareDashed, label: "枠線", key: "R" },
  { t: "text", Icon: Type, label: "テキスト", key: "T" },
] as const;
type Updater = Annotation[] | ((prev: Annotation[]) => Annotation[]);
const apply = (next: Updater, prev: Annotation[]) => (typeof next === "function" ? next(prev) : next);
const LEAVE_MESSAGE = "編集内容は保存されていません。破棄してもよろしいですか？";
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const newId = () => crypto.randomUUID();
const AI_PAD = 0.004;

export default function BlankPdfPage() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [ed, setEd] = useState<{ anns: Annotation[]; past: Annotation[][]; future: Annotation[][] }>({ anns: [], past: [], future: [] });
  const anns = ed.anns;
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#ffffff");
  const [fontPt, setFontPt] = useState(12);
  const [font, setFont] = useState<string>(FONTS[0].id);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: FONTS_CSS_URL });
    document.head.appendChild(link);
    return () => link.remove();
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingIdRaw] = useState<string | null>(null);
  const [busy, setBusy] = useState<"ai" | "export" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const detect = useApiMutation(api.blankPdf.detect);

  // Live edits (drag, typing) skip history; commit and snapshot record one undo step.
  const setAnns = useCallback((next: Updater) => setEd((d) => ({ ...d, anns: apply(next, d.anns) })), []);
  // Leaving a text that was never typed into drops it, whichever way editing ended.
  const setEditingId = useCallback((id: string | null) => {
    if (editingId && editingId !== id) setAnns((list) => list.filter((a) => a.id !== editingId || a.kind !== "text" || a.text?.trim()));
    setEditingIdRaw(id);
  }, [editingId, setAnns]);
  const commit = useCallback((next: Updater) => setEd((d) => ({ anns: apply(next, d.anns), past: [...d.past, d.anns], future: [] })), []);
  const snapshot = useCallback(() => setEd((d) => ({ ...d, past: [...d.past, d.anns], future: [] })), []);
  const undo = useCallback(() => setEd((d) => d.past.length === 0 ? d : {
    anns: d.past[d.past.length - 1], past: d.past.slice(0, -1), future: [...d.future, d.anns],
  }), []);
  const redo = useCallback(() => setEd((d) => d.future.length === 0 ? d : {
    anns: d.future[d.future.length - 1], past: [...d.past, d.anns], future: d.future.slice(0, -1),
  }), []);
  const canUndo = ed.past.length > 0;
  const canRedo = ed.future.length > 0;
  // Edits only live in memory, so anything drawn is lost on leaving.
  const dirty = pdf !== null && anns.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    // Capture phase runs before react-router's link handler; BrowserRouter has no useBlocker.
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a[href]");
      if (link && !window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
  const patch = (id: string, p: Partial<Annotation>) => setAnns((prev) => prev.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const selected = anns.find((a) => a.id === selectedId);
  const shownPt = selected?.kind === "text" && pdf ? Math.round((selected.fontSize ?? 0) * pdf.widths[selected.pageIndex]) : fontPt;

  const openFile = async (file?: File) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setMessage("PDFファイルを選択してください");
      return;
    }
    try {
      const doc = await loadPdf(await file.arrayBuffer());
      const widths = await Promise.all(
        Array.from({ length: doc.numPages }, async (_, i) => (await doc.getPage(i + 1)).getViewport({ scale: 1 }).width),
      );
      setPdf({ name: file.name, doc, widths });
      setEd({ anns: [], past: [], future: [] });
      setSelectedId(null);
      setMessage(null);
    } catch (e) {
      setMessage(`PDFを読み込めませんでした: ${(e as Error).message}`);
    }
  };

  const runAi = async () => {
    if (!pdf) return;
    setBusy("ai");
    setMessage(null);
    try {
      const res = await detect({ pages: await pageImagesForAi(pdf.doc) }) as {
        companyTexts: string[];
        boxes: { pageIndex: number; label: string; bbox: { x: number; y: number; width: number; height: number } }[];
      };
      const found: Annotation[] = res.boxes.map((b) => ({
        id: newId(), pageIndex: b.pageIndex, kind: "box", color: "#ffffff", label: b.label,
        x: Math.max(0, b.bbox.x - AI_PAD), y: Math.max(0, b.bbox.y - AI_PAD),
        w: b.bbox.width + AI_PAD * 2, h: b.bbox.height + AI_PAD * 2,
      }));
      for (const t of await findTextBoxes(pdf.doc, res.companyTexts)) {
        const covered = found.some((f) => f.pageIndex === t.pageIndex && overlap(f, t) > 0.5 * t.w * t.h);
        if (!covered) found.push({ id: newId(), kind: "box", color: "#ffffff", ...t, label: `会社情報 (${t.label})` });
      }
      const merged = mergeNearby(found).map((b) => ({ ...b, id: newId() }));
      commit((prev) => [...prev, ...merged]);
      setMessage(merged.length ? `${merged.length}箇所を白抜きしました。確認して必要なら調整してください。` : "会社情報は検出されませんでした。");
    } catch (e) {
      setMessage(`AI検出に失敗しました: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!pdf) return;
    setBusy("export");
    try {
      const bytes = await exportPdf(pdf.doc, anns.filter((a) => a.kind === "box" || a.text?.trim()));
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = pdf.name.replace(/\.pdf$/i, "") + "_帯替え.pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setMessage(`PDFの書き出しに失敗しました: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (editingId || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && TOOLS.some((x) => x.key === e.key.toUpperCase())) {
        setTool(TOOLS.find((x) => x.key === e.key.toUpperCase())!.t);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        commit((prev) => prev.filter((a) => a.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, selectedId, undo, redo, commit]);

  const setStyle = (p: { color?: string; fontPt?: number; bold?: boolean; font?: string }) => {
    if (p.color) setColor(p.color);
    if (p.fontPt) setFontPt(p.fontPt);
    if (p.font) setFont(p.font);
    if (!selected || !pdf) return;
    commit((prev) => prev.map((a) => a.id !== selected.id ? a : {
      ...a,
      ...(p.color && { color: p.color }),
      ...(p.fontPt && { fontSize: p.fontPt / pdf.widths[a.pageIndex] }),
      ...(p.bold !== undefined && { bold: p.bold }),
      ...(p.font && a.kind === "text" && { font: p.font }),
    }));
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">図面の帯替え</h1>
          <p className="page-subtitle">
            販売図面PDFから元付業者の会社情報をAIで白抜きし、テキストやボックスを追加して書き出せます。
          </p>
        </div>
      </div>

      {!pdf ? (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void openFile(e.dataTransfer.files[0]);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-[var(--border-subtle)] bg-white p-16 text-center shadow-xs hover:border-[var(--brand)]"
        >
          <FileUp className="h-10 w-10 text-[var(--text-muted)]" />
          <span className="text-[15px] font-bold">PDFをドロップ、またはクリックして選択</span>
          <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void openFile(e.target.files?.[0])} />
        </label>
      ) : (
        <>
          <div className="sticky top-0 z-10 rounded-2xl border border-[var(--border-subtle)] bg-white shadow-xs">
            <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] text-white">
                <FileText className="h-4 w-4" />
              </div>
              <span className="min-w-0 truncate text-[14px] font-bold">{pdf.name}</span>
              <span className="text-[13px] text-[var(--text-muted)]">・{pdf.widths.length}ページ</span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" onClick={() => {
                  if (dirty && !window.confirm(LEAVE_MESSAGE)) return;
                  void pdf.doc.destroy();
                  setPdf(null);
                }}>
                  <FolderOpen className="h-4 w-4" />
                  別のPDFを開く
                </Button>
                <Button onClick={download} disabled={busy !== null}>
                  {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {busy === "export" ? "書き出し中..." : "ダウンロード"}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
              <button
                onClick={runAi}
                disabled={busy !== null}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--brand)_8%,white)] px-3 font-bold text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_14%,white)] disabled:opacity-60"
              >
                {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {busy === "ai" ? "検出中..." : "AIで会社情報を消去"}
              </button>
              <Divider />
              <div className="flex rounded-lg bg-[#f1efea] p-0.5">
                {TOOLS.map(({ t, Icon, label, key }) => (
                  <button
                    key={t}
                    onClick={() => setTool(t)}
                    aria-pressed={tool === t}
                    title={`${label} (${key})`}
                    className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 ${tool === t ? "bg-white font-bold shadow-xs" : "text-[var(--text-muted)] hover:text-inherit"}`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                    <span className="text-[11px] font-normal text-[var(--text-muted)]">{key}</span>
                  </button>
                ))}
              </div>
              <Divider />
              <span className="text-[var(--text-muted)]">塗り</span>
              {["#000000", "#ffffff"].map((c) => (
                <button
                  key={c}
                  onClick={() => setStyle({ color: c })}
                  aria-label={c === "#ffffff" ? "白" : "黒"}
                  className={`h-8 w-8 rounded-md border border-[var(--border-subtle)] ${color === c ? "ring-2 ring-[var(--brand)] ring-offset-1" : ""}`}
                  style={{ background: c }}
                />
              ))}
              <label
                title="その他の色"
                className={`relative h-8 w-8 cursor-pointer overflow-hidden rounded-md border border-[var(--border-subtle)] ${!["#000000", "#ffffff"].includes(color) ? "ring-2 ring-[var(--brand)] ring-offset-1" : ""}`}
                style={{ background: ["#000000", "#ffffff"].includes(color) ? "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" : color }}
              >
                <input type="color" value={color} onChange={(e) => setStyle({ color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
              <Divider />
              <span className="text-[var(--text-muted)]">文字</span>
              <select
                value={selected?.kind === "text" ? selected.font ?? FONTS[0].id : font}
                onChange={(e) => setStyle({ font: e.target.value })}
                aria-label="フォント"
                className="h-9 max-w-44 rounded-lg border border-[var(--border-subtle)] bg-white px-2"
              >
                {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <div className="flex h-9 items-center rounded-lg border border-[var(--border-subtle)]">
                <button aria-label="文字を小さく" onClick={() => setStyle({ fontPt: Math.max(4, shownPt - 1) })} className="flex h-full w-8 items-center justify-center hover:bg-black/5"><Minus className="h-3.5 w-3.5" /></button>
                <input
                  type="number" min={4} max={96} value={shownPt} aria-label="文字サイズ (pt)"
                  onChange={(e) => setStyle({ fontPt: Number(e.target.value) || 12 })}
                  className="h-full w-10 border-x border-[var(--border-subtle)] text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="px-1.5 text-[var(--text-muted)]">pt</span>
                <button aria-label="文字を大きく" onClick={() => setStyle({ fontPt: Math.min(96, shownPt + 1) })} className="flex h-full w-8 items-center justify-center border-l border-[var(--border-subtle)] hover:bg-black/5"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              {selected?.kind === "text" && (
                <button
                  onClick={() => setStyle({ bold: !selected.bold })}
                  aria-pressed={!!selected.bold}
                  className={`h-9 w-9 rounded-lg border border-[var(--border-subtle)] font-bold ${selected.bold ? "bg-[#f1efea]" : ""}`}
                >
                  B
                </button>
              )}
              <div className="ml-auto flex items-center gap-1">
                <IconButton label="縮小" onClick={() => setZoom((z) => Math.max(ZOOMS[0], ZOOMS.findLast((x) => x < z) ?? z))} disabled={zoom <= ZOOMS[0]}><ZoomOut className="h-4 w-4" /></IconButton>
                <button onClick={() => setZoom(1)} title="100%に戻す" className="h-9 w-12 rounded-lg text-center tabular-nums hover:bg-black/5">{Math.round(zoom * 100)}%</button>
                <IconButton label="拡大" onClick={() => setZoom((z) => ZOOMS.find((x) => x > z) ?? z)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]}><ZoomIn className="h-4 w-4" /></IconButton>
                <Divider />
                <IconButton label="元に戻す (Ctrl+Z)" onClick={undo} disabled={!canUndo}><Undo2 className="h-4 w-4" /></IconButton>
                <IconButton label="やり直す (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}><Redo2 className="h-4 w-4" /></IconButton>
                <Divider />
                <IconButton
                  label="削除 (Delete)" disabled={!selected}
                  onClick={() => { commit((prev) => prev.filter((a) => a.id !== selectedId)); setSelectedId(null); }}
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
          </div>

          {message && <p className="text-[13.5px] text-[var(--text-muted)]">{message}</p>}

          {/* Children center with mx-auto, not items-center, so a zoomed page scrolls instead of clipping its left side. */}
          <div className="flex flex-col gap-6 overflow-x-auto pb-10">
            {pdf.widths.map((widthPt, i) => (
              <PageView
                key={`${pdf.name}-${i}`}
                doc={pdf.doc}
                zoom={zoom}
                pageIndex={i}
                anns={anns.filter((a) => a.pageIndex === i)}
                tool={tool}
                selectedId={selectedId}
                editingId={editingId}
                onSelect={setSelectedId}
                onEdit={setEditingId}
                onCreate={(a) => {
                  // White text on a white page would be invisible, so new text starts black.
                  const c = (a.kind === "text" || a.outline) && color === "#ffffff" ? "#000000" : color;
                  commit((prev) => [...prev, { ...a, color: c, fontSize: fontPt / widthPt, ...(a.kind === "text" && { font }) }]);
                  setSelectedId(a.id);
                  if (a.kind === "text") setEditingId(a.id);
                }}
                onDragStart={snapshot}
                patch={patch}
                onRemove={(id) => setAnns((prev) => prev.filter((a) => a.id !== id))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const Divider = () => <div className="mx-1 h-6 w-px bg-[var(--border-subtle)]" />;

function IconButton({ label, children, ...rest }: { label: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button {...rest} title={label} aria-label={label} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-black/5 disabled:opacity-35 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

function PageView(props: {
  doc: PdfDoc;
  zoom: number;
  pageIndex: number;
  anns: Annotation[];
  tool: Tool;
  selectedId: string | null;
  editingId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  onCreate: (a: Annotation) => void;
  onDragStart: () => void;
  patch: (id: string, p: Partial<Annotation>) => void;
  onRemove: (id: string) => void;
}) {
  const { doc, zoom, pageIndex, anns, tool, selectedId, editingId, onSelect, onEdit, onCreate, onDragStart, patch, onRemove } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // Double-click is detected by hand: pointer capture on the overlay keeps dblclick off the text element.
  const lastDown = useRef({ id: "", t: 0 });

  useEffect(() => {
    // Render offscreen then copy: StrictMode runs this twice, and pdf.js rejects two renders on one canvas.
    let cancelled = false;
    void renderPage(doc, pageIndex, Math.min(6, 2 * zoom)).then((src) => {
      const dst = canvasRef.current;
      if (cancelled || !dst) return;
      dst.width = src.width;
      dst.height = src.height;
      dst.getContext("2d")!.drawImage(src, 0, 0);
    });
    return () => { cancelled = true; };
  }, [doc, pageIndex, zoom]);

  const point = (e: React.PointerEvent) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const startDrag = (e: React.PointerEvent, a: Annotation, mode: Drag["mode"], recorded = false) => {
    e.stopPropagation();
    overlayRef.current!.setPointerCapture(e.pointerId);
    const p = point(e);
    drag.current = { id: a.id, mode, startX: p.x, startY: p.y, orig: a, recorded };
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onEdit(null);
    const p = point(e);
    if (tool === "select") return onSelect(null);
    const a: Annotation = { id: crypto.randomUUID(), pageIndex, kind: tool === "text" ? "text" : "box", outline: tool === "outline" || undefined, x: p.x, y: p.y, w: 0, h: 0, color: "", text: tool === "text" ? "" : undefined };
    onCreate(a);
    if (a.kind === "box") startDrag(e, a, "se", true);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.recorded) {
      onDragStart();
      d.recorded = true;
    }
    const p = point(e);
    const dx = p.x - d.startX, dy = p.y - d.startY;
    if (d.mode === "move") {
      patch(d.id, { x: d.orig.x + dx, y: d.orig.y + dy });
    } else {
      // min/abs lets an edge dragged past its opposite flip the box instead of giving negative sizes.
      const { x, y, w, h } = d.orig;
      const m = d.mode;
      const x1 = x + (m.includes("w") ? dx : 0), x2 = x + w + (m.includes("e") ? dx : 0);
      const y1 = y + (m.includes("n") ? dy : 0), y2 = y + h + (m.includes("s") ? dy : 0);
      patch(d.id, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    const a = d && anns.find((x) => x.id === d.id);
    if (a?.kind === "box" && (a.w < 0.003 || a.h < 0.003)) onRemove(a.id);
  };

  return (
    <div className="relative mx-auto shrink-0 shadow-md" style={{ containerType: "inline-size", width: `calc(min(100%, 1000px) * ${zoom})` }}>
      <canvas ref={canvasRef} className="block h-auto w-full bg-white" />
      <div
        ref={overlayRef}
        className={`absolute inset-0 ${tool === "select" ? "" : "cursor-crosshair"}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {anns.map((a) => {
          const isSel = a.id === selectedId;
          const ring = isSel ? "outline outline-2 outline-[var(--brand)]" : "outline outline-1 outline-dashed outline-sky-400/70";
          const common = {
            title: a.label,
            onPointerDown: (e: React.PointerEvent) => {
              if (a.id === editingId) return e.stopPropagation();
              const now = Date.now();
              const isDouble = a.kind === "text" && lastDown.current.id === a.id && now - lastDown.current.t < 400;
              lastDown.current = { id: a.id, t: now };
              if (isDouble) {
                e.stopPropagation();
                return onEdit(a.id);
              }
              onSelect(a.id);
              startDrag(e, a, "move");
            },
          };
          if (a.kind === "box") {
            return (
              <div
                key={a.id} {...common}
                className={`absolute cursor-move ${ring}`}
                style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%`, ...(a.outline ? { border: `${OUTLINE_WIDTH * 100}cqw solid ${a.color}` } : { background: a.color }) }}
              >
                {isSel && HANDLES.map(({ c, cls }) => (
                  <div
                    key={c}
                    className={`absolute h-3 w-3 rounded-sm border border-white bg-[var(--brand)] ${cls}`}
                    onPointerDown={(e) => startDrag(e, a, c)}
                  />
                ))}
              </div>
            );
          }
          const editing = a.id === editingId;
          return (
            <div
              // Remount on edit so React never reconciles children the user typed into.
              key={`${a.id}-${editing}`} {...common}
              ref={(el) => {
                if (!el || !editing || el.dataset.init) return;
                el.dataset.init = "1";
                el.innerText = a.text ?? "";
                // Deferred: focusing inside pointerdown is undone by the click's own focus change, which blurs and deletes the new empty text.
                setTimeout(() => el.focus());
              }}
              contentEditable={editing}
              suppressContentEditableWarning
              // Saved per keystroke: leaving edit mode can unmount this element before blur fires.
              onInput={(e) => patch(a.id, { text: e.currentTarget.innerText.replace(/\n$/, "") })}
              onBlur={() => onEdit(null)}
              className={`absolute min-w-[1em] whitespace-pre ${editing ? "cursor-text" : "cursor-move"} ${ring}`}
              style={{
                left: `${a.x * 100}%`, top: `${a.y * 100}%`, color: a.color,
                fontSize: `${(a.fontSize ?? 0.015) * 100}cqw`, lineHeight: LINE_HEIGHT,
                fontFamily: fontCss(a.font), fontWeight: a.bold ? 700 : 400,
              }}
            >
              {editing ? null : a.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
