// 構造化データ(JSON-LD)のヘルパー。パンくずは fourgetkun Workshop(ハブ) › サイト › … の順
import { withBase } from "./url";

const SITE = "https://fourgetkun.com";
export const SITE_NAME = "All Game News";

export function absUrl(path: string): string {
  return new URL(withBase(path), SITE).toString();
}

/** trail はサイトのトップより下の階層(例: [{ name: "Title index", path: "/work/" }]) */
export function breadcrumb(trail: { name: string; path: string }[]) {
  const items = [
    { name: "fourgetkun Workshop", url: `${SITE}/` },
    { name: SITE_NAME, url: absUrl("/") },
    ...trail.map((t) => ({ name: t.name, url: absUrl(t.path) })),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

