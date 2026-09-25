import newsData from "../data/news.json";
import feedsData from "../data/feeds.json";
import filtersData from "../data/filters.json";

export type FeedKind = "specialist" | "general" | "aggregator" | "press";

export interface NewsSource {
  name: string;
  sourceId: string;
  link: string;
  via?: string;
  /** Yahoo!ニュース等の再配信ポータル経由 */
  syndicated?: boolean;
}

export interface NewsItem {
  title: string;
  summary: string;
  link: string;
  pubDate: string | null;
  /** このサイトが初めて拾った時刻(「前回から新着」の判定用) */
  firstSeen?: string | null;
  image: string | null;
  source: string;
  sourceId: string;
  kind: FeedKind;
  lang: "ja" | "en";
  score: number;
  categories: string[];
  /** 機種(switch2 / switch / ps5 / ps4 / xbox / pc / mobile / vr) */
  platforms: string[];
  works: string[];
  spoiler: boolean;
  /** 元記事が見つからず、再配信ポータルの記事だけが残っているもの */
  syndicated?: boolean;
  sources: NewsSource[];
  /** セール・無料配布の記事(scripts/lib/filter.mjs の classifyDeal) */
  deal?: Deal | null;
}

export interface Deal {
  /** 店(steam / epic / ps / nintendo / xbox / other)。見出し・要約から分かったものだけ */
  stores: string[];
  /** 見出しにある最大の割引率(%) */
  off: number | null;
  /** 無料配布 */
  free: boolean;
}

/** 予定(カレンダー)。scripts/fetch-news.mjs の buildCalendar が作る */
export interface CalendarEntry {
  /** "2026-12-10"(日まで) か "2026-12"(月まで) */
  date: string;
  precision: "day" | "month";
  verb: string;
  label: string;
  work: string | null;
  title: string;
  link: string;
  source: string;
  sources: number;
  categories: string[];
  platforms: string[];
  spoiler: boolean;
}

export interface FeedStatus {
  id: string;
  name: string;
  kind: FeedKind;
  lang: string;
  ok: boolean;
  error: string | null;
  fetched: number;
  archived: number;
  accepted: number;
}

export interface Category {
  id: string;
  label: string;
  emoji: string;
  keywords: string[];
  /** 「見たくない話題」として閲覧側で隠せるもの(事件・熱愛・訃報) */
  sensitive?: boolean;
  hint?: string;
}

const data = newsData as unknown as {
  generatedAt: string;
  count: number;
  dedupe?: { exact: number; syndicated: number; similar: number; syndicatedTotal: number; syndicatedLeft: number };
  feeds: FeedStatus[];
  calendar?: CalendarEntry[];
  items: NewsItem[];
};

export const allNews = data.items;
/** 初期表示と同じく日本語の記事だけ(ヒーロー・テロップ・JS無効時の一覧用) */
export const jaNews = allNews.filter((it) => it.lang === "ja");
export const generatedAt = data.generatedAt;
export const feedStatus = data.feeds;
export const dedupeStats = data.dedupe;
export const calendar: CalendarEntry[] = data.calendar ?? [];
export const feeds = feedsData as { id: string; name: string; url: string; kind: FeedKind; lang: string; minScore?: number }[];
export const categories = (filtersData as unknown as { categories: Category[] }).categories;
/** 絞り込みのチップに並べるカテゴリ */
export const topicCategories = categories.filter((c) => !c.sensitive);
/** 「見たくない話題を隠す」に並べるカテゴリ */
export const sensitiveCategories = categories.filter((c) => c.sensitive);

export interface Platform {
  id: string;
  label: string;
}
export const platforms = (filtersData as unknown as { platforms: { list: Platform[] } }).platforms.list.map(({ id, label }) => ({ id, label }));

