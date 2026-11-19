import { useState, useMemo } from "react";
import {
  Calculator,
  Check,
  TrendingUp,
  DollarSign,
  Building,
  Percent,
  Sparkles,
  AlertCircle,
  Smartphone,
  Mail,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatMan } from "../lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export interface InvestorRoiSimulatorProps {
  listing: {
    _id?: string;
    title?: string;
    address?: string;
    price?: number; // in 万円
    rent?: number; // in 万円/月
    yield?: number; // in %
    grossYield?: number; // in %
    netYield?: number; // in %
    area?: number;
    landSize?: number;
    buildYear?: number | string;
    station?: string;
    walkMinutes?: number;
    structure?: string;
    layout?: string;
    specs?: Record<string, string>;
    managementFee?: number;
  };
  orderName?: string;
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * Monthly mortgage payment calculation using standard Japanese
 * amortization formula (元利均等返済).
 * @param principal Loan amount in yen
 * @param annualRatePercent Annual interest rate (e.g. 2.1)
 * @param years Loan duration in years (e.g. 30)
 */
export function calculateMonthlyPayment(
  principal: number,
  annualRatePercent: number,
  years: number,
): number {
  if (principal <= 0 || years <= 0) return 0;
  const n = years * 12;
  const r = annualRatePercent / 100 / 12;
  if (r <= 0) return Math.round(principal / n);
  const factor = Math.pow(1 + r, n);
  const monthly = (principal * (r * factor)) / (factor - 1);
  return Math.round(monthly);
}

