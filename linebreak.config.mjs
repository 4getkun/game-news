// このサイトの日本語改行(scripts/linebreak)の設定。scripts/linebreak/ は github.com/4getkun/ja-linebreak の
// コピーで、更新は
//   npx -y --allow-git=all github:4getkun/ja-linebreak --vendor scripts/linebreak
//
// ビルド後の HTML に BudouX の文節区切りを入れるので、効くのはサーバー側で描いた文章だけ。
// トップの記事一覧はブラウザで描き直すので対象外(処理すると描き直しの前後で行がずれる)。
// 1文字ずつ出すメッセージウィンドウ・縦書きの本棚・テロップ・ナビ・札の類も触らない。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULTS } from "./scripts/linebreak/core.mjs";

export default function config(dist) {
  // 作品名(タイトル名)は BudouX が途中で切ることがあるので、集めた記事の作品名を渡す
  const names = new Set();
  try {
    const data = JSON.parse(readFileSync(join(dist, "data", "news.json"), "utf-8"));
    for (const it of data.items ?? []) for (const w of it.w ?? []) if (w.length >= 2 && w.length <= 24) names.add(w);
  } catch {
    /* データが無くても動く */
  }
  return {
    // 見出し・リード・記事の見出し・予定の見出し: 行の長さをそろえる
    selectors: ["h1", "h2", "h3", "h4", "summary", ".hero-lede", ".item-title", ".cal-title", ".work-meta"],
    // 本文: しくみページの段落・箇条書きと、記事の要約
    text: [".prose p", ".prose li", ".prose dd", ".item-summary"],
    names: [...names],
    units: [...DEFAULTS.units, "話", "期", "巻", "章", "部", "作", "媒体", "周年", "か月", "ヶ月", "種"],
    optOut: [
      DEFAULTS.optOut,
      // ブラウザで描き直す・1文字ずつ出す・縦書き・横に流れる・狭い札の部分
      "#feed-list", "#work-banner", "#bouken", ".msg", ".ticker", ".hero-works", ".hero-title",
      ".site-header", ".toolbar", ".panel", ".item-tags", ".item-meta", ".feed-more", "nav", ".status", ".works-win",
    ].join(", "),
  };
}