/** 直近 hours 時間の、機種ごとの記事数(ヒーローのステータス表示用) */
export function platformCounts(hours = 24): { id: string; label: string; count: number }[] {
  const base = new Date(generatedAt).getTime() || Date.now();
  const cutoff = base - hours * 3600_000;
  const counts = new Map<string, number>();
  for (const item of jaNews) {
    const t = item.pubDate ? Date.parse(item.pubDate) : NaN;
    if (Number.isNaN(t) || t < cutoff) continue;
    for (const p of item.platforms ?? []) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return platforms.map((p) => ({ ...p, count: counts.get(p.id) ?? 0 }));
}

/** 直近 hours 時間の日本語記事の数 */
/** セール記事の店 */
export const dealStores = (filtersData as unknown as { deals: { stores: { id: string; label: string }[] } }).deals.stores.map(({ id, label }) => ({ id, label }));

/** いまのセール・無料配布の記事(新しい順)。ヒーローの「ショップ」とセールの RSS に使う */
export function currentDeals(days = 7, limit = Infinity): NewsItem[] {
  const since = (new Date(generatedAt).getTime() || Date.now()) - days * 86400_000;
  const sensitive = new Set(sensitiveCategories.map((c) => c.id));
  return jaNews
    .filter((it) => it.deal && (!it.pubDate || Date.parse(it.pubDate) >= since) && !it.categories.some((c) => sensitive.has(c)))
    .slice(0, limit);
}

/** セールの札の文字(無料 / -70% / セール) */
export function dealLabel(deal: Deal): string {
  return deal.free ? "無料" : deal.off ? `-${deal.off}%` : "セール";
}

export function recentCount(hours = 24): number {
  const base = new Date(generatedAt).getTime() || Date.now();
  return jaNews.filter((it) => it.pubDate && Date.parse(it.pubDate) >= base - hours * 3600_000).length;
}
export const thresholds = (filtersData as unknown as { thresholds: Record<FeedKind, number> }).thresholds;

export const kindLabels: Record<FeedKind, string> = {
  specialist: "ゲーム専門媒体",
  general: "総合媒体",
  aggregator: "Googleニュース経由",
  press: "プレスリリース",
};

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(d);
}

/** 直近 hours 時間に報じられた件数が多い作品(ヒーローと作品ランキング用) */
export function trendingWorks(hours = 72, limit = 12): { name: string; count: number }[] {
  const base = new Date(generatedAt).getTime() || Date.now();
  const cutoff = base - hours * 3600_000;
  const counts = new Map<string, number>();
  for (const item of jaNews) {
    const t = item.pubDate ? Date.parse(item.pubDate) : NaN;
    if (Number.isNaN(t) || t < cutoff) continue;
    for (const w of item.works) counts.set(w, (counts.get(w) ?? 0) + item.sources.length);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ---- 作品ページ -------------------------------------------------------------

/** 作品ページを作る最低件数。1件だけの作品は中身が薄いので作らない */
export const WORK_PAGE_MIN_ITEMS = 2;

/**
 * 作品名から URL 用の名前を作る。日本語はそのまま使い、URL で問題になる記号だけ「-」にする。
 * (「FFX/X-2 HD Remaster」の「/」はパスの区切りになってしまうため)
 */
export function workSlug(name: string): string {
  return (
    name
      .normalize("NFKC")
      .replace(/[\/\?#%&:*"<>|\s.,!！?？'’`^~{}\[\]()（）【】「」『』〈〉]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "work"
  );
}

export interface WorkPage {
  name: string;
  slug: string;
  items: NewsItem[];
}

/** 記事が WORK_PAGE_MIN_ITEMS 件以上ある作品の一覧(記事の多い順)。slug が重なったら番号を付ける */
export const workPages: WorkPage[] = (() => {
  const byName = new Map<string, NewsItem[]>();
  for (const item of allNews) {
    for (const w of item.works) {
      if (!byName.has(w)) byName.set(w, []);
      byName.get(w)!.push(item);
    }
  }
  const pages: WorkPage[] = [];
  const used = new Set<string>();
  const sorted = [...byName.entries()]
    .filter(([, items]) => items.length >= WORK_PAGE_MIN_ITEMS)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ja"));
  for (const [name, items] of sorted) {
    let slug = workSlug(name);
    for (let n = 2; used.has(slug); n++) slug = `${workSlug(name)}-${n}`;
    used.add(slug);
    pages.push({ name, slug, items });
  }
  return pages;
})();

/** 作品名 → 作品ページの slug(ページがある作品だけ) */
export const workSlugByName: Record<string, string> = Object.fromEntries(workPages.map((w) => [w.name, w.slug]));
