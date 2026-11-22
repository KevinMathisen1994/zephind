import assert from "node:assert/strict";
import { parseToushiPage } from "./homesToushi";

// Card markup as served by toushi.homes.co.jp (trimmed).
const html = `<ul><li class="propertyList__item"><a class="propertyList__link" href="/bukkendetail/index/4852237/">
<p class="propertyList__heading"><span class="propertyList__icon u-icon-property">一棟売りアパート</span></p>
<img class="prg-propertyPhoto" src="/img/noimage.png">
<dd class="prg-propertyName">東武練馬 一棟アパート</dd>
<dd class="prg-price">1億600万円</dd><dd class="prg-yield"><span>5<span>.02</span></span>％</dd>
<dd class="prg-address">東京都練馬区北町</dd><dd class="prg-walk">東武東上線 東武練馬駅 歩6分</dd>
<ul><li class="prg-houseAge"> 築年月 1988年5月 </li><li class="prg-houseAreaText"> 建物面積 196.16㎡ </li>
<li class="prg-structure"> 建物構造 木造 </li><li class="prg-allNumber"> 総区画・戸数 6戸 </li></ul>
</a></li></ul>`;

const [l] = parseToushiPage(html, "一棟アパート");
assert.equal(l.price, 10600);
assert.equal(l.yield, 5.02);
assert.equal(l.ward, "練馬区");
assert.equal(l.walkMinutes, 6);
assert.equal(l.buildYear, 1988);
assert.equal(l.structureType, "木造");
assert.equal(l.floorArea, 196.16);
assert.equal(l.totalUnits, 6);
assert.equal(l.url, "https://toushi.homes.co.jp/bukkendetail/index/4852237/");
assert.equal(l.images, undefined);
console.log("homesToushi parser ok");
