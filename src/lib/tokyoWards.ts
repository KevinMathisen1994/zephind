export const TOKYO_WARDS = [
  { label: "千代田区", code: "13101" },
  { label: "中央区", code: "13102" },
  { label: "港区", code: "13103" },
  { label: "新宿区", code: "13104" },
  { label: "文京区", code: "13105" },
  { label: "台東区", code: "13106" },
  { label: "墨田区", code: "13107" },
  { label: "江東区", code: "13108" },
  { label: "品川区", code: "13109" },
  { label: "目黒区", code: "13110" },
  { label: "大田区", code: "13111" },
  { label: "世田谷区", code: "13112" },
  { label: "渋谷区", code: "13113" },
  { label: "中野区", code: "13114" },
  { label: "杉並区", code: "13115" },
  { label: "豊島区", code: "13116" },
  { label: "北区", code: "13117" },
  { label: "荒川区", code: "13118" },
  { label: "板橋区", code: "13119" },
  { label: "練馬区", code: "13120" },
  { label: "足立区", code: "13121" },
  { label: "葛飾区", code: "13122" },
  { label: "江戸川区", code: "13123" },
];

export const TOKYO_CITIES = [
  // 市部 (Cities)
  { label: "八王子市", code: "13201" },
  { label: "立川市", code: "13202" },
  { label: "武蔵野市", code: "13203" },
  { label: "三鷹市", code: "13204" },
  { label: "青梅市", code: "13205" },
  { label: "府中市", code: "13206" },
  { label: "昭島市", code: "13207" },
  { label: "調布市", code: "13208" },
  { label: "町田市", code: "13209" },
  { label: "小金井市", code: "13210" },
  { label: "小平市", code: "13211" },
  { label: "日野市", code: "13212" },
  { label: "東村山市", code: "13213" },
  { label: "国分寺市", code: "13214" },
  { label: "国立市", code: "13215" },
  { label: "福生市", code: "13218" },
  { label: "狛江市", code: "13219" },
  { label: "東大和市", code: "13220" },
  { label: "清瀬市", code: "13221" },
  { label: "東久留米市", code: "13222" },
  { label: "武蔵村山市", code: "13223" },
  { label: "多摩市", code: "13224" },
  { label: "稲城市", code: "13225" },
  { label: "羽村市", code: "13227" },
  { label: "あきる野市", code: "13228" },
  { label: "西東京市", code: "13229" },
  // 西多摩郡
  { label: "檜原村", code: "13307" },
  { label: "奥多摩町", code: "13308" },
  // 大島支庁
  { label: "大島町", code: "13361" },
  { label: "利島村", code: "13362" },
  { label: "新島村", code: "13363" },
  { label: "神津島村", code: "13364" },
  // 三宅支庁
  { label: "三宅村", code: "13381" },
  { label: "御蔵島村", code: "13382" },
  // 八丈支庁
  { label: "八丈町", code: "13401" },
  { label: "青ヶ島村", code: "13402" },
  // 小笠原支庁
  { label: "小笠原村", code: "13421" },
];

export const TOKYO_AREAS = [...TOKYO_WARDS, ...TOKYO_CITIES];

const AREA_LABEL_TO_CODE: Record<string, string> = {};
for (const a of TOKYO_AREAS) {
  AREA_LABEL_TO_CODE[a.label] = a.code;
}

const WARD_LABEL_TO_CODE: Record<string, string> = {};
for (const w of TOKYO_WARDS) {
  WARD_LABEL_TO_CODE[w.label] = w.code;
}

export function wardLabelToCode(label: string): string | undefined {
  return WARD_LABEL_TO_CODE[label] || AREA_LABEL_TO_CODE[label];
}

export function areaLabelToCode(label: string): string | undefined {
  return AREA_LABEL_TO_CODE[label];
}

export function wardCodeToLabel(code: string): string | undefined {
  return TOKYO_AREAS.find((a) => a.code === code)?.label;
}

export function areaCodeToLabel(code: string): string | undefined {
  return TOKYO_AREAS.find((a) => a.code === code)?.label;
}