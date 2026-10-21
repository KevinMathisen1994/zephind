/**
 * Fixtures are real broker mail from the connected mailbox, reduced to the
 * parts that exercise a format and with names, phone numbers and addresses of
 * the senders removed — the property data is what is under test, not who sent
 * it. Every case here corresponds to a message the LLM path was being asked to
 * read.
 */
import {
  applyIngestRules,
  parseEmailListings,
  parsePriceMan,
  parseAreaSqm,
  parseBuildYear,
  parseAccess,
  parseRoadWidth,
} from "../scraper-service/src/lib/mailParse.js";

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL ${name}\n       expected ${e}\n       got      ${a}`);
  }
}

const FWD_HEADER = `---------- 転送メッセージ ---------
From: <broker@example.co.jp>
日付: 2026年8月17日(月) 11:22
件名: FW: 物件のご紹介
To: H <owner@example.com>

-----Original Message-----
From: 営業 <sales@example.co.jp>
Sent: Thursday, July 30, 2026 11:45 AM
Subject: 弊社販売物件のご紹介
`;

console.log("=== value parsers ===");
check("億+万 composed", parsePriceMan("6億9,800万円(税込)"), 69800);
check("億 with 全角 digits", parsePriceMan("4億１,800万円（税込）"), 41800);
check("decimal 億", parsePriceMan("3.9億円"), 39000);
check("plain 万円", parsePriceMan("34,000万円 （坪@361.66）"), 34000);
check("bare yen", parsePriceMan("37,000,000円"), 3700);
check("a phone number is not a price", parsePriceMan("TEL 03-6427-8340"), null);
check("㎡ wins over 坪", parseAreaSqm("206.12㎡（62.35坪）"), 206.12);
check("two 号棟 sum", parseAreaSqm("1号棟 378.00㎡（114.34坪）/ 2号棟 300.00㎡（90.75坪）"), 678);
check("western year", parseBuildYear("1990年3月築（平成2年）"), 1990);
check("昭和", parseBuildYear("昭和62年2月築"), 1987);
check("平成", parseBuildYear("平成19年12月"), 2007);
check("築N年", parseBuildYear("築25年", Date.parse("2026-01-01")), 2001);
check("closest station wins", parseAccess('大江戸線「豊島園」駅徒歩4分\n各線「練馬」駅徒歩7分'), {
  station: "豊島園駅",
  walkMinutes: 4,
});
check("station without 「」", parseAccess("JR中央線「武蔵小金井」駅 徒歩12分"), {
  station: "武蔵小金井駅",
  walkMinutes: 12,
});
check("widest frontage", parseRoadWidth("西側：約6.2ｍ、南側：約7.5ｍ"), 7.5);

console.log("=== whole emails ===");

// 1. One property, fully labelled, signature advertising the sender's own
//    buying criteria underneath it.
const labelled = parseEmailListings(`${FWD_HEADER}
本日決済いたしました、新規物件のご案内となります。

【物件概要】
物件名 ：セントヒルダスⅡ
住所  :東京都板橋区大山東町１９−３
地積 ：206.12㎡（62.35坪）
種別 ：共同住宅・店舗
築年 ：1990年3月築（平成2年）
構造 ：鉄筋コンクリート造陸屋根地下1階付3階建
延床面積：621.49㎡（188.00坪）
売買価格：6億9,800万円(税込)
満室想定利回り：5.35％
取引態様：売主代理

/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/
株式会社BASE
〒150-0043 東京都渋谷区道玄坂一丁目20番3号
`);
check("labelled: one listing, no LLM", [labelled.listings.length, labelled.needsLlm], [1, false]);
check("labelled: fields", labelled.listings[0], {
  title: "セントヒルダスⅡ",
  address: "東京都板橋区大山東町19-3",
  ward: "板橋区",
  price: 69800,
  area: 621.49,
  landSize: 206.12,
  station: null,
  walkMinutes: null,
  // 共同住宅 + RC frame, not the 渋谷区 店舗 in the signature below it
  propertyType: "一棟マンション",
  yield: 5.35,
  buildYear: 1990,
  structure: "鉄筋コンクリート造陸屋根地下1階付3階建",
  buildingCoverageRatio: null,
  floorAreaRatio: null,
  roadWidth: null,
  totalUnits: 13 === 0 ? 0 : null,
  description: null,
});

// 2. Two unrelated properties in one mail, each led by a bare bulleted address.
const two = parseEmailListings(`${FWD_HEADER}
弊社売主物件のご紹介になります。

