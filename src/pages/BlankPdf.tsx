import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, Download, FileText, FileUp, FolderOpen, ImagePlus, Loader2, Upload, X, Minus, MousePointer2, Plus, Redo2, Sparkles, Square, SquareDashed, Trash2, Type, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "../components/ui/button";
import { useApiMutation, useApiQuery } from "../hooks/useApi";
import { api } from "../lib/api";
import {
  type Annotation, type PdfDoc, FONTS, FONTS_CSS_URL, LINE_HEIGHT, OUTLINE_WIDTH, fontCss,
  type ImageDrop, IMAGE_MIME, type PlacedSignature, type SavedImage, exportPdf, fileToSavedImage, findTextBoxes, loadPdf, pageImagesForAi, renderPage, runsOf,
} from "../lib/pdfBlank";
import {
  type Run, type RunStyle, clearRunStyle, getSelectionOffsets, normalizeRuns, plainText, readRuns, setSelectionOffsets, styleRange, writeRuns,
} from "../lib/richText";
import { mergeNearby } from "../lib/mergeBoxes";
import { SignatureMenu } from "../components/SignatureMenu";
import { logoPng, renderSignature } from "../lib/signature";
import { type Restack, restack } from "../lib/restack";

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
const TEXT_HANDLES = HANDLES.filter((h) => h.c === "e" || h.c === "w");
const CORNER_HANDLES = HANDLES.filter((h) => h.c.length === 2);
// Edges rewrap, corners scale.
// Only one editor is ever mounted, so a module counter is enough to order signature redraws.
let redrawSeq = 0;
const SIGNATURE_HANDLES = [...TEXT_HANDLES, ...CORNER_HANDLES];
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
const IMAGE_WIDTH = 0.2; // dropped images start at 20% of page width
// Signature PNG px -> PDF pt, so their small text lands at ~9pt on any page size.
const SIGNATURE_PT_PER_PX = 9 / 40;
const LAYER_ITEMS: { to: Restack; label: string }[] = [
  { to: "front", label: "最前面へ移動" },
  { to: "forward", label: "前面へ移動" },
  { to: "backward", label: "背面へ移動" },
  { to: "back", label: "最背面へ移動" },
];

