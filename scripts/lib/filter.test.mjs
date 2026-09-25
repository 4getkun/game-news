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
  assert.ok(!has("Steamで『X』が75%オフのセール", "sale")); // セールは classifyDeal で付ける(下のテスト)
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

test("予定の抽出(ゲーム): 発売日・配信日を拾い、締め切りや過去は拾わない", async () => {
  const { extractSchedules } = await import("./filter.mjs");
  const pub = "2026-09-25T03:00:00Z";
  const ex = (t) => extractSchedules(t, pub, config).map((e) => `${e.date}:${e.verb}`);
  assert.deepEqual(ex("『A列車で行こう9 PRIME LINE』Steamで12月10日配信"), ["2026-12-10:launch"]);
  assert.deepEqual(ex("『X』2027年2月19日発売決定"), ["2027-02-19:release"]);
  assert.deepEqual(ex("『X』Switch 2版が本日発売"), ["2026-09-25:release"]);
  assert.deepEqual(ex("『X』体験版を10月1日より配信"), ["2026-10-01:launch"]);
  assert.deepEqual(ex("『X』9月30日まで50%オフ"), []);
  assert.deepEqual(ex("『X』10月1日にPV公開"), []);
  assert.deepEqual(ex("『X』8月1日に発売された新作が累計100万本"), []);
});

test("予定の抽出: 中止・延期は拾わない", async () => {
  const { extractSchedules } = await import("./filter.mjs");
  assert.deepEqual(extractSchedules("東京ゲームショウ2026、5日目（9月21日）の開催中止が発表", "2026-09-20T03:00:00Z", config), []);
  assert.deepEqual(extractSchedules("『X』12月10日発売延期", "2026-09-20T03:00:00Z", config), []);
});

test("セール記事の判定: Steam のセールは拾い、マンガの還元やハードの値引きは拾わない", async () => {
  const { classifyDeal } = await import("./filter.mjs");
  const deal = (t, s = "") => classifyDeal(t, s, config);
  const p3 = deal("【過去最安値】『ペルソナ3 リロード』が“70％オフ”の「7678円→2303円」で購入できるお得なセール開催中。Steamにて10月8日まで");
  assert.deepEqual(p3, { stores: ["steam"], off: 70, free: false });
  assert.equal(deal("【無料】『Astrea』がEpic Gamesストアにて無料配布中").free, true);
  assert.deepEqual(deal("【無料】『Astrea』がEpic Gamesストアにて無料配布中").stores, ["epic"]);
  assert.ok(deal("PS4版「ゲーム発展国++」など全14タイトルがお得に。PlayStation Storeでカイロソフト作品のセールが開催中"));
  assert.equal(deal("【50%還元】マンガ『X』Kindle版が全巻50%ポイント還元セール中"), null);
  assert.equal(deal("Woot's New Sale Includes the Best Switch 2 Console Deal of the Year"), null);
  assert.equal(deal("Hideo Kojima responds to accusations of Physint being over budget"), null);
  assert.equal(deal("『X』大型アップデート配信"), null);
});

test("セール記事の判定: 「690円で」を無料配布と取り違えない", async () => {
  const { classifyDeal } = await import("./filter.mjs");
  const d = classifyDeal("Switch 2版「夜勤事件」が本日配信開始。発売を記念して30％オフの690円で販売中", "", config);
  assert.deepEqual(d, { stores: [], off: 30, free: false });
  assert.equal(classifyDeal("【4,500円→0円】『High On Life』がAmazonプライム会員向けに無料配布", "", config).free, true);
});

test("ゲーム専門媒体のアニメ・音楽の記事は除外し、ゲーム原作のアニメ化やゲームのイベントは残す", async () => {
  const { isOffTopic } = await import("./filter.mjs");
  const off = (t) => isOffTopic(t, "", config);
  assert.equal(off("TVアニメ『ラブライブ！』のオーケストラコンサートが2027年1月10日・11日に開催決定！"), true);
  assert.equal(off("マンガ『封神演義』初の大型原画展が2027年春に開催決定！"), true);
  assert.equal(off("『劇場版 魔法少女まどか☆マギカ〈ワルプルギスの廻天〉』興行収入“21億円”を突破！"), true);
  assert.equal(off("TVアニメ「SEKIRO: NO DEFEAT」，2027年1月より放送決定"), false);
  assert.equal(off("『ゼルダの伝説』40周年コンサートのチケット最速先行が本日スタート"), false);
  assert.equal(off("『Roco Kingdom』発表会に大人気声優のKENNさん、相羽あいなさんが登壇！"), false);
  const denfami = { id: "denfaminico", kind: "specialist", lang: "ja" };
  assert.equal(evaluateItem({ title: "TVアニメ『ラブライブ！』のオーケストラコンサートが開催決定", summary: "" }, denfami, config, new Set([workKey("ラブライブ!", config)])), null);
});

test("ちいかわ: アニメ・グッズの記事は除外、ゲーム化・ゲームの記事は残す", async () => {
  const { isOffTopic } = await import("./filter.mjs");
  const off = (t) => isOffTopic(t, "", config);
  assert.equal(off("アニメ『ちいかわ』の新作が一時休止、10月2日からは人気シリーズ回をリバイバル放送へ"), true);
  assert.equal(off("「ちいかわ くりまんじゅうだらけくじ」が大人気！BIGぬいぐるみ、マスコットも"), true);
  assert.equal(off("「ボンボンドロップシール」ちいかわの新作が発売！"), true);
  assert.equal(off("『ちいかわ』がゲーム化！Nintendo Switchで2027年発売"), false);
  assert.equal(off("【ちいぽけ】1.5周年を記念してABEMAでアニメ『ちいかわ』全362話を無料一挙放送"), false);
  // ゲームのタイトルのグッズは残す
  assert.equal(off("オンライン人狼アクション『Among Us』がカラフルな“めじるしアクセサリー”に！"), false);
  assert.equal(off("『牧場物語』歴代シリーズの「ウシ」にだけ注目しためじるしアクセサリーがユニーク！"), false);
});
