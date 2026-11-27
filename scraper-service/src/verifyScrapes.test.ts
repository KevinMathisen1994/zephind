import assert from "node:assert/strict";
import { normalize, priceForms } from "./verifyScrapes";

assert.deepEqual(priceForms(5980), ["5980万"]);
assert.deepEqual(priceForms(10600), ["10600万", "1億600万"]);
assert.deepEqual(priceForms(20000), ["20000万", "2億"]);
assert.equal(normalize("<td>価格 ５,９８０ 万円</td>"), "価格5980万円");
console.log("ok");