// Toolbar buttons must not take focus, or the open text editor closes and loses its selection.
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export default function BlankPdfPage() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [ed, setEd] = useState<{ anns: Annotation[]; past: Annotation[][]; future: Annotation[][] }>({ anns: [], past: [], future: [] });
  const anns = ed.anns;
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#ffffff");
  const [fontPt, setFontPt] = useState(12);
  const [font, setFont] = useState<string>(FONTS[0].id);
  const [zoom, setZoom] = useState(1);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: FONTS_CSS_URL });
    document.head.appendChild(link);
    return () => link.remove();
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingIdRaw] = useState<string | null>(null);
  // The open text editor element, and the last text selection made in it (kept after the toolbar takes focus).
  const editorEl = useRef<HTMLDivElement | null>(null);
  const [textSel, setTextSel] = useState<{ id: string; start: number; end: number } | null>(null);
  useEffect(() => {
    const onSel = () => {
      const el = editorEl.current;
      const o = el && editingId ? getSelectionOffsets(el) : null;
      if (o && editingId) setTextSel((s) => (s?.id === editingId && s.start === o.start && s.end === o.end ? s : { id: editingId, ...o }));
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [editingId]);
  const [busy, setBusy] = useState<"ai" | "export" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const detect = useApiMutation(api.blankPdf.detect);
  const images = useApiQuery(api.blankPdf.images) as SavedImage[] | undefined;
  const addImage = useApiMutation(api.blankPdf.addImage);
  const removeImage = useApiMutation(api.blankPdf.removeImage);
  const [imgOpen, setImgOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const imgMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!imgOpen) return;
    const close = (e: PointerEvent) => {
      if (!imgMenuRef.current?.contains(e.target as Node)) setImgOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [imgOpen]);

  const uploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) await addImage(await fileToSavedImage(f));
    } catch (e) {
      setMessage(`画像の保存に失敗しました: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  // Live edits (drag, typing) skip history; commit and snapshot record one undo step.
  const setAnns = useCallback((next: Updater) => setEd((d) => ({ ...d, anns: apply(next, d.anns) })), []);
  // Leaving a text that was never typed into drops it, whichever way editing ended.
  const setEditingId = useCallback((id: string | null) => {
    if (editingId && editingId !== id) setAnns((list) => list.filter((a) => a.id !== editingId || a.kind !== "text" || a.text?.trim()));
    if (id && id !== editingId) setTextSel(null);
    setEditingIdRaw(id);
  }, [editingId, setAnns]);
  const commit = useCallback((next: Updater) => setEd((d) => ({ anns: apply(next, d.anns), past: [...d.past, d.anns], future: [] })), []);
  const snapshot = useCallback(() => setEd((d) => ({ ...d, past: [...d.past, d.anns], future: [] })), []);

  // Redraws a placed signature with one line restyled. The PNG's pixels-per-page scale is kept,
  // so other lines stay the same size on the page; the block grows or shrinks from its top-left.
  const redrawSignature = async (
    id: string,
    next: (s: PlacedSignature, a: Annotation) => { styles: PlacedSignature["styles"]; maxWidth?: number },
    record: boolean,
  ) => {
    const a = anns.find((x) => x.id === id);
    if (!a?.signature) return;
    const s = a.signature;
    const sx = s.sx ?? a.w / s.w, sy = s.sy ?? a.h / s.h;
    const { styles, maxWidth } = next(s, a);
    const seq = ++redrawSeq;
    const r = await renderSignature(s.fields, styles, maxWidth);
    // Typing fires many renders; drop any that finish after a newer one started.
    if (seq !== redrawSeq) return;
    const update = (prev: Annotation[]) => prev.map((x) => (x.id !== id || !x.signature ? x : {
      ...x, src: r.src, w: r.w * sx, h: r.h * sy,
      signature: { ...x.signature, styles, maxWidth, sx, sy, w: r.w, h: r.h, lines: r.lines },
    }));
    if (record) commit(update);
    else setAnns(update);
  };
  // Double-click: the signature becomes one rich text box (sizes and bold kept per item) plus the logo image.
  const ungroupSignature = async (id: string) => {
    const a = anns.find((x) => x.id === id);
    if (!a?.signature) return;
    const s = a.signature;
    const r = await renderSignature(s.fields, s.styles, s.maxWidth);
    const kx = a.w / r.w, ky = a.h / r.h;
    // Items on the same drawn line stay on one line, separated by full-width spaces.
    const rows = [...new Set(r.lines.map((l) => l.y))].map((y) => r.lines.filter((l) => l.y === y).sort((p, q) => p.x - q.x));
    const runs: Run[] = normalizeRuns(rows.flatMap((row, n) => [
      ...(n ? [{ text: "\n", size: row[0].size * kx }] : []),
      ...row.flatMap((l, k) => [
        ...(k ? [{ text: "　", size: l.size * kx }] : []),
        { text: l.text, size: l.size * kx, ...(l.bold && { bold: true }) },
      ]),
    ]));
    const smallest = Math.min(...r.lines.map((l) => l.size)) * kx;
    const left = r.logo ? r.logo.x + r.logo.size + 24 : r.lines.length ? Math.min(...r.lines.map((l) => l.x)) : 0;
    const top = r.lines.length ? r.lines[0].y + (r.lines[0].h - r.lines[0].size * LINE_HEIGHT) / 2 : 0;
    const text: Annotation = {
      id: crypto.randomUUID(), pageIndex: a.pageIndex, kind: "text", runs, text: plainText(runs), font: "noto-sans", color: "#111111",
      fontSize: smallest, x: a.x + left * kx, y: a.y + top * ky, w: 0, h: 0,
    };
    const logo: Annotation[] = r.logo ? [{
      id: crypto.randomUUID(), pageIndex: a.pageIndex, kind: "image", src: logoPng(), keepRatio: true, label: "ロゴ", color: "",
      x: a.x + r.logo.x * kx, y: a.y + r.logo.y * ky, w: r.logo.size * kx, h: r.logo.size * ky,
    }] : [];
    commit((prev) => prev.flatMap((x) => (x.id === id ? [...logo, text] : [x])));
    setSelectedId(text.id);
    setEditingId(text.id);
  };
  // After an edge drag: wrap to the new width. Not a new undo step; the drag already recorded one.
  const reflowSignature = (id: string) =>
    redrawSignature(id, (s, a) => ({ styles: s.styles, maxWidth: a.w / (s.sx ?? a.w / s.w) }), false);
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
  const closePdf = useCallback(() => {
    void pdf?.doc.destroy();
    setPdf(null);
    setEd({ anns: [], past: [], future: [] });
    setSelectedId(null);
    setEditingIdRaw(null);
    setMessage(null);
  }, [pdf]);
  useEffect(() => {
    if (!pdf) return;
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    // Capture phase runs before react-router's link handler; BrowserRouter has no useBlocker.
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      if (dirty && !window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Navigating to this same page keeps it mounted, so the menu item resets it by hand.
      if (new URL(link.href).pathname === window.location.pathname) closePdf();
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [pdf, dirty, closePdf]);
  const patch = (id: string, p: Partial<Annotation>) => setAnns((prev) => prev.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const selected = anns.find((a) => a.id === selectedId);
  // A selected range inside the selected text box gets the toolbar's styles, like Word; otherwise the whole box does.
  const range = selected?.kind === "text" && textSel?.id === selected.id && textSel.start < textSel.end ? textSel : null;
  const styleAtSel: RunStyle = (() => {
    if (!range || !selected) return {};
    let pos = 0;
    for (const r of runsOf(selected)) {
      pos += Array.from(r.text).length;
      if (pos > range.start) return r;
    }
    return {};
  })();
  const shownPt = selected?.kind === "text" && pdf ? Math.round((styleAtSel.size ?? selected.fontSize ?? 0) * pdf.widths[selected.pageIndex]) : fontPt;
  const shownBold = styleAtSel.bold ?? !!selected?.bold;

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
      const bytes = await exportPdf(pdf.doc, anns.filter((a) => a.kind !== "text" || a.text?.trim()));
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
      } else if (e.key.startsWith("Arrow") && selectedId && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        // Shift moves 10x. A held key is one undo step: history is recorded on the first press only.
        const step = e.shiftKey ? 0.01 : 0.001;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (!e.repeat) snapshot();
        setAnns((prev) => prev.map((a) => (a.id === selectedId ? { ...a, x: a.x + dx, y: a.y + dy } : a)));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        commit((prev) => prev.filter((a) => a.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, selectedId, undo, redo, commit, snapshot, setAnns]);

  const setStyle = (p: { color?: string; fontPt?: number; bold?: boolean; font?: string; align?: Annotation["align"] }) => {
    if (p.color) setColor(p.color);
    if (p.fontPt) setFontPt(p.fontPt);
    if (p.font) setFont(p.font);
    if (!selected || !pdf) return;
    const run: RunStyle = {
      ...(p.color && { color: p.color }),
      ...(p.fontPt && { size: p.fontPt / pdf.widths[selected.pageIndex] }),
      ...(p.bold !== undefined && { bold: p.bold }),
    };
    if (selected.kind === "text" && range && Object.keys(run).length) {
      const runs = styleRange(runsOf(selected), range.start, range.end, run);
      commit((prev) => prev.map((a) => (a.id === selected.id ? { ...a, runs } : a)));
      // The editor is uncontrolled, so it is redrawn by hand and keeps its selection.
      const el = editorEl.current;
      if (el && editingId === selected.id) {
        writeRuns(el, runs);
        setSelectionOffsets(el, range.start, range.end);
      }
      return;
    }
    let runs = selected.kind === "text" ? runsOf(selected) : undefined;
    // Whole box: drop per-range overrides of the same property so the change shows everywhere.
    if (runs) for (const k of Object.keys(run) as (keyof RunStyle)[]) runs = clearRunStyle(runs, k);
    commit((prev) => prev.map((a) => a.id !== selected.id ? a : {
      ...a,
      ...(runs && { runs }),
      ...(p.color && { color: p.color }),
      ...(p.fontPt && { fontSize: p.fontPt / pdf.widths[a.pageIndex] }),
      ...(p.bold !== undefined && { bold: p.bold }),
      ...(p.font && a.kind === "text" && { font: p.font }),
      ...(p.align && a.kind === "text" && { align: p.align }),
    }));
    if (runs && editorEl.current && editingId === selected.id) {
      writeRuns(editorEl.current, runs);
      if (textSel?.id === selected.id) setSelectionOffsets(editorEl.current, textSel.start, textSel.end);
    }
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
                  closePdf();
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
              <div ref={imgMenuRef} className="relative">
                <button
                  onClick={() => setImgOpen((o) => !o)}
                  aria-expanded={imgOpen}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 hover:bg-black/5"
                >
                  <ImagePlus className="h-4 w-4" />
                  画像
                  <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                </button>
                {imgOpen && (
                  <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-xl border border-[var(--border-subtle)] bg-white p-3 shadow-lg">
                    <p className="mb-2 text-[12px] text-[var(--text-muted)]">ページへドラッグして配置</p>
                    {images === undefined ? (
                      <Loader2 className="mx-auto my-4 h-5 w-5 animate-spin text-[var(--text-muted)]" />
                    ) : images.length === 0 ? (
                      <p className="py-4 text-center text-[var(--text-muted)]">保存済みの画像はありません</p>
                    ) : (
                      <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
                        {images.map((img) => (
                          <div key={img._id} className="group relative">
                            <img
                              src={img.src} alt={img.name} title={img.name} draggable
                              onDragStart={(e) => {
                                const drop: ImageDrop = { src: img.src, w: img.w, h: img.h, name: img.name, width: IMAGE_WIDTH };
                                e.dataTransfer.setData(IMAGE_MIME, JSON.stringify(drop));
                                e.dataTransfer.effectAllowed = "copy";
                              }}
                              className="h-20 w-full cursor-grab rounded-md border border-[var(--border-subtle)] bg-[#f7f6f3] object-contain p-1"
                            />
                            <button
                              aria-label={`${img.name}を削除`}
                              onClick={() => { if (window.confirm(`「${img.name}」を削除しますか？`)) void removeImage({ id: img._id }); }}
                              className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white group-hover:flex"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <label className={`mt-3 flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-subtle)] hover:bg-black/5 ${uploading ? "pointer-events-none opacity-60" : ""}`}>
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploading ? "アップロード中..." : "画像をアップロード"}
                      <input
                        type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                        onChange={(e) => { void uploadImages(e.target.files); e.target.value = ""; }}
                      />
                    </label>
                  </div>
                )}
              </div>
              <SignatureMenu />
              <Divider />
              <span className="text-[var(--text-muted)]">塗り</span>
              {["#000000", "#ffffff"].map((c) => (
                <button
                  key={c}
                  onMouseDown={keepFocus}
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
                <button aria-label="文字を小さく" onMouseDown={keepFocus} onClick={() => setStyle({ fontPt: Math.max(4, shownPt - 1) })} className="flex h-full w-8 items-center justify-center hover:bg-black/5"><Minus className="h-3.5 w-3.5" /></button>
                <input
                  type="number" min={4} max={96} value={shownPt} aria-label="文字サイズ (pt)"
                  onChange={(e) => setStyle({ fontPt: Number(e.target.value) || 12 })}
                  className="h-full w-10 border-x border-[var(--border-subtle)] text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="px-1.5 text-[var(--text-muted)]">pt</span>
                <button aria-label="文字を大きく" onMouseDown={keepFocus} onClick={() => setStyle({ fontPt: Math.min(96, shownPt + 1) })} className="flex h-full w-8 items-center justify-center border-l border-[var(--border-subtle)] hover:bg-black/5"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              {selected?.kind === "text" && (
                <>
                  <button
                    onMouseDown={keepFocus}
                    onClick={() => setStyle({ bold: !shownBold })}
                    aria-label="太字" aria-pressed={shownBold}
                    className={`h-9 w-9 rounded-lg border border-[var(--border-subtle)] font-bold ${shownBold ? "bg-[#f1efea]" : ""}`}
                  >
                    B
                  </button>
                  <div className="flex h-9 items-center rounded-lg border border-[var(--border-subtle)]">
                    {([["left", "左揃え", AlignLeft], ["center", "中央揃え", AlignCenter], ["right", "右揃え", AlignRight]] as const).map(([v, label, Icon]) => (
                      <button
                        key={v} aria-label={label} title={label} aria-pressed={(selected.align ?? "left") === v}
                        onMouseDown={keepFocus}
                        onClick={() => setStyle({ align: v })}
                        className={`flex h-full w-8 items-center justify-center hover:bg-black/5 ${(selected.align ?? "left") === v ? "bg-[#f1efea]" : ""}`}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                </>
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
                onSelect={(id) => { setSelectedId(id); setTextSel(null); }}
                onEditorEl={(el) => { editorEl.current = el; }}
                onEdit={setEditingId}
                onCreate={(a) => {
                  // White text on a white page would be invisible, so new text starts black.
                  const c = (a.kind === "text" || a.outline) && color === "#ffffff" ? "#000000" : color;
                  commit((prev) => [...prev, { ...a, color: c, fontSize: fontPt / widthPt, ...(a.kind === "text" && { font }) }]);
                  setSelectedId(a.id);
                  if (a.kind === "text") setEditingId(a.id);
                  setTool("select");
                }}
                onDragStart={snapshot}
                patch={patch}
                onRemove={(id) => setAnns((prev) => prev.filter((a) => a.id !== id))}
                onMenu={setMenu}
                onUngroupSignature={(id) => void ungroupSignature(id)}
                onSignatureResize={(id) => void reflowSignature(id)}
                onDropImage={(img, x, y, pageAspect) => {
                  // Signatures land at a standard text size; other images at a share of the page width.
                  const w = img.signature ? (img.w * SIGNATURE_PT_PER_PX) / widthPt : img.width;
                  const h = (w * img.h) / img.w / pageAspect;
                  if (img.signature) img = { ...img, signature: { ...img.signature, sx: w / img.w, sy: h / img.h } };
                  const id = newId();
                  commit((prev) => [...prev, { id, pageIndex: i, kind: "image", src: img.src, label: img.name, keepRatio: img.keepRatio, signature: img.signature, x: x - w / 2, y: y - h / 2, w, h, color: "" }]);
                  setSelectedId(id);
                  setTool("select");
                  setImgOpen(false);
                }}
              />
            ))}
          </div>


          {/* Portal: a transformed ancestor would make "fixed" relative to it instead of the viewport. */}
          {menu && createPortal(
            // Backdrop closes the menu on any click, including another right-click.
            <div className="fixed inset-0 z-50" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
              <div
                role="menu"
                className="fixed min-w-40 rounded-lg border border-[var(--border-subtle)] bg-white py-1 text-[13.5px] shadow-lg"
                style={{ left: menu.x, top: menu.y }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {LAYER_ITEMS.map(({ to, label }) => (
                  <button
                    key={to} role="menuitem"
                    className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
                    onClick={() => { commit((prev) => restack(prev, menu.id, to)); setMenu(null); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )}
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
  onMenu: (m: { id: string; x: number; y: number }) => void;
  onUngroupSignature: (id: string) => void;
  onEditorEl: (el: HTMLDivElement | null) => void;
  onSignatureResize: (id: string) => void;
  /** pageAspect is height / width, to keep the image's proportions in page fractions. */
  onDropImage: (img: ImageDrop, x: number, y: number, pageAspect: number) => void;
}) {
  const { doc, zoom, pageIndex, anns, tool, selectedId, editingId, onSelect, onEdit, onCreate, onDragStart, patch, onRemove, onMenu, onUngroupSignature, onEditorEl, onSignatureResize, onDropImage } = props;
  const canvasBoxRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // Double-click is detected by hand: pointer capture on the overlay keeps dblclick off the text element.
  const lastDown = useRef({ id: "", t: 0 });

  useEffect(() => {
    // Each render gets a fresh canvas that replaces the shown one when done: StrictMode runs this
    // twice, pdf.js rejects two renders on one canvas, and resizing a shown canvas can leave it half-painted.
    let cancelled = false;
    void renderPage(doc, pageIndex, Math.min(6, 2 * zoom)).then((canvas) => {
      if (cancelled || !canvasBoxRef.current) return;
      canvas.className = "block h-auto w-full";
      canvasBoxRef.current.replaceChildren(canvas);
    });
    return () => { cancelled = true; };
  }, [doc, pageIndex, zoom]);

  const point = (e: { clientX: number; clientY: number }) => {
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
    } else if (d.orig.kind === "image" && d.mode.length === 2) {
      // Corner drag on an image keeps proportions: the opposite corner stays put.
      const { x, y, w, h } = d.orig;
      const m = d.mode;
      const ax = m.includes("w") ? x + w : x, ay = m.includes("n") ? y + h : y;
      const px = (m.includes("w") ? x : x + w) + dx, py = (m.includes("n") ? y : y + h) + dy;
      const nw = Math.max(Math.abs(px - ax), (Math.abs(py - ay) * w) / h), nh = (nw * h) / w;
      patch(d.id, { x: m.includes("w") ? ax - nw : ax, y: m.includes("n") ? ay - nh : ay, w: nw, h: nh });
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
    if (a?.signature && (d?.mode === "e" || d?.mode === "w")) onSignatureResize(a.id);
    // Corner drag scales the whole signature, text included: keep the new size as its scale.
    if (a?.signature && d && d.mode.length === 2) {
      const s = a.signature, f = a.h / d.orig.h;
      patch(a.id, { signature: { ...s, sx: (s.sx ?? d.orig.w / s.w) * f, sy: (s.sy ?? d.orig.h / s.h) * f } });
    }
  };

  return (
    <div className="relative mx-auto shrink-0 shadow-md" style={{ containerType: "inline-size", width: `calc(min(100%, 1000px) * ${zoom})` }}>
      <div ref={canvasBoxRef} className="bg-white" />
      <div
        ref={overlayRef}
        className={`absolute inset-0 ${tool === "select" ? "" : "cursor-crosshair"}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(IMAGE_MIME)) e.preventDefault();
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(IMAGE_MIME);
          if (!raw) return;
          e.preventDefault();
          const r = overlayRef.current!.getBoundingClientRect();
          const p = point(e);
          onDropImage(JSON.parse(raw) as ImageDrop, p.x, p.y, r.height / r.width);
        }}
      >
        {anns.map((a) => {
          const isSel = a.id === selectedId;
          const ring = isSel ? "outline outline-2 outline-[var(--brand)]" : "outline outline-1 outline-dashed outline-sky-400/70";
          const common = {
            title: a.label,
            onContextMenu: (e: React.MouseEvent) => {
              if (a.id === editingId) return;
              e.preventDefault();
              e.stopPropagation();
              onSelect(a.id);
              onMenu({ id: a.id, x: e.clientX, y: e.clientY });
            },
            onPointerDown: (e: React.PointerEvent) => {
              if (a.id === editingId) return e.stopPropagation();
              // Right-click opens the layer menu via onContextMenu; no drag.
              if (e.button === 2) return e.stopPropagation();
              // With a drawing tool, a click on a box or image falls through so text/boxes can be placed on top of it.
              if (tool !== "select" && a.kind !== "text") return;
              const now = Date.now();
              const isDouble = (a.kind === "text" || !!a.signature) && lastDown.current.id === a.id && now - lastDown.current.t < 400;
              lastDown.current = { id: a.id, t: now };
              if (isDouble) {
                e.stopPropagation();
                if (a.signature) return onUngroupSignature(a.id);
                return onEdit(a.id);
              }
              onSelect(a.id);
              startDrag(e, a, "move");
            },
          };
          if (a.kind !== "text") {
            const fill = a.kind === "image" ? {} : a.outline ? { border: `${OUTLINE_WIDTH * 100}cqw solid ${a.color}` } : { background: a.color };
            return (
              <div
                key={a.id} {...common}
                className={`absolute cursor-move ${ring}`}
                style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%`, ...fill }}
              >
                {a.kind === "image" && (a.signature ? (
                  // Drawn at its own scale and clipped while an edge is dragged; it reflows on release instead of stretching.
                  <div className="h-full w-full overflow-hidden">
                    <img
                      src={a.src} alt="" draggable={false}
                      className="pointer-events-none max-w-none select-none"
                      // Scale from the box height: fixed during edge drags, proportional during corner drags.
                      style={{ width: `${((a.signature.w * (a.h / a.signature.h) * ((a.signature.sx ?? 1) / (a.signature.sy ?? 1))) / a.w) * 100}%` }}
                    />
                  </div>
                ) : (
                  <img src={a.src} alt="" draggable={false} className="pointer-events-none h-full w-full select-none" />
                ))}
                {isSel && (a.signature ? SIGNATURE_HANDLES : a.keepRatio ? CORNER_HANDLES : HANDLES).map(({ c, cls }) => (
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
                if (!editing) return;
                onEditorEl(el);
                if (!el || el.dataset.init) return;
                el.dataset.init = "1";
                writeRuns(el, runsOf(a));
                // Deferred: focusing inside pointerdown is undone by the click's own focus change, which blurs and deletes the new empty text.
                setTimeout(() => el.focus());
              }}
              contentEditable={editing}
              suppressContentEditableWarning
              // Saved per keystroke: leaving edit mode can unmount this element before blur fires.
              onInput={(e) => {
                const runs = readRuns(e.currentTarget);
                patch(a.id, { runs, text: plainText(runs) });
              }}
              onKeyDown={(e) => {
                // <br> instead of the browser's <div> per line, so lines map 1:1 to "\n".
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!document.execCommand("insertLineBreak")) document.execCommand("insertText", false, "\n");
                }
              }}
              onPaste={(e) => {
                // Plain text only: pasted HTML would bring fonts and colors the export cannot draw.
                e.preventDefault();
                document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
              }}
              onBlur={() => onEdit(null)}
              className={`absolute min-w-[1em] ${editing ? "cursor-text" : "cursor-move"} ${ring}`}
              style={{
                left: `${a.x * 100}%`, top: `${a.y * 100}%`, color: a.color, textAlign: a.align ?? "left",
                // A width is set once a side handle is dragged; then it wraps per character like the export (layoutRuns).
                ...(a.w > 0 ? { width: `${a.w * 100}%`, whiteSpace: "pre-wrap", wordBreak: "break-all" } : { whiteSpace: "pre" }),
                fontSize: `${(a.fontSize ?? 0.015) * 100}cqw`, lineHeight: LINE_HEIGHT,
                fontFamily: fontCss(a.font), fontWeight: a.bold ? 700 : 400,
              }}
            >
              {editing ? null : runsOf(a).map((r, i) => (
                <span key={i} style={{
                  ...(r.size !== undefined && { fontSize: `${r.size * 100}cqw` }),
                  ...(r.bold !== undefined && { fontWeight: r.bold ? 700 : 400 }),
                  ...(r.color !== undefined && { color: r.color }),
                }}>{r.text}</span>
              ))}
              {isSel && !editing && TEXT_HANDLES.map(({ c, cls }) => (
                <div
                  key={c}
                  contentEditable={false}
                  className={`absolute h-3 w-3 rounded-sm border border-white bg-[var(--brand)] ${cls}`}
                  onPointerDown={(e) => {
                    // Auto-width text has w = 0, so resizing starts from its rendered width.
                    const w = a.w || e.currentTarget.parentElement!.offsetWidth / overlayRef.current!.offsetWidth;
                    startDrag(e, { ...a, w }, c);
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
