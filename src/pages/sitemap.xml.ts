// fourgetkun-hub の robots.txt から案内されるサイトマップ(hub の build-manifest.js の PROXIED_SITEMAPS)。
// URL は公開側(fourgetkun.com/game-news/...)で、末尾スラッシュ付きを正本にする。
import type { APIRoute } from "astro";
import { generatedAt } from "../lib/news";

export const prerender = true;

const PAGES = ["/", "/about/"];

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const lastmod = generatedAt ? generatedAt.slice(0, 10) : undefined;
  const urls = PAGES.map((p) => {
    const loc = new URL(`${base}${p}`, site).toString();
    return `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  }).join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
