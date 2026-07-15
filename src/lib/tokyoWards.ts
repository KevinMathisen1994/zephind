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

const WARD_LABEL_TO_CODE: Record<string, string> = {};
for (const w of TOKYO_WARDS) {
  WARD_LABEL_TO_CODE[w.label] = w.code;
}

export function wardLabelToCode(label: string): string | undefined {
  return WARD_LABEL_TO_CODE[label];
}

export function wardCodeToLabel(code: string): string | undefined {
  return TOKYO_WARDS.find((w) => w.code === code)?.label;
}