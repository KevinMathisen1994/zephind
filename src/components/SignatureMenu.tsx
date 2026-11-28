import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, Pencil, PenLine, Plus, Type, X } from "lucide-react";
import { Button } from "./ui/button";
import { useApiMutation, useApiQuery } from "../hooks/useApi";
import { api } from "../lib/api";
import { type Drop, IMAGE_MIME, type ImageDrop, type SavedItem, templateAnns } from "../lib/pdfBlank";
import {
  type RenderedSignature, type SavedSignature, type SignatureFields,
  renderSignature,
} from "../lib/signature";

type Rendered = RenderedSignature;
const SIGNATURE_WIDTH = 0.6; // dropped signatures start at 60% of page width, like a 帯
// Preview px per signature PNG px; 2段 at 100% fits the modal.
const PREVIEW_SCALE = 0.35;
const MENU_WIDTH = 384; // w-96
const EMPTY: SignatureFields = { companyName: "", address: "", license: "", tel: "", fax: "", dealType: "媒介", showLogo: true, layout: "stacked" };
const LAYOUTS = [
  { value: "stacked", label: "3段", hint: "住所 / 会社名（大）・TEL / 免許番号" },
  { value: "compact", label: "2段", hint: "会社名・住所 / 免許番号・電話番号・Fax番号" },
] as const;
const INPUTS: { key: Exclude<keyof SignatureFields, "showLogo">; label: string; placeholder: string }[] = [
  { key: "companyName", label: "会社名（必須）", placeholder: "例: 株式会社サンプル不動産" },
  { key: "address", label: "住所", placeholder: "例: 東京都千代田区丸の内1-1-1" },
  { key: "license", label: "免許番号", placeholder: "例: 東京都知事(1)第00000号" },
  { key: "tel", label: "電話番号", placeholder: "例: 03-0000-0000" },
  { key: "fax", label: "FAX", placeholder: "例: 03-0000-0001" },
  { key: "dealType", label: "取引態様", placeholder: "例: 媒介" },
];

