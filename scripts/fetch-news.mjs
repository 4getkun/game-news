// scripts/fetch-news.mjs
//
// ゲームニュース自動収集スクリプト(姉妹サイト anime-news と同じ仕組み)。GitHub Actions から定期実行される。
//
//   1. src/data/feeds.json の全RSSを並列取得
//   2. 生データを data/archive.json に積み増し(直近 RETENTION_DAYS 日分のローリング保存)
//   3. アーカイブ全体に対して毎回フィルタをかけ直す(filters.json を変えると過去分にも効く)
//   4. 同一ニュースを統合して src/data/news.json に書き出す(サイトはこれを読む)
//
// 生データと表示用データを分けているのは、フィルタ条件を緩めた/厳しくしたときに
// 過去30日分をまるごと再判定できるようにするため。本文はコピーせず、見出し・
// 短い要約・RSSが配信しているサムネイルURL・リンクだけを保持する。

import Parser from "rss-parser";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  evaluateItem,
  dedupeItems,
  splitPublisherSuffix,
  extractWorks,
  isSyndicated,
  originalPublisherFromTitle,
} from "./lib/filter.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (p) => JSON.parse(await readFile(path.join(ROOT, p), "utf-8"));

const FEEDS = await readJson("src/data/feeds.json");
const FILTERS = await readJson("src/data/filters.json");

const ARCHIVE_PATH = path.join(ROOT, "data/archive.json");
const OUTPUT_PATH = path.join(ROOT, "src/data/news.json");

const RETENTION_DAYS = 30;
const MAX_OUTPUT_ITEMS = 6000;
const MAX_PER_FEED = 100;
const FETCH_TIMEOUT_MS = 30000;
const RETRY_COUNT = 1;
const SUMMARY_MAX = 140;

