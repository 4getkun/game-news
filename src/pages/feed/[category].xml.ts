// カテゴリ別の RSS(/feed/new.xml など)。一覧は「しくみ」ページに載せている
import type { APIRoute, GetStaticPaths } from "astro";
import { jaNews, categories } from "../../lib/news";
import { buildRss } from "../../lib/rss";
import { withBase } from "../../lib/url";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () =>
  categories.map((c) => ({ params: { category: c.id }, props: { id: c.id, label: c.label } }));

export const GET: APIRoute = ({ props, site }) => {
  const { id, label } = props as { id: string; label: string };
  const names = Object.fromEntries(categories.map((c) => [c.id, c.label]));
  return buildRss({
    title: `ゲームニュース全部（${label}）`,
    description: `ゲーム関連ニュースのうち「${label}」の新着`,
    siteUrl: new URL(withBase("/"), site).toString(),
    feedUrl: new URL(withBase(`/feed/${id}.xml`), site).toString(),
    items: jaNews.filter((it) => it.categories.includes(id)),
    categoryLabel: (c) => names[c],
  });
};
