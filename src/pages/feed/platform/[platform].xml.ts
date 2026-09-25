// 機種別の RSS(/feed/platform/switch2.xml など)。一覧は「しくみ」ページに載せている
import type { APIRoute, GetStaticPaths } from "astro";
import { jaNews, categories, platforms } from "../../../lib/news";
import { buildRss } from "../../../lib/rss";
import { withBase } from "../../../lib/url";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () =>
  platforms.map((p) => ({ params: { platform: p.id }, props: { id: p.id, label: p.label } }));

export const GET: APIRoute = ({ props, site }) => {
  const { id, label } = props as { id: string; label: string };
  const names = Object.fromEntries(categories.map((c) => [c.id, c.label]));
  return buildRss({
    title: `ゲームニュース全部（${label}）`,
    description: `ゲーム関連ニュースのうち「${label}」の新着`,
    siteUrl: new URL(withBase("/"), site).toString(),
    feedUrl: new URL(withBase(`/feed/platform/${id}.xml`), site).toString(),
    items: jaNews.filter((it) => (it.platforms ?? []).includes(id)),
    categoryLabel: (c) => names[c],
  });
};
