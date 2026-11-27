import assert from "node:assert/strict";
import { jstDay, renderDigestHtml } from "./dailyDigest";
import { zephindLink } from "../services/alertNotifier";

// 2026-11-27 20:00 UTC is already 11/28 in JST.
assert.equal(jstDay(Date.UTC(2026, 10, 27, 20)), "2026/11/28");
assert.equal(jstDay(Date.UTC(2026, 10, 27, 14)), "2026/11/27");

assert.equal(zephindLink("https://app.example/", "l1", "o 1"), "https://app.example/orders/o%201?focusListing=l1");
assert.equal(zephindLink("https://app.example", "l1"), "https://app.example/orders?focusListing=l1");
assert.equal(zephindLink("https://app.example"), "https://app.example/orders");
assert.equal(zephindLink("", "l1", "o1"), "");

const html = renderDigestHtml(
  [{
    orderId: "o1",
    orderName: "杉並<script>",
    listings: [
      { id: "l1", title: "駅近 <b>", price: 39700, url: "https://suumo.jp/x", source: "suumo", score: 82 },
      { id: "l2", address: "杉並区", url: "javascript:alert(1)" },
    ],
  }],
  "2026/11/28",
  "https://app.example",
);
assert.ok(html.includes("杉並&lt;script&gt;"));
assert.ok(html.includes("駅近 &lt;b&gt;"));
assert.ok(html.includes("3億9,700万円"));
assert.ok(html.includes('href="https://app.example/orders/o1?focusListing=l1"'));
assert.ok(html.includes('href="https://suumo.jp/x"'));
assert.ok(!html.includes("javascript:"));
assert.ok(html.includes("1オーダー・2件"));
const junk = renderDigestHtml([{ orderId: "o", orderName: "x", listings: [{ id: "a", address: "多摩市", layout: "土地面積建物面積" }] }], "d", "");
assert.ok(!junk.includes("土地面積建物面積"));
assert.equal(junk.split("多摩市").length - 1, 1); // address not repeated when it is the title
console.log("ok");