const KIND_RANK = { specialist: 0, general: 1, press: 2, aggregator: 3 };

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; GameNewsBot/1.0; +https://github.com/4getkun/game-news)",
  },
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail"],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** 要約から、プレスリリース特有の「[画像1: https://...]」や社名の角括弧、生URLを取り除く */
function cleanSummary(text) {
  return text
    // 要約の切り詰めで閉じ括弧が落ちたものも消す
    .replace(/\[画像\d*[:：][^\]]*(\]|$)/g, " ")
    .replace(/^\s*\[[^\]]{1,40}\]\s*/, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max).trim()}…`;
}

/** RSSが配信しているサムネイル画像のURLを拾う(ページのスクレイピングはしない) */
function pickImage(item) {
  const candidates = [];
  if (item.enclosure?.url && /image|\.(jpe?g|png|webp|gif)/i.test(`${item.enclosure.type ?? ""} ${item.enclosure.url}`)) {
    candidates.push(item.enclosure.url);
  }
  for (const m of item.mediaContent ?? []) {
    const url = m?.$?.url;
    if (url && (!m.$.medium || m.$.medium === "image")) candidates.push(url);
  }
  if (item.mediaThumbnail?.$?.url) candidates.push(item.mediaThumbnail.$.url);
  const html = `${item.contentEncoded ?? ""} ${item.content ?? ""}`;
  const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (img) candidates.push(img[1]);
  const url = candidates.find((u) => /^https:\/\//.test(u) && !/(feeds\.feedburner|pixel|spacer|1x1)/i.test(u));
  return url ?? null;
}

async function parseWithRetry(feed) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      return await parser.parseURL(feed.url);
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_COUNT) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

/** フィード1本を取得し、フィルタ前の生アイテム(アーカイブ形式)にして返す */
async function fetchFeedRaw(feed) {
  try {
    const parsed = await parseWithRetry(feed);
    const items = [];
    for (const item of (parsed.items ?? []).slice(0, MAX_PER_FEED)) {
      const rawTitle = stripHtml(item.title);
      const link = item.link ?? "";
      if (!rawTitle || !/^https?:\/\//.test(link)) continue;

      // Googleニュース経由は「見出し - 媒体名」形式。媒体名を出典として分離し、
      // 要約(=元記事へのリンクHTMLの羅列)は役に立たないので捨てる。
      let title = rawTitle;
      let publisher = null;
      let summary = truncate(cleanSummary(stripHtml(item.contentSnippet ?? item.summary ?? item.content ?? "")), SUMMARY_MAX);
      if (feed.kind === "aggregator") {
        ({ title, publisher } = splitPublisherSuffix(rawTitle));
        summary = "";
      }

      items.push({
        title,
        summary,
        link,
        pubDate: item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null),
        image: pickImage(item),
        feedId: feed.id,
        publisher,
      });
    }
    console.log(`  OK   ${feed.name}: ${items.length}件`);
    return { feed, items, ok: true };
  } catch (err) {
    console.warn(`  FAIL ${feed.name}: ${err.message}`);
    return { feed, items: [], ok: false, error: err.message };
  }
}

async function loadArchive() {
  try {
    const parsed = JSON.parse(await readFile(ARCHIVE_PATH, "utf-8"));
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

const linkKey = (link) => link.split("#")[0].replace(/[?&]source=rss$/, "");

async function main() {
  console.log(`ゲームニュース収集を開始 (${FEEDS.length}フィード)`);
  const results = await Promise.all(FEEDS.map(fetchFeedRaw));

  // ---- 2. 生データのアーカイブ(積み増し + ローリング削除) ----
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const archiveMap = new Map();
  for (const it of await loadArchive()) archiveMap.set(linkKey(it.link), it);
  let fresh = 0;
  for (const { items } of results) {
    for (const it of items) {
      const key = linkKey(it.link);
      if (!archiveMap.has(key)) fresh++;
      // 既存分は初回取得時の pubDate を保つ(フィードによっては更新のたびに日付が変わるため)
      const prev = archiveMap.get(key);
      archiveMap.set(key, prev ? { ...it, pubDate: prev.pubDate ?? it.pubDate } : it);
    }
  }
  const archive = [...archiveMap.values()].filter((it) => {
    const t = it.pubDate ? new Date(it.pubDate).getTime() : NaN;
    return Number.isNaN(t) || t >= cutoff;
  });
  await mkdir(path.dirname(ARCHIVE_PATH), { recursive: true });
  await writeFile(ARCHIVE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), items: archive }) + "\n");

  // ---- 3. フィルタ ----
  // 作品辞書: ゲーム専門媒体(日本語)の見出しから抽出した作品名。総合媒体の記事に
  // この作品名が出てくれば、「ゲーム」という語が無くても関連記事として拾える。
  const feedById = new Map(FEEDS.map((f) => [f.id, f]));
  const knownWorks = new Set();
  for (const it of archive) {
    const feed = feedById.get(it.feedId);
    if (feed?.kind === "specialist" && feed.lang === "ja") {
      for (const w of extractWorks(it.title, FILTERS, { lenient: true })) knownWorks.add(w);
    }
  }

  const stats = {};
  const accepted = [];
  for (const it of archive) {
    const feed = feedById.get(it.feedId);
    if (!feed) continue; // feeds.json から外したフィードの記事は表示しない
    const s = (stats[feed.id] ??= { name: feed.name, kind: feed.kind, total: 0, accepted: 0 });
    s.total++;
    it.summary = cleanSummary(it.summary ?? "");
    // 「画像・写真 | 見出し」のような、写真ページへのリンクに付く接頭辞を落とす
    it.title = it.title.replace(/^(画像・写真|写真|画像|動画)\s*[|｜]\s*/, "");
    const verdict = evaluateItem(it, feed, FILTERS, knownWorks);
    if (!verdict) continue;
    s.accepted++;
    const sourceName = it.publisher ?? feed.name;
    // 再配信: ポータル自身のフィード(Yahoo!ニュース等)か、Googleニュースが示す媒体名・URLがポータルのもの
    const syndicated = feed.syndicator === true || isSyndicated({ source: sourceName, link: it.link }, FILTERS);
    // 「見出し(オリコン)」形式なら元媒体名を「オリコン（Yahoo!ニュース エンタメ）」のように表示する
    const original = syndicated ? originalPublisherFromTitle(it.title) : null;
    const displayName = original ? `${original}（${sourceName}）` : sourceName;
    accepted.push({
      title: it.title,
      summary: it.summary,
      link: it.link,
      pubDate: it.pubDate,
      image: it.image ?? null,
      source: displayName,
      sourceId: feed.id,
      syndicated,
      kind: feed.kind,
      lang: feed.lang,
      score: verdict.score,
      categories: verdict.categories,
      platforms: verdict.platforms,
      works: verdict.works,
      spoiler: verdict.spoiler,
      sources: [
        { name: displayName, sourceId: feed.id, link: it.link, via: it.publisher ? feed.name : undefined, syndicated: syndicated || undefined },
      ],
    });
  }

  // ---- 4. 同一ニュース統合・並べ替え・書き出し ----
  const synd = FILTERS.syndication ?? {};
  const deduped = dedupeItems(accepted, (it) => KIND_RANK[it.kind] ?? 9, {
    syndicationWindowMs: (synd.windowHours ?? 72) * 3600_000,
    syndicationSimilarity: synd.similarity ?? 0.7,
  });
  const dd = dedupeItems.lastStats;
  deduped.sort((a, b) => (b.pubDate ? Date.parse(b.pubDate) : 0) - (a.pubDate ? Date.parse(a.pubDate) : 0));
  const output = deduped.slice(0, MAX_OUTPUT_ITEMS);

  const syndicatedTotal = accepted.filter((it) => it.syndicated).length;
  const syndicatedLeft = output.filter((it) => it.syndicated).length;
  const feedsStatus = results.map(({ feed, items, ok, error }) => ({
    id: feed.id,
    name: feed.name,
    kind: feed.kind,
    lang: feed.lang,
    ok,
    error: error ?? null,
    fetched: items.length,
    archived: stats[feed.id]?.total ?? 0,
    accepted: stats[feed.id]?.accepted ?? 0,
  }));

  await writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: output.length,
        dedupe: { ...dd, syndicatedTotal, syndicatedLeft },
        feeds: feedsStatus,
        items: output,
      },
      null,
      1,
    ) + "\n",
  );

  console.log(
    `完了: 表示 ${output.length}件 (アーカイブ ${archive.length}件 / 今回新規 ${fresh}件 / ` +
      `フィルタ通過 ${accepted.length}件 / 統合で ${accepted.length - deduped.length}件を集約` +
      ` [見出し一致 ${dd.exact} / 再配信 ${dd.syndicated} / 類似 ${dd.similar}] / 作品辞書 ${knownWorks.size}語)`,
  );
  for (const f of feedsStatus) {
    console.log(`    ${f.ok ? "  " : "✗ "}${f.name.padEnd(24)} ${String(f.accepted).padStart(4)} / ${f.archived}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
