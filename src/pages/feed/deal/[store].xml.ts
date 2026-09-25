// セール・無料配布の RSS。/feed/deal/all.xml(すべての店)と /feed/deal/steam.xml などの店別。
// 「セール・無料」カテゴリの /feed/sale.xml と中身は同じで、こちらは店で分けられる
import type { APIRoute, GetStaticPaths } from "astro";
import { jaNews, categories, dealStores } from "../../../lib/news";
import { buildRss } from "../../../lib/rss";
import { withBase } from "../../../lib/url";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () => [
  { params: { store: "all" }, props: { id: "all", label: "セール・無料配布" } },
  ...dealStores.filter((st) => st.id !== "other").map((st) => ({ params: { store: st.id }, props: { id: st.id, label: `${st.label}のセール・無料配布` } })),
];

export const GET: APIRoute = ({ props, site }) => {
  const { id, label } = props as { id: string; label: string };
  const names = Object.fromEntries(categories.map((c) => [c.id, c.label]));
  return buildRss({
    title: `ゲームニュース全部（${label}）`,
    description: `ゲームの${label}の記事(ゲームニュース全部が見出しで判定)`,
    siteUrl: new URL(withBase(id === "all" ? "/?deal=1" : `/?store=${id}`), site).toString(),
    feedUrl: new URL(withBase(`/feed/deal/${id}.xml`), site).toString(),
    items: jaNews.filter((it) => it.deal && (id === "all" || it.deal.stores.includes(id))),
    categoryLabel: (c) => names[c],
  });
};
