// fourgetkun-hub の robots.txt から案内されるサイトマップ(hub の build-manifest.js の PROXIED_SITEMAPS)。
// URL は公開側(fourgetkun.com/game-news/...)で、末尾スラッシュ付きを正本にする。
// タイトルページの lastmod は、そのタイトルの一番新しい記事の日付(検索エンジンに更新があったページを伝える)
import type { APIRoute } from "astro";
import { generatedAt, workPages } from "../lib/news";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const today = generatedAt ? generatedAt.slice(0, 10) : undefined;
  const pages: { path: string; lastmod?: string }[] = [
    { path: "/", lastmod: today },
    { path: "/calendar/", lastmod: today },
    { path: "/work/", lastmod: today },
    { path: "/about/", lastmod: today },
    ...workPages.map((w) => ({
      path: `/work/${encodeURIComponent(w.slug)}/`,
      lastmod: w.items[0]?.pubDate?.slice(0, 10) ?? today,
    })),
  ];
  const urls = pages
    .map((p) => {
      const loc = new URL(`${base}${p.path}`, site).toString();
      return `  <url><loc>${loc}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ""}</url>`;
    })
    .join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