・東京都練馬区練馬3-24-18
価格：34,000万円 （坪@361.66 一種120.55万）
大江戸線「豊島園」駅徒歩4分
各線「練馬」駅徒歩7分
土地：310.77㎡（94.01坪）
延床：554.04㎡（167.6坪）
鉄骨造陸屋根3階建 昭和62年2月築
13戸

・東京都国立市富士見台1-8-26
価格：3,700万円 満室想定利回り11.06％
南武線「谷保」駅徒歩5分
鉄骨造一部鉄筋コンクリート造地下1階付2階建

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
株式会社シアリード不動産
【弊社買取可能条件】
◆高利回り一棟収益/空ビル/空レジ/民泊物件/狭小店舗ビル用地/実需区分、戸建
◆買取価格〜10億円以内 5億円以下が得意です。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
`);
check("two: split into 2", two.listings.length, 2);
check("two: first", [two.listings[0].ward, two.listings[0].price, two.listings[0].walkMinutes, two.listings[0].totalUnits, two.listings[0].buildYear], ["練馬区", 34000, 4, 13, 1987]);
check("two: second", [two.listings[1].ward, two.listings[1].price, two.listings[1].yield, two.listings[1].station], ["国立市", 3700, 11.06, "谷保駅"]);
// The signature's "一棟収益" sits below the last property and used to be
// absorbed into it, typing a 店舗ビル as a 一棟マンション.
check("two: signature does not type the last listing", two.listings[1].propertyType, null);

// 3. Land, 全角 digits inside the price, and a 2026 date in the forwarded
//    header that must not be read as a build year.
const land = parseEmailListings(`${FWD_HEADER}
下目黒5丁目土地のご紹介です。解体後更地渡しです。

【物件概要】
・物件名 ：目黒区下目黒5丁目
・所在地 ：東京都目黒区下目黒5丁目3-12
・交通 ：JR山手線「目黒」駅 徒歩18分（目黒通り沿いバス多数）
・土地面積 ：125.15㎡（約37.85坪）
・価格 ：4億１,800万円（税込）
・用途地域 ：商業地域
・備考 ：建ぺい率80％／容積率400％、防火地域
`);
check("land: fields", [land.listings[0].propertyType, land.listings[0].price, land.listings[0].landSize, land.listings[0].walkMinutes], ["土地", 41800, 125.15, 18]);
check("land: header date is not a build year", land.listings[0].buildYear, null);
check("land: 建ぺい率/容積率 read out of a 備考 line", [land.listings[0].buildingCoverageRatio, land.listings[0].floorAreaRatio], [80, 400]);

// 4. One deal, two buildings — areas sum, 和暦 dates, prose-free ■ labels.
const twoBuildings = parseEmailListings(`${FWD_HEADER}
中央線『武蔵小金井駅』１２分のアパート２棟です。

▼ コガネイハルハウス1号棟・2号棟 物件概要
■所在地 ：東京都小金井市緑町5-13-42
■交通 ：JR中央線「武蔵小金井」駅 徒歩12分
■土地面積：883.49㎡（267.25坪）
■延床面積：1号棟 378.00㎡（114.34坪）/ 2号棟 300.00㎡（90.75坪）
■構造 ：軽量鉄骨造陸屋根2階建
■築年数 ：1号棟 平成19年12月 / 2号棟：平成20年3月
■建蔽率 ：60％
■容積率 ：200％
■価格 ：3.9億円（税込）
■利回り ：5.33％
`);
check("2 buildings: one listing", twoBuildings.listings.length, 1);
check("2 buildings: summed area, 和暦 year, type from body", [twoBuildings.listings[0].area, twoBuildings.listings[0].buildYear, twoBuildings.listings[0].propertyType, twoBuildings.listings[0].price], [678, 2007, "アパート", 39000]);

// 5. A 物件求: the broker is advertising what they want to BUY. Reads as
//    property-like on every content test and must still cost nothing.
const wanted = parseEmailListings(`${FWD_HEADER}
五反田支店では来期に向けての仕入を強化しております。
下記内容の物件をご紹介頂ければ幸いです。

