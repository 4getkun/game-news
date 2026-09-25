// RSS 2.0 を組み立てるヘルパー。/feed.xml(全記事)と /feed/<カテゴリ>.xml が使う。
import type { NewsItem } from "./news";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

export const RSS_ITEMS = 50;

export function buildRss(opts: {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
  items: NewsItem[];
  categoryLabel?: (id: string) => string | undefined;
}): Response {
  const items = opts.items.slice(0, RSS_ITEMS).map((it) => {
    const others = it.sources.slice(1).filter((s) => !s.syndicated);
    const desc = [
      it.summary,
      others.length ? `同じ話題: ${others.map((s) => s.name).join("、")}` : "",
      `出典: ${it.source}`,
    ]
      .filter(Boolean)
      .join("\n");
    const cats = [...it.works, ...it.categories.map((c) => opts.categoryLabel?.(c) ?? c)]
      .map((c) => `<category>${esc(c)}</category>`)
      .join("");
    return `<item><title>${esc(it.title)}</title><link>${esc(it.link)}</link><guid isPermaLink="true">${esc(
      it.link,
    )}</guid>${it.pubDate ? `<pubDate>${new Date(it.pubDate).toUTCString()}</pubDate>` : ""}<description>${esc(
      desc,
    )}</description>${cats}</item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(opts.title)}</title>
<link>${esc(opts.siteUrl)}</link>
<description>${esc(opts.description)}</description>
<language>ja</language>
<atom:link href="${esc(opts.feedUrl)}" rel="self" type="application/rss+xml"/>
${items.join("\n")}
</channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
