// node --test "scripts/**/*.test.mjs" で実行される、収集時フィルタの単体テスト(ゲーム版)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  containsKeyword,
  evaluateItem,
  extractWorks,
  splitPublisherSuffix,
  dedupeItems,
  isSpoiler,
  isSyndicated,
  classifyCategories,
  classifyPlatforms,
  workKey,
} from "./filter.mjs";

const config = JSON.parse(readFileSync(new URL("../../src/data/filters.json", import.meta.url), "utf-8"));
const specialist = { id: "s", kind: "specialist", lang: "ja" };
const general = { id: "g", kind: "general", lang: "ja" };
const aggregator = { id: "a", kind: "aggregator", lang: "ja" };

test("英単語キーワードは単語境界で判定する", () => {
  assert.equal(containsKeyword("New game announced", "game"), true);
  assert.equal(containsKeyword("MLB Gameday", "game"), false);
  assert.equal(containsKeyword("ＰＳ５版が発売", "PS5"), true);
});

test("広告・パチンコ/パチスロはどのフィードでも除外", () => {
  assert.equal(evaluateItem({ title: "【PR】新作RPGが事前登録開始", summary: "" }, specialist, config), null);
  assert.equal(evaluateItem({ title: "パチスロ新台『X』導入開始", summary: "" }, specialist, config), null);
});

test("スポーツの「ゲーム」は拾わない", () => {
  assert.equal(evaluateItem({ title: "MLB Gameday: Guardians 1, Red Sox 0 Final Score", summary: "" }, aggregator, config), null);
  assert.equal(evaluateItem({ title: "首位と2ゲーム差に迫る", summary: "" }, general, config), null);
  assert.ok(evaluateItem({ title: "Switch 2向け新作ゲーム『X』発売日決定", summary: "" }, general, config));
});

test("作品辞書に載っている作品名は、ゲーム用語が無くても加点される", () => {
  const item = { title: "『ペルソナ4 リバイバル』公式グッズの通販スタート", summary: "" };
  assert.equal(evaluateItem(item, aggregator, config), null);
  // 作品辞書は workKey で持つ。表記が少し違っても(空白の有無など)当たる
  assert.ok(evaluateItem(item, aggregator, config, new Set([workKey("ペルソナ4リバイバル", config)])));
});

test("機種の判定: Switch 2 だけの記事に Switch を付けない", () => {
  assert.deepEqual(classifyPlatforms("『X』Nintendo Switch 2で発売", "", config), ["switch2"]);
  assert.deepEqual(classifyPlatforms("『X』Switch 2 / Switch / PS5 / Steamで配信", "", config).sort(), ["pc", "ps5", "switch", "switch2"]);
  assert.deepEqual(classifyPlatforms("スマホ向けRPG『X』iOS/Androidで事前登録", "", config), ["mobile"]);
});

test("カテゴリ: 発売・セール・アップデート", () => {
  const has = (t, id) => classifyCategories(t, "", config).includes(id);
  assert.ok(has("『X』発売日が12月10日に決定", "release"));
  assert.ok(has("Steamで『X』が75%オフのセール", "sale"));
  assert.ok(has("『X』大型アップデート配信、新DLCも", "update"));
  assert.ok(!has("『X』開発者インタビュー", "new")); // 「発表」だけでは新作にしない
});

test("見たくない話題: 見出しだけで判定し、作品名は無視", () => {
  const has = (t, id) => classifyCategories(t, "", config).includes(id);
  assert.ok(has("『フォートナイト』が集団訴訟を突きつけられる", "trouble"));
  assert.ok(has("人気タイトル『X』サービス終了を発表", "trouble"));
  assert.ok(!has("『デスゲームで逮捕されたら』体験版配信", "trouble")); // 作品名の中は見ない
});

test("作品名の抽出と Googleニュースの媒体名分離", () => {
  assert.deepEqual(extractWorks("Switch 2版『ゼルダの伝説』新PV公開", config), ["ゼルダの伝説"]);
  assert.deepEqual(splitPublisherSuffix("『X』発売 - ファミ通.com"), { title: "『X』発売", publisher: "ファミ通.com" });
  assert.equal(isSyndicated({ source: "Yahoo!ニュース", link: "https://news.google.com/x" }, config), true);
  assert.equal(isSpoiler("『X』エンディング解説", config), true);
});

test("同じ発表はまとめ、同じ作品の別の話題はまとめない", () => {
  const mk = (title, link, pubDate) => ({
    title, link, pubDate, summary: "", image: null, categories: [], platforms: [], spoiler: false, score: 0, lang: "ja",
    works: ["X"], sources: [{ name: link, sourceId: "x", link }],
  });
  const out = dedupeItems([
    mk("『X』の発売日が12月10日に決定、予約受付を開始", "https://a/1", "2026-09-24T10:00:00Z"),
    mk("『X』発売日が12月10日に決定。予約受付も開始", "https://b/1", "2026-09-24T11:00:00Z"),
    mk("『X』開発者インタビュー 戦闘システムのこだわり", "https://c/1", "2026-09-24T11:30:00Z"),
  ]);
  assert.equal(out.length, 2);
});

test("「」のキャラ名はタイトル扱いしない(『』だけ)", () => {
  assert.deepEqual(
    extractWorks("『ドラクエモンスターズ4』新キャラ「オルミラ」の情報が公開", config, { lenient: true }),
    ["ドラクエモンスターズ4"],
  );
});

test("同じタイトルの表記ゆれは同じキー・同じ表示名になる", async () => {
  const { buildWorkDisplayMap } = await import("./filter.mjs");
  const ff = ["FFX/X-2 HD Remaster", "FINAL FANTASY X/X-2 HD Remaster", "FF X/X-2 HD Remaster", "ファイナルファンタジーX/X-2 HDリマスター"];
  assert.equal(new Set(ff.map((w) => workKey(w, config))).size, 1);
  assert.equal(workKey("ファイナルファンタジーVII リベレーション", config), workKey("FF7 リベレーション", config));
  assert.equal(workKey("信長の野望･飛翔", config), workKey("信長の野望・飛翔", config));
  // 別の作品は別のキー
  assert.notEqual(workKey("FFX-2", config), workKey("FF10", config));
  assert.notEqual(workKey("FF14", config), workKey("FF7", config));
  const map = buildWorkDisplayMap([...ff, "FFX/X-2 HD Remaster"], config);
  assert.equal(map.get("FINAL FANTASY X/X-2 HD Remaster"), "FFX/X-2 HD Remaster"); // 一番多い表記
});