export function InvestorRoiSimulator({
  listing,
  orderName,
  defaultExpanded = true,
  className = "",
}: InvestorRoiSimulatorProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Extract initial values from listing
  const initialPriceMan = useMemo(() => {
    if (listing.price && listing.price > 0) return listing.price;
    // If only rent and yield exist: Price = (Rent * 12) / (Yield / 100)
    const y = listing.yield || listing.grossYield;
    if (listing.rent && y && y > 0) {
      return Math.round((listing.rent * 12) / (y / 100));
    }
    return 3000; // 3,000万円 fallback
  }, [listing.price, listing.rent, listing.yield, listing.grossYield]);

  const initialGrossYield = useMemo(() => {
    if (listing.yield && listing.yield > 0) return listing.yield;
    if (listing.grossYield && listing.grossYield > 0) return listing.grossYield;
    if (listing.rent && initialPriceMan > 0) {
      return Math.round(((listing.rent * 12) / initialPriceMan) * 1000) / 10;
    }
    return 6.0; // 6.0% fallback
  }, [listing.yield, listing.grossYield, listing.rent, initialPriceMan]);

  const initialMonthlyRentYen = useMemo(() => {
    if (listing.rent && listing.rent > 0) {
      return Math.round(listing.rent * 10000);
    }
    if (initialPriceMan > 0 && initialGrossYield > 0) {
      return Math.round((initialPriceMan * 10000 * (initialGrossYield / 100)) / 12);
    }
    return 150000; // 15万円 fallback
  }, [listing.rent, initialPriceMan, initialGrossYield]);

  // Try parsing management fee / repair fund from specs if available
  const parsedSpecsExpenses = useMemo(() => {
    let mgmt = 0;
    let repair = 0;
    if (listing.managementFee) {
      mgmt = listing.managementFee;
    }
    if (listing.specs) {
      for (const [key, val] of Object.entries(listing.specs)) {
        const text = `${key} ${val}`;
        const mgmtMatch = text.match(/管理費[^\d]*([\d,]+)円?/);
        if (mgmtMatch && !mgmt) {
          mgmt = parseInt(mgmtMatch[1].replace(/,/g, ""), 10) || 0;
        }
        const repairMatch = text.match(/修繕積立金[^\d]*([\d,]+)円?/);
        if (repairMatch && !repair) {
          repair = parseInt(repairMatch[1].replace(/,/g, ""), 10) || 0;
        }
      }
    }
    return { mgmt, repair };
  }, [listing.specs, listing.managementFee]);

  // User-configurable parameters
  const [priceMan, setPriceMan] = useState<number>(initialPriceMan);
  const [downPaymentPct, setDownPaymentPct] = useState<number>(10); // 10% default
  const [interestRate, setInterestRate] = useState<number>(2.1); // 2.1% default investment loan
  const [loanYears, setLoanYears] = useState<number>(30); // 30 years default
  const [monthlyRentYen, setMonthlyRentYen] = useState<number>(initialMonthlyRentYen);
  const acquisitionCostPct = 6.0; // 諸費用 6%
  const [mgmtRepairYen, setMgmtRepairYen] = useState<number>(
    parsedSpecsExpenses.mgmt + parsedSpecsExpenses.repair || Math.round(initialMonthlyRentYen * 0.08)
  );
  const [agencyFeePct, setAgencyFeePct] = useState<number>(5.0); // 賃貸管理委託 5%
  const [vacancyBufferPct, setVacancyBufferPct] = useState<number>(5.0); // 空室想定 5%
  const [propertyTaxAnnualYen, setPropertyTaxAnnualYen] = useState<number>(120000); // 12万円/年 (1万円/月)

  const [copiedType, setCopiedType] = useState<"line" | "email" | null>(null);

  // Derived financial calculations
  const priceYen = priceMan * 10000;
  const downPaymentYen = Math.round(priceYen * (downPaymentPct / 100));
  const acquisitionCostYen = Math.round(priceYen * (acquisitionCostPct / 100));
  const totalEquityYen = downPaymentYen + acquisitionCostYen; // 自己資金総額
  const loanPrincipalYen = Math.max(0, priceYen - downPaymentYen);

  const monthlyMortgageYen = useMemo(() => {
    return calculateMonthlyPayment(loanPrincipalYen, interestRate, loanYears);
  }, [loanPrincipalYen, interestRate, loanYears]);

  const agencyFeeMonthlyYen = Math.round(monthlyRentYen * (agencyFeePct / 100));
  const vacancyBufferMonthlyYen = Math.round(monthlyRentYen * (vacancyBufferPct / 100));
  const propertyTaxMonthlyYen = Math.round(propertyTaxAnnualYen / 12);

  const totalMonthlyExpensesYen =
    mgmtRepairYen + agencyFeeMonthlyYen + vacancyBufferMonthlyYen + propertyTaxMonthlyYen;

  // Monthly Net Cash Flow (手残り月額CF)
  const monthlyNetCashFlowYen = monthlyRentYen - monthlyMortgageYen - totalMonthlyExpensesYen;
  const annualNetCashFlowYen = monthlyNetCashFlowYen * 12;

  // Key Investment Ratios
  const grossYieldPct = priceYen > 0 ? ((monthlyRentYen * 12) / priceYen) * 100 : 0;
  const totalInvestmentYen = priceYen + acquisitionCostYen;
  const annualNoiYen = monthlyRentYen * 12 - totalMonthlyExpensesYen * 12;
  const netYieldPct =
    totalInvestmentYen > 0 ? (annualNoiYen / totalInvestmentYen) * 100 : 0;
  const ccrPct = totalEquityYen > 0 ? (annualNetCashFlowYen / totalEquityYen) * 100 : 0;
  const yieldGapPct = grossYieldPct - interestRate;

  // Quick Preset Handlers
  const handlePresetDownPayment = (pct: number) => {
    setDownPaymentPct(pct);
  };

  const handlePresetYears = (years: number) => {
    setLoanYears(years);
  };

  const handlePresetRate = (rate: number) => {
    setInterestRate(rate);
  };

  // Generate LINE & Email Pitches
  const generatePitchText = (format: "line" | "email") => {
    const isLine = format === "line";
    const headerDecor = isLine ? "━━━━━━━━━━━━━━━━" : "========================================";
    const bullet = isLine ? "・" : "■ ";
    const star = isLine ? "★" : "◆";

    const titleStr = listing.title || listing.address || "都内注目収益物件";
    const locStr = [
      listing.station ? `${listing.station}${listing.walkMinutes !== undefined ? ` 徒歩${listing.walkMinutes}分` : ""}` : "",
      listing.buildYear ? `${listing.buildYear}年築` : "",
      listing.structure ? listing.structure : "",
    ].filter(Boolean).join(" / ");

    const cfSign = monthlyNetCashFlowYen >= 0 ? "+" : "";
    const cfText = `${cfSign}¥${Math.abs(monthlyNetCashFlowYen).toLocaleString()}/月`;
    const cfYearText = `${cfSign}¥${Math.abs(Math.round(annualNetCashFlowYen / 10000)).toLocaleString()}万円/年`;

    const lines = [
      isLine ? `【収支シミュレーション速報】` : `【収支試算レポート】${titleStr}のご提案`,
      "",
      `物件名: ${titleStr}`,
      orderName ? `合致条件: 【${orderName}】` : "",
      locStr ? `概要: ${locStr}` : "",
      `販売価格: ${formatMan(priceMan)}円`,
      `想定表面利回り: ${grossYieldPct.toFixed(2)}%（満室時月額: ¥${monthlyRentYen.toLocaleString()}）`,
      "",
      headerDecor,
      isLine ? "📊 資金計画 & 毎月の手残り収支（概算）" : "資金計画および月次収支シミュレーション",
      headerDecor,
      `${bullet}自己資金（頭金+諸費用）: 約${Math.round(totalEquityYen / 10000).toLocaleString()}万円`,
      `  （頭金${downPaymentPct}%: 約${Math.round(downPaymentYen / 10000)}万円 ＋ 諸費用約${Math.round(acquisitionCostYen / 10000)}万円）`,
      `${bullet}借入金額: 約${Math.round(loanPrincipalYen / 10000).toLocaleString()}万円`,
      `  （想定金利 ${interestRate.toFixed(1)}%、返済期間 ${loanYears}年 元利均等）`,
      "",
      `${bullet}家賃収入（満室想定）: ¥${monthlyRentYen.toLocaleString()}/月`,
      `${bullet}ローン返済額: ▲¥${monthlyMortgageYen.toLocaleString()}/月`,
      `${bullet}運営経費目安（管理・修繕・代行・税）: ▲¥${totalMonthlyExpensesYen.toLocaleString()}/月`,
      "",
      headerDecor,
      `${star} 毎月の手残りキャッシュフロー: ${cfText}`,
      `${star} 年間の純手残り額: ${cfYearText}`,
      `${star} 実質利回り (NOI): ${netYieldPct.toFixed(2)}%`,
      `${star} 自己資金回収率 (CCR): ${ccrPct.toFixed(1)}%`,
      `${star} イールドギャップ: +${yieldGapPct.toFixed(2)}%`,
      headerDecor,
      "",
      "詳細なレントロールや現地写真、銀行融資打診、資金計画書のご提供が可能です。",
      "内見や融資事前審査のご相談は、本メッセージへお気軽にご返信ください。",
    ].filter(Boolean);

    return lines.join("\n");
  };

  const copyToClipboard = (format: "line" | "email") => {
    const text = generatePitchText(format);
    navigator.clipboard.writeText(text);
    setCopiedType(format);
    setTimeout(() => setCopiedType(null), 3000);
  };

  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/50 shadow-sm transition-all ${className}`}
    >
      {/* Header bar / accordion toggle */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex cursor-pointer select-none items-center justify-between px-5 py-4 transition-colors hover:bg-slate-50/80 rounded-t-2xl"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-sm shadow-emerald-500/20">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-extrabold text-slate-900">
                収支・キャッシュフロー試算
              </h3>
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs font-black">
                Investor ROI
              </Badge>
              {monthlyNetCashFlowYen > 0 ? (
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                  <TrendingUp className="h-3 w-3" />
                  黒字CF見込み
                </span>
              ) : (
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200">
                  <AlertCircle className="h-3 w-3" />
                  条件調整推奨
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              自己資金・融資条件をリアルタイム調整し、毎月の純手残り額・実質利回りを算出
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Quick teaser KPI when collapsed */}
          <div className="text-right hidden sm:block">
            <div className="text-[11px] font-bold text-slate-400">毎月の純手残りCF</div>
            <div
              className={`text-sm font-black font-data ${
                monthlyNetCashFlowYen >= 0 ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {monthlyNetCashFlowYen >= 0 ? "+" : ""}¥
              {monthlyNetCashFlowYen.toLocaleString()}/月
            </div>
          </div>
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 px-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold shadow-2xs hover:bg-emerald-100 transition-colors"
            aria-label="Toggle details"
          >
            <span>{isExpanded ? "閉じる" : "試算を展開"}</span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t border-slate-100 px-5 pb-6 pt-5 space-y-6 animate-in fade-in duration-200">
          {/* Hero KPI Summary Dashboard */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Net Monthly CF */}
            <div
              className={`col-span-2 rounded-2xl p-4 border transition-all ${
                monthlyNetCashFlowYen >= 0
                  ? "bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-white border-emerald-200"
                  : "bg-gradient-to-br from-rose-500/10 via-amber-500/5 to-white border-rose-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                  毎月の手残りキャッシュフロー
                </span>
                <span
                  className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${
                    monthlyNetCashFlowYen >= 0
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-rose-100 text-rose-800"
                  }`}
                >
                  {monthlyNetCashFlowYen >= 0 ? "毎月黒字" : "元利返済過多"}
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span
                  className={`text-2xl sm:text-3xl font-black font-data tracking-tight ${
                    monthlyNetCashFlowYen >= 0 ? "text-emerald-700" : "text-rose-600"
                  }`}
                >
                  {monthlyNetCashFlowYen >= 0 ? "+" : ""}¥
                  {monthlyNetCashFlowYen.toLocaleString()}
                </span>
                <span className="text-xs font-bold text-slate-500">/月</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 flex items-center gap-2">
                <span>年間純手残り:</span>
                <strong
                  className={`font-data ${
                    annualNetCashFlowYen >= 0 ? "text-emerald-700" : "text-rose-600"
                  }`}
                >
                  {annualNetCashFlowYen >= 0 ? "+" : ""}¥
                  {Math.round(annualNetCashFlowYen).toLocaleString()}円
                </strong>
              </div>
            </div>

            {/* CCR (Cash on Cash Return) */}
            <div className="rounded-2xl p-4 border border-slate-200 bg-white shadow-2xs">
              <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5 text-blue-600" />
                自己資金回収率 (CCR)
              </span>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black text-slate-900 font-data">
                  {ccrPct.toFixed(1)}
                </span>
                <span className="text-xs font-bold text-slate-500">%</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                自己資金 約{Math.round(totalEquityYen / 10000)}万円に対比
              </div>
            </div>

            {/* Net Yield (NOI) */}
            <div className="rounded-2xl p-4 border border-slate-200 bg-white shadow-2xs">
              <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                <Percent className="h-3.5 w-3.5 text-teal-600" />
                実質利回り (NOI)
              </span>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black text-slate-900 font-data">
                  {netYieldPct.toFixed(2)}
                </span>
                <span className="text-xs font-bold text-slate-500">%</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                表面利回り {grossYieldPct.toFixed(1)}% (gap +{yieldGapPct.toFixed(1)}%)
              </div>
            </div>
          </div>

          {/* Cashflow Breakdown Progress Waterfall */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>想定満室賃料の配分内訳（月額 ¥{monthlyRentYen.toLocaleString()}）</span>
              <span className="text-slate-400">100%</span>
            </div>

            {/* Stacked bar */}
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100 p-0.5">
              {/* Mortgage payment */}
              <div
                className="bg-indigo-500 transition-all rounded-l-full"
                style={{
                  width: `${Math.min(100, Math.max(0, (monthlyMortgageYen / monthlyRentYen) * 100))}%`,
                }}
                title={`ローン返済: ¥${monthlyMortgageYen.toLocaleString()}`}
              />
              {/* Expenses */}
              <div
                className="bg-amber-400 transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, (totalMonthlyExpensesYen / monthlyRentYen) * 100))}%`,
                }}
                title={`経費・管理費: ¥${totalMonthlyExpensesYen.toLocaleString()}`}
              />
              {/* Net Cash flow */}
              {monthlyNetCashFlowYen > 0 && (
                <div
                  className="bg-emerald-500 transition-all rounded-r-full"
                  style={{
                    width: `${Math.min(100, (monthlyNetCashFlowYen / monthlyRentYen) * 100)}%`,
                  }}
                  title={`手残り利益: ¥${monthlyNetCashFlowYen.toLocaleString()}`}
                />
              )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
                <span>
                  ローン返済: <strong>¥{monthlyMortgageYen.toLocaleString()}</strong> (
                  {((monthlyMortgageYen / monthlyRentYen) * 100).toFixed(0)}%)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span>
                  運営経費: <strong>¥{totalMonthlyExpensesYen.toLocaleString()}</strong> (
                  {((totalMonthlyExpensesYen / monthlyRentYen) * 100).toFixed(0)}%)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span>
                  純手残りCF: <strong>¥{monthlyNetCashFlowYen.toLocaleString()}</strong> (
                  {((monthlyNetCashFlowYen / monthlyRentYen) * 100).toFixed(0)}%)
                </span>
              </div>
            </div>
          </div>

          {/* Interactive Controls & Financial Parameters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Left Column: Loan & Financing */}
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
              <h4 className="text-xs font-black tracking-wider text-slate-900 uppercase flex items-center gap-1.5">
                <Building className="h-3.5 w-3.5 text-indigo-600" />
                資金調達・融資条件の設定
              </h4>

              {/* Price input */}
              <div>
                <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                  <span>物件購入価格</span>
                  <span className="font-data text-indigo-700">
                    {formatMan(priceMan)}円 ({priceMan.toLocaleString()}万円)
                  </span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="50000"
                  step="100"
                  value={priceMan}
                  onChange={(e) => setPriceMan(Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              {/* Down payment */}
              <div>
                <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                  <span>頭金（自己資金）</span>
                  <span className="font-data text-slate-900">
                    {downPaymentPct}%（約{Math.round(downPaymentYen / 10000)}万円）
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  value={downPaymentPct}
                  onChange={(e) => setDownPaymentPct(Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
                <div className="flex gap-1.5 mt-1.5">
                  {[0, 10, 20, 30].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handlePresetDownPayment(pct)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors ${
                        downPaymentPct === pct
                          ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {pct === 0 ? "フルローン" : `頭金${pct}%`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Interest rate */}
              <div>
                <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                  <span>想定借入金利</span>
                  <span className="font-data text-indigo-700">{interestRate.toFixed(1)}%</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="4.5"
                  step="0.1"
                  value={interestRate}
                  onChange={(e) => setInterestRate(Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
                <div className="flex gap-1.5 mt-1.5">
                  {[1.5, 1.8, 2.1, 2.5, 3.0].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => handlePresetRate(rate)}
                      className={`px-2 py-1 rounded-md text-[11px] font-bold border transition-colors ${
                        interestRate === rate
                          ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {rate.toFixed(1)}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Loan Term */}
              <div>
                <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                  <span>返済年数</span>
                  <span className="font-data text-slate-900">{loanYears}年（{loanYears * 12}回）</span>
                </div>
                <div className="flex gap-1.5">
                  {[20, 25, 30, 35].map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => handlePresetYears(y)}
                      className={`flex-1 py-1.5 rounded-md text-xs font-bold border transition-colors ${
                        loanYears === y
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                          : "border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {y}年
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Operating Income & Expenses */}
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
              <h4 className="text-xs font-black tracking-wider text-slate-900 uppercase flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-teal-600" />
                賃料収入 & ランニングコスト
              </h4>

              {/* Monthly rent */}
              <div>
                <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                  <span>想定満室月額賃料</span>
                  <span className="font-data text-emerald-700 font-extrabold">
                    ¥{monthlyRentYen.toLocaleString()}/月（年額 ¥{((monthlyRentYen * 12) / 10000).toFixed(0)}万円）
                  </span>
                </div>
                <input
                  type="range"
                  min="50000"
                  max="2000000"
                  step="10000"
                  value={monthlyRentYen}
                  onChange={(e) => setMonthlyRentYen(Number(e.target.value))}
                  className="w-full accent-teal-600"
                />
              </div>

              {/* Management & Repair Reserve */}
              <div>
                <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                  <span>建物管理費・修繕積立金</span>
                  <span className="font-data text-slate-900">
                    ¥{mgmtRepairYen.toLocaleString()}/月
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="150000"
                  step="2000"
                  value={mgmtRepairYen}
                  onChange={(e) => setMgmtRepairYen(Number(e.target.value))}
                  className="w-full accent-teal-600"
                />
              </div>

              {/* Property Management Agency fee */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-[11px] font-bold text-slate-700 mb-1">
                    <span>集金代行手数料</span>
                    <span className="font-data text-slate-900">{agencyFeePct}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="1"
                    value={agencyFeePct}
                    onChange={(e) => setAgencyFeePct(Number(e.target.value))}
                    className="w-full accent-teal-600"
                  />
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    月額 ¥{agencyFeeMonthlyYen.toLocaleString()}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] font-bold text-slate-700 mb-1">
                    <span>空室リスク想定</span>
                    <span className="font-data text-slate-900">{vacancyBufferPct}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="15"
                    step="1"
                    value={vacancyBufferPct}
                    onChange={(e) => setVacancyBufferPct(Number(e.target.value))}
                    className="w-full accent-teal-600"
                  />
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    月額 ¥{vacancyBufferMonthlyYen.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Property Tax Estimate */}
              <div>
                <div className="flex justify-between text-[11px] font-bold text-slate-700 mb-1">
                  <span>固都税概算（年間）</span>
                  <span className="font-data text-slate-900">
                    ¥{propertyTaxAnnualYen.toLocaleString()}/年 (¥{propertyTaxMonthlyYen.toLocaleString()}/月)
                  </span>
                </div>
                <input
                  type="range"
                  min="30000"
                  max="500000"
                  step="10000"
                  value={propertyTaxAnnualYen}
                  onChange={(e) => setPropertyTaxAnnualYen(Number(e.target.value))}
                  className="w-full accent-teal-600"
                />
              </div>
            </div>
          </div>

          {/* Action Row: 1-Click Copy Pitch for LINE & Email */}
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50/80 via-teal-50/50 to-white p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-extrabold text-emerald-950 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-600" />
                  1-Click 投資家向け提案文コピー（LINE / メール）
                </h4>
                <p className="text-xs text-emerald-800 mt-0.5">
                  自己資金や手残りCFを盛り込んだ成約率の高いピッチ文をワンクリックで生成します
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  onClick={() => copyToClipboard("line")}
                  className="flex-1 sm:flex-none h-10 gap-2 rounded-xl bg-[#06c755] hover:bg-[#05b34c] text-white font-bold text-xs shadow-sm shadow-[#06c755]/20"
                >
                  {copiedType === "line" ? (
                    <>
                      <Check className="h-4 w-4" />
                      LINE文コピー完了！
                    </>
                  ) : (
                    <>
                      <Smartphone className="h-4 w-4" />
                      LINE提案文をコピー
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyToClipboard("email")}
                  className="flex-1 sm:flex-none h-10 gap-2 rounded-xl border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs shadow-xs"
                >
                  {copiedType === "email" ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-600" />
                      メール文コピー完了！
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4 text-slate-600" />
                      メール提案文をコピー
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
