// scripts/probe-feeds.mjs
//
// フィード候補の生存確認用。引数にURLを渡すとそのURLだけ、何も渡さないと
// src/data/feeds.json の全フィードを取得して、件数と最新記事の見出しを表示する。
// 新しいフィードを feeds.json に追加する前の下調べに使う。
import Parser from "rss-parser";
import { readFile } from "node:fs/promises";

const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; GameNewsBot/1.0; +https://github.com/4getkun/game-news)" },
});

const args = process.argv.slice(2);
const targets = args.length
  ? args.map((url) => ({ name: url, url }))
  : JSON.parse(await readFile(new URL("../src/data/feeds.json", import.meta.url), "utf-8"));

await Promise.all(
  targets.map(async (feed) => {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = parsed.items ?? [];
      const latest = items[0];
      console.log(`OK   ${feed.name} (${items.length}件) — ${latest?.title ?? ""} [${latest?.isoDate ?? latest?.pubDate ?? "日付なし"}]`);
    } catch (err) {
      console.log(`FAIL ${feed.name} — ${err.message}`);
    }
  }),
);