/** 署名 dropdown for 図面の帯替え: saved signatures to drag onto a page, plus the editor modal. */
export function SignatureMenu() {
  const signatures = useApiQuery(api.blankPdf.signatures) as SavedSignature[] | undefined;
  const removeSignature = useApiMutation(api.blankPdf.removeSignature);
  // Items saved with right-click → 保存 in the editor.
  const items = useApiQuery(api.blankPdf.items) as SavedItem[] | undefined;
  const removeItem = useApiMutation(api.blankPdf.removeItem);
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const [editing, setEditing] = useState<SavedSignature | "new" | null>(null);
  const [previews, setPreviews] = useState<Record<string, Rendered>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // Rendered once per saved version; the same image is what gets placed on the page.
  useEffect(() => {
    let cancelled = false;
    void Promise.all((signatures ?? []).map(async (s) => [s._id, await renderSignature(s.fields)] as const)).then((pairs) => {
      if (!cancelled) setPreviews(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, [signatures]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          // Open toward whichever side has room: the toolbar wraps, so the button can be at either edge.
          const r = ref.current?.getBoundingClientRect();
          setAlignRight(!!r && r.left + MENU_WIDTH > window.innerWidth - 16);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 hover:bg-black/5"
      >
        <PenLine className="h-4 w-4" />
        社名ひな形
        <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
      </button>
      {open && (
        <div className={`absolute ${alignRight ? "right-0" : "left-0"} top-full z-20 mt-1 w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-subtle)] bg-white p-3 shadow-lg`}>
          <p className="mb-2 text-[12px] text-[var(--text-muted)]">ページへドラッグして配置</p>
          {signatures === undefined ? (
            <Loader2 className="mx-auto my-4 h-5 w-5 animate-spin text-[var(--text-muted)]" />
          ) : signatures.length === 0 ? (
            <p className="py-4 text-center text-[var(--text-muted)]">保存済みの署名はありません</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {signatures.map((s, i) => {
                const r = previews[s._id];
                return (
                  <div key={s._id} className="group relative flex items-center gap-2">
                    {/* Beside the preview, not on it, so it never covers the text. */}
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[11px] font-bold text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      {r ? (
                        <img
                          src={r.src} alt={s.name} title={s.name} draggable
                          onDragStart={(e) => {
                            const drop: ImageDrop = {
                              src: r.src, w: r.w, h: r.h, name: s.name, width: SIGNATURE_WIDTH, keepRatio: true,
                              signature: { fields: s.fields, styles: {}, w: r.w, h: r.h, lines: r.lines },
                            };
                            e.dataTransfer.setData(IMAGE_MIME, JSON.stringify(drop));
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                          className="w-full cursor-grab rounded-md border border-[var(--border-subtle)] bg-white p-2"
                        />
                      ) : (
                        <div className="flex h-16 items-center justify-center rounded-md border border-[var(--border-subtle)]">
                          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
                        </div>
                      )}
                    </div>
                    <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex">
                      <button
                        aria-label={`${s.name}を編集`}
                        onClick={() => { setEditing(s); setOpen(false); }}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      {/* Shared templates can be edited by anyone, but only deleted by their owner. */}
                      {s.mine !== false && <button
                        aria-label={`${s.name}を削除`}
                        onClick={() => { if (window.confirm(`社名ひな形 ${i + 1}「${s.name}」を削除しますか？`)) void removeSignature({ id: s._id }); }}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!!items?.length && (
            <>
              <p className="mb-1 mt-3 text-[12px] font-bold text-[var(--text-secondary)]">保存したアイテム</p>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {items.map((it, i) => (
                  <div
                    key={it._id} draggable title={it.name}
                    onDragStart={(e) => {
                      const drop: Drop = { item: it.item, name: it.name };
                      e.dataTransfer.setData(IMAGE_MIME, JSON.stringify(drop));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="group flex h-10 cursor-grab items-center gap-2 rounded-md border border-[var(--border-subtle)] px-2 hover:bg-black/5"
                  >
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[11px] font-bold text-white">
                      {(signatures?.length ?? 0) + i + 1}
                    </span>
                    {templateAnns(it.item).find((a) => a.src)
                      ? <img src={templateAnns(it.item).find((a) => a.src)!.src} alt="" className="h-7 w-10 shrink-0 object-contain" />
                      : <Type className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />}
                    <span className="min-w-0 flex-1 truncate">{it.name}</span>
                    <button
                      aria-label={`${it.name}を削除`}
                      onClick={() => { if (window.confirm(`保存したアイテム ${(signatures?.length ?? 0) + i + 1}「${it.name}」を削除しますか？`)) void removeItem({ id: it._id }); }}
                      className="hidden h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/70 text-white group-hover:flex"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
              )}
          <button
            onClick={() => { setEditing("new"); setOpen(false); }}
            className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-subtle)] hover:bg-black/5"
          >
            <Plus className="h-4 w-4" />
            新しい社名ひな形を作成
          </button>
        </div>
      )}
      {editing && <SignatureEditor initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SignatureEditor({ initial, onClose }: { initial: SavedSignature | null; onClose: () => void }) {
  const [fields, setFields] = useState<SignatureFields>(initial ? { ...EMPTY, ...initial.fields } : EMPTY);
  const [preview, setPreview] = useState<Rendered | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useApiMutation(api.blankPdf.addSignature);
  const update = useApiMutation(api.blankPdf.updateSignature);

  useEffect(() => {
    let cancelled = false;
    if (!fields.companyName.trim()) return;
    void renderSignature(fields).then((r) => { if (!cancelled) setPreview(r); });
    return () => { cancelled = true; };
  }, [fields]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (initial) await update({ id: initial._id, fields });
      else await add({ fields });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Portal: a transformed ancestor on the page would make "fixed" relative to it instead of the viewport.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="署名の編集" className="flex max-h-full w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <h2 className="text-[16px] font-bold">{initial ? "署名を編集" : "新しい署名"}</h2>
          <button onClick={onClose} aria-label="閉じる" className="rounded-full p-1 text-[var(--text-muted)] hover:bg-black/5">
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Only the form scrolls; header and save buttons stay visible on a short window. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <span className="mb-1 block text-[12px] font-bold text-[var(--text-secondary)]">レイアウト</span>
            <div className="grid grid-cols-2 gap-2">
              {LAYOUTS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  aria-pressed={(fields.layout ?? "stacked") === l.value}
                  onClick={() => setFields((f) => ({ ...f, layout: l.value }))}
                  className={`rounded-lg border px-3 py-2 text-left ${(fields.layout ?? "stacked") === l.value ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_8%,white)]" : "border-[var(--border-subtle)] hover:bg-black/5"}`}
                >
                  <span className="block text-[14px] font-bold">{l.label}</span>
                  <span className="block text-[11.5px] text-[var(--text-muted)]">{l.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {INPUTS.map(({ key, label, placeholder }) => (
              <label key={key} className={`block ${key === "companyName" || key === "address" ? "sm:col-span-2" : ""}`}>
                <span className="mb-1 block text-[12px] font-bold text-[var(--text-secondary)]">{label}</span>
                <input
                  value={fields[key] ?? ""}
                  onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  maxLength={100}
                  className="h-10 w-full rounded-lg border border-[var(--border-subtle)] px-3 text-[14px] focus:border-[var(--brand)] focus:outline-none"
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(fields.layout === "compact"
              ? [{ key: "smallScale", label: "文字サイズ" }]
              : [{ key: "bigScale", label: "文字サイズ（会社名・TEL）" }, { key: "smallScale", label: "文字サイズ（住所・免許番号など）" }]
            ).map(({ key, label }) => {
              const k = key as "bigScale" | "smallScale";
              const v = fields[k] ?? 1;
              return (
                <label key={k} className="block">
                  <span className="mb-1 flex justify-between text-[12px] font-bold text-[var(--text-secondary)]">
                    {label}
                    <span className="font-normal text-[var(--text-muted)]">{Math.round(v * 100)}%</span>
                  </span>
                  <input
                    type="range" min={0.6} max={1.6} step={0.05} value={v}
                    onChange={(e) => setFields((f) => ({ ...f, [k]: Number(e.target.value) }))}
                    className="w-full accent-[var(--brand)]"
                  />
                </label>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox" checked={!!fields.showLogo}
              onChange={(e) => setFields((f) => ({ ...f, showLogo: e.target.checked }))}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            Zephindのロゴ（蝶）を入れる
          </label>
          <div>
            <span className="mb-1 block text-[12px] font-bold text-[var(--text-secondary)]">プレビュー</span>
            {/* mx-auto instead of justify-center, so a wide preview scrolls instead of being cut off on the left. */}
            <div className="flex min-h-24 items-center overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[#f7f6f3] p-3">
              {preview && fields.companyName.trim() ? (
                // Fixed scale, not fit-to-box: otherwise a bigger 会社名 shrinks the whole picture and the other lines seem to change size.
                <img src={preview.src} alt="署名のプレビュー" style={{ width: preview.w * PREVIEW_SCALE }} className="mx-auto max-w-none shrink-0 bg-white" />
              ) : (
                <span className="text-[13px] text-[var(--text-muted)]">会社名を入力するとプレビューが表示されます</span>
              )}
            </div>
          </div>
          {error && <p className="text-[13px] font-bold text-rose-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-4">
          <Button variant="outline" onClick={onClose}>キャンセル</Button>
          <Button onClick={save} disabled={saving || !fields.companyName.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

