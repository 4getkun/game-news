// クライアント側の絞り込みUIが fetch() で読む軽量JSON。ビルド時に静的ファイルとして出力される。
import type { APIRoute } from "astro";
import { allNews, generatedAt } from "../../lib/news";

export const prerender = true;

export const GET: APIRoute = () => {
  const items = allNews.map((it) => ({
    t: it.title,
    s: it.summary,
    l: it.link,
    d: it.pubDate,
    fs: it.firstSeen ?? null,
    i: it.image,
    src: it.sourceId,
    sn: it.source,
    k: it.kind,
    lang: it.lang,
    c: it.categories,
    p: it.platforms ?? [],
    w: it.works,
    sp: it.spoiler ? 1 : 0,
    sy: it.syndicated ? 1 : 0,
    x: it.sources.slice(1).map((s) => ({ n: s.name, l: s.link, ...(s.syndicated ? { sy: 1 } : {}) })),
    ...(it.deal ? { dl: { s: it.deal.stores, o: it.deal.off, f: it.deal.free ? 1 : 0 } } : {}),
  }));
  return new Response(JSON.stringify({ generatedAt, items }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
