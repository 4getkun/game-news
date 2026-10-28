// All articles(Japanese)の RSS。見たくないTopics(sensitive)も含めてそのまま出す(RSSリーダー側で選んでもらう)
import type { APIRoute } from "astro";
import { jaNews, categories } from "../lib/news";
import { buildRss } from "../lib/rss";
import { withBase } from "../lib/url";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const label = Object.fromEntries(categories.map((c) => [c.id, c.label]));
  return buildRss({
    title: "All Game News",
    description: "Latest gaming news, with duplicate and republished coverage grouped together (Japanese articles)",
    siteUrl: new URL(withBase("/"), site).toString(),
    feedUrl: new URL(withBase("/feed.xml"), site).toString(),
    items: jaNews,
    categoryLabel: (id) => label[id],
  });
};

