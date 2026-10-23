import { useState, useMemo } from "react";
import {
  X,
  Copy,
  Check,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { ComparisonListing } from "./PropertyComparisonModal";

interface LineProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  listings: ComparisonListing[];
  orderName?: string;
  customerName?: string;
}

export function LineProposalModal({
  isOpen,
  onClose,
  listings,
  orderName: _orderName,
  customerName,
}: LineProposalModalProps) {
  const [copied, setCopied] = useState(false);
  const [greeting, setGreeting] = useState(
    customerName ? `${customerName}様` : "お客様",
  );
  const [intro, setIntro] = useState(
    "いつも大変お世話になっております。ご希望条件にマッチする最新の注目物件が入荷いたしましたので、早速ご案内いたします！",
  );

  // Generate LINE formatted copy
  const lineText = useMemo(() => {
    const lines: string[] = [
      `${greeting}、お世話になっております！`,
      "",
      intro,
      "",
      "━━━━━━━━━━━━━━━━",
      `📱 本日の厳選物件情報 (${listings.length}件)`,
      "━━━━━━━━━━━━━━━━",
      "",
    ];

    listings.forEach((item, idx) => {
      const l = item.listing;
      const area = l.area || l.landSize || 0;
      const currentYield = l.yield || l.grossYield;
      const priceStr = l.price
        ? `${l.price.toLocaleString()}万円`
        : l.rent
          ? `賃料 ${l.rent.toLocaleString()}万円/月`
          : "価格要相談";

      lines.push(`【物件${idx + 1}】${l.title || l.address || "注目物件"}`);
      lines.push(`💰 価格: ${priceStr}`);
      if (currentYield) {
        lines.push(`📈 想定利回り: ${currentYield}%`);
      }
      if (l.station) {
        lines.push(
          `🚉 交通: ${l.station}${l.walkMinutes !== undefined ? ` 徒歩${l.walkMinutes}分` : ""}`,
        );
      }
      if (area > 0) {
        lines.push(`📐 面積: ${area}㎡${l.layout ? ` (${l.layout})` : ""}`);
      }
      if (l.buildYear) {
        lines.push(
          `🏢 築年: ${l.buildYear}年築${l.structure ? ` / ${l.structure}` : ""}`,
        );
      }
      if (item.score !== undefined) {
        lines.push(`⭐ AI適合スコア: ${item.score}点 / 100点`);
      }
      // No source URLs in client messages — ever. Brokers keep the introduction
      // in their own hands, so the link is never included here.
      lines.push("");
    });

    lines.push(
      "━━━━━━━━━━━━━━━━",
      "ご興味のある物件や、内見のご希望・詳しい図面資料等ございましたら、このLINEにご返信いただければすぐにお手配いたします！",
      "",
      "どうぞよろしくお願い申し上げます。",
    );

    return lines.join("\n");
  }, [greeting, intro, listings]);

  if (!isOpen || listings.length === 0) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(lineText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-[#06c755] text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/20 backdrop-blur-xs text-white">
              <Smartphone className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-base font-black tracking-tight flex items-center gap-2">
                LINE提案文シミュレーター
                <span className="text-[13.5px] font-bold bg-white/25 px-2 py-0.5 rounded-full">
                  1-Tap Copy
                </span>
              </h2>
              <p className="text-xs text-emerald-100">
                スマートフォンでの実際の見え方を確認しながら、成約率の高いLINEメッセージを作成できます
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Left Customizer + Right iPhone Mockup */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50">
          {/* Left Column: Form Controls */}
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-3.5">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                提案文のカスタマイズ
              </h3>

              <div>
                <label className="text-[14px] font-bold text-slate-500 block mb-1">
                  宛先（お客様の呼び名）
                </label>
                <input
                  type="text"
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  placeholder="山田様"
                  className="w-full h-8 px-2.5 text-xs font-bold rounded-lg border border-slate-200 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="text-[14px] font-bold text-slate-500 block mb-1">
                  挨拶・導入メッセージ
                </label>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  rows={3}
                  className="w-full p-2.5 text-xs font-medium rounded-lg border border-slate-200 focus:outline-none focus:border-emerald-600 leading-relaxed resize-none"
                />
              </div>
            </div>

            {/* Included Properties Pill List */}
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
              <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>選択中の物件</span>
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[13.5px] font-black">
                  {listings.length} 件
                </Badge>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {listings.map((item, i) => (
                  <div
                    key={item.matchId}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-50 text-xs border border-slate-100"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-slate-800 truncate">
                        {i + 1}. {item.listing.title || item.listing.address}
                      </div>
                      <div className="text-[14px] text-emerald-700 font-extrabold">
                        {item.listing.price
                          ? `${item.listing.price.toLocaleString()}万円`
                          : "価格要相談"}
                      </div>
                    </div>
                    {item.score !== undefined && (
                      <Badge className="bg-white text-emerald-800 border-slate-200 text-[13.5px] shrink-0 font-black">
                        {item.score}点
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Copy Button */}
            <Button
              onClick={handleCopy}
              className="w-full h-11 bg-[#06c755] hover:bg-[#05b34c] text-white font-extrabold text-sm shadow-md"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-1.5" />
                  LINE用にコピーしました！
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-1.5" />
                  LINE用メッセージを全文コピー
                </>
              )}
            </Button>
          </div>

          {/* Right Column: Realistic iPhone Smartphone Frame */}
          <div className="flex justify-center items-start">
            <div className="w-[320px] rounded-[44px] bg-[#1e2022] p-3 shadow-2xl border-4 border-slate-800">
              {/* iPhone Outer Bezel */}
              <div className="w-full rounded-[34px] overflow-hidden bg-[#849ebf] flex flex-col h-[520px] relative">
                {/* Dynamic Island / Notch */}
                <div className="h-6 bg-[#202428] flex items-center justify-center relative">
                  <div className="w-20 h-3.5 bg-black rounded-full" />
                </div>

                {/* LINE Chat Header */}
                <div className="bg-[#202428] text-white px-3.5 py-2 flex items-center justify-between shadow-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white/70">◀</span>
                    <div className="w-6 h-6 rounded-full bg-emerald-500 text-white font-bold flex items-center justify-center text-[13.5px]">
                      {greeting.slice(0, 1)}
                    </div>
                    <span className="text-xs font-bold truncate max-w-[120px]">
                      {greeting}
                    </span>
                  </div>
                  <span className="text-xs text-white/70 font-mono">12:30</span>
                </div>

                {/* LINE Chat Scrollable Area */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans">
                  {/* Date Stamp */}
                  <div className="text-center">
                    <span className="inline-block bg-black/20 text-white text-[13.5px] font-bold px-2 py-0.5 rounded-full">
                      本日 12:30
                    </span>
                  </div>

                  {/* Speech Bubble (Agent Message) */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] bg-white rounded-2xl rounded-tr-xs p-3 text-[14px] text-slate-900 shadow-md whitespace-pre-wrap leading-relaxed font-normal">
                      {lineText}
                    </div>
                  </div>
                </div>

                {/* Simulated LINE Bottom Input Bar */}
                <div className="h-10 bg-white/95 border-t border-slate-200 px-3 flex items-center gap-2">
                  <span className="text-slate-400 text-xs font-bold">＋</span>
                  <div className="flex-1 h-6 bg-slate-100 rounded-full px-2.5 text-[13.5px] text-slate-400 flex items-center">
                    メッセージを入力
                  </div>
                  <span className="text-emerald-500 text-xs font-bold">▲</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-200 bg-white">
          <span className="text-xs text-slate-500 font-medium">
            コピーしたメッセージはPC版LINEやスマートフォン版LINEにそのままペーストできます。
          </span>

          <Button
            size="sm"
            onClick={onClose}
            className="bg-slate-900 hover:bg-slate-800 text-white"
          >
            閉じる
          </Button>
        </div>
      </div>
    </div>
  );
}
