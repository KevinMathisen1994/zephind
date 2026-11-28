import assert from "node:assert/strict";
import { decodeBytes, extractGmailBody, htmlToText } from "./mailBody";

const b64 = (bytes: Buffer) => bytes.toString("base64url");

// HTML-only message: the case that left 92 stored bodies empty.
const htmlOnly = extractGmailBody({
  mimeType: "multipart/alternative",
  parts: [{
    mimeType: "text/html",
    headers: [{ name: "Content-Type", value: 'text/html; charset="UTF-8"' }],
    body: { data: b64(Buffer.from("<div>お世話になっております。</div><div>物件のご紹介です。<br>価格&nbsp;1億円</div>")) },
  }],
});
assert.equal(htmlOnly.bodyText, "お世話になっております。\n物件のご紹介です。\n価格 1億円");
assert.ok(htmlOnly.bodyHtml.includes("<div>"));

// ISO-2022-JP plain text, common in Japanese business mail: "物件" encoded as JIS.
const jis = Buffer.from([0x1b, 0x24, 0x42, 0x4a, 0x2a, 0x37, 0x6f, 0x1b, 0x28, 0x42]);
const plain = extractGmailBody({
  mimeType: "text/plain",
  headers: [{ name: "Content-Type", value: "text/plain; charset=ISO-2022-JP" }],
  body: { data: b64(jis) },
});
assert.equal(plain.bodyText, "物件");

// Attachment parts are not body text, even when text/plain.
const withAttachment = extractGmailBody({
  mimeType: "multipart/mixed",
  parts: [
    { mimeType: "text/plain", body: { data: b64(Buffer.from("本文")) } },
    { mimeType: "text/plain", filename: "memo.txt", body: { data: b64(Buffer.from("添付")) } },
  ],
});
assert.equal(withAttachment.bodyText, "本文");

// Labelled iso-2022-jp but the bytes are UTF-8: the real failure that showed every character as U+FFFD.
assert.equal(decodeBytes(Buffer.from("歌舞伎町 215坪"), "iso-2022-jp"), "歌舞伎町 215坪");
// Shift_JIS under the cp932 label, which TextDecoder doesn't know: "物件" = 95 A8 8C 8F.
assert.equal(decodeBytes(Buffer.from([0x95, 0xa8, 0x8c, 0x8f]), "cp932"), "物件");

assert.equal(htmlToText("<style>p{}</style><p>a</p><p>b &amp; c &#x7269;</p>"), "a\nb & c 物");
console.log("mailBody.test ok");
