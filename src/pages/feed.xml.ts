// 全記事(日本語)の RSS。見たくない話題(sensitive)も含めてそのまま出す(RSSリーダー側で選んでもらう)
import type { APIRoute } from "astro";
import { jaNews, categories } from "../lib/news";
import { buildRss } from "../lib/rss";
import { withBase } from "../lib/url";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const label = Object.fromEntries(categories.map((c) => [c.id, c.label]));
  return buildRss({
    title: "ゲームニュース全部",
    description: "ゲーム関連ニュースの新着(転載・重複をまとめたもの)",
    siteUrl: new URL(withBase("/"), site).toString(),
    feedUrl: new URL(withBase("/feed.xml"), site).toString(),
    items: jaNews,
    categoryLabel: (id) => label[id],
  });
};
