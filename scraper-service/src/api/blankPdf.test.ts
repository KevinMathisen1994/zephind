import assert from "node:assert/strict";
import { parseDetection, parseImage } from "./blankPdf";

const r = parseDetection(
  {
    companyTexts: ["株式会社 湊", "TE", 42],
    boxes: [
      { page: 0, label: "会社名", box_2d: [850, 0, 1000, 500] },
      { page: 3, label: "bad page", box_2d: [0, 0, 100, 100] },
      { page: 0, label: "page-sized", box_2d: [0, 0, 1000, 1000] },
      { page: 0, label: "inverted", box_2d: [500, 500, 400, 400] },
      { page: 0, box_2d: ["x", 0, 1, 1] },
    ],
  },
  [0],
);
assert.deepEqual(r.companyTexts, ["株式会社 湊"]);
assert.deepEqual(r.boxes, [{ pageIndex: 0, label: "会社名", bbox: { x: 0, y: 0.85, width: 0.5, height: 0.15000000000000002 } }]);
assert.deepEqual(parseDetection(null, [0]), { companyTexts: [], boxes: [] });
const img = { name: " logo.png ", src: "data:image/png;base64,iVBORw0KGgo=", w: 10, h: 5 };
assert.deepEqual(parseImage(img), { ...img, name: "logo.png" });
assert.throws(() => parseImage({ ...img, src: "data:image/svg+xml;base64,PHN2Zz4=" }));
assert.throws(() => parseImage({ ...img, src: "javascript:alert(1)" }));
assert.throws(() => parseImage({ ...img, w: 0 }));
assert.throws(() => parseImage({ ...img, name: "" }));
console.log("ok");
