// 構造化データ(JSON-LD)のヘルパー。パンくずは fourgetkun 工房(ハブ) › サイト › … の順
import { withBase } from "./url";

const SITE = "https://fourgetkun.com";
export const SITE_NAME = "ゲームニュース全部";

export function absUrl(path: string): string {
  return new URL(withBase(path), SITE).toString();
}

/** trail はサイトのトップより下の階層(例: [{ name: "作品一覧", path: "/work/" }]) */
export function breadcrumb(trail: { name: string; path: string }[]) {
  const items = [
    { name: "fourgetkun 工房", url: `${SITE}/` },
    { name: SITE_NAME, url: absUrl("/") },
    ...trail.map((t) => ({ name: t.name, url: absUrl(t.path) })),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}