１）「100㎡前後の容積率400％以上・道路幅員10M以上」の「ホテル用地」
３）「300㎡～1000㎡・容積率200%以上」の「マンション用地」
◆東京２３区・横浜・川崎エリアで収益アパート・マンション・ビル用地の買取りを致します！
`, ["城南エリア・都心部のホテル・戸建用地を買います 5億円以下"]);
check("buying request: nothing, and no LLM", [wanted.listings.length, wanted.needsLlm], [0, false]);

// 6. A cover note whose only data is in an attached マイソク. pdfToText shreds
//    that template's two-column layout, so rules cannot read it — this is the
//    case the LLM is kept for.
const coverNote = parseEmailListings(`${FWD_HEADER}
先程メールさせていただきました物件の販売図面を添付いたします。
なお、本物件につきましては、2.8億円台で買付を受領しております。
`, ["物件名\n所在地\n価格\n3億2,500万円\n東京都渋谷区道玄坂一丁目\n利回り\n6.51%"]);
check("cover note: escalates to LLM", [coverNote.listings.length, coverNote.needsLlm], [0, true]);

// 7. Ordinary mail. The LLM turned one of these into four "Premium deal —
//    Seoul" rows in the live listings table.
const newsletter = parseEmailListings(`件名: 🚨 Best-ever bonus on a top beginner card
差出人: Going <hello@marketing.going.com>

Premium deal - Seoul. Roundtrip from Tokyo, $420. Book by Friday.
`);
check("newsletter: nothing, and no LLM", [newsletter.listings.length, newsletter.needsLlm], [0, false]);

console.log("=== ingest rules ===");
const brokerMsg = {
  subject: "弊社販売物件のご紹介",
  from: "西村 <nishimura@baseltd.co.jp>",
  bodyText: "【物件概要】売買価格：6億9,800万円",
  attachments: [{ filename: "mysoku.pdf", mimeType: "application/pdf", size: 100 }],
};
const noiseMsg = {
  subject: "Best-ever bonus on a top beginner card",
  from: "Going <hello@marketing.going.com>",
  bodyText: "Premium deal - Seoul",
  attachments: [],
};

check("unconfigured accepts everything", applyIngestRules(noiseMsg, null).accepted, true);
check("empty lists accept everything", applyIngestRules(noiseMsg, { requiredKeywords: [], blockedSenders: [] }).accepted, true);
check("required word present", applyIngestRules(brokerMsg, { requiredKeywords: ["物件"] }).accepted, true);
check("required word absent", applyIngestRules(noiseMsg, { requiredKeywords: ["物件", "売買価格"] }), {
  accepted: false,
  reason: "必須ワードが含まれていません",
});
check("blocked word", applyIngestRules(noiseMsg, { blockedKeywords: ["Premium deal"] }), {
  accepted: false,
  reason: "除外ワード「Premium deal」を含みます",
});
check("sender domain allowlist admits", applyIngestRules(brokerMsg, { allowedSenders: ["@baseltd.co.jp"] }).accepted, true);
check("sender domain allowlist excludes", applyIngestRules(noiseMsg, { allowedSenders: ["@baseltd.co.jp"] }), {
  accepted: false,
  reason: "許可した送信者ではありません",
});
check("blocked sender", applyIngestRules(noiseMsg, { blockedSenders: ["going.com"] }), {
  accepted: false,
  reason: "除外する送信者「going.com」に一致",
});
// An explicitly blocked sender must report as blocked rather than as failing
// some other rule it also happens to fail.
check("most specific reason wins", applyIngestRules(noiseMsg, { blockedSenders: ["going.com"], requiredKeywords: ["物件"] }).reason, "除外する送信者「going.com」に一致");
check("attachment required, present", applyIngestRules(brokerMsg, { requireAttachment: true }).accepted, true);
check("attachment required, absent", applyIngestRules(noiseMsg, { requireAttachment: true }), {
  accepted: false,
  reason: "添付ファイルがありません",
});
// Sender matching is case-folded: mail headers do not agree on domain case.
check("sender match is case-insensitive", applyIngestRules({ ...brokerMsg, from: "X <SALES@BASELTD.CO.JP>" }, { allowedSenders: ["@baseltd.co.jp"] }).accepted, true);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
