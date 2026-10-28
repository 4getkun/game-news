import newsData from "../data/news.json";
import feedsData from "../data/feeds.json";
import filtersData from "../data/filters.json";

export type FeedKind = "specialist" | "general" | "aggregator" | "press";

export interface NewsSource {
  name: string;
  sourceId: string;
  link: string;
  via?: string;
  /** Yahoo!News等の再配信ポータル経由 */
  syndicated?: boolean;
}

export interface NewsItem {
  title: string;
  summary: string;
  link: string;
  pubDate: string | null;
  /** このサイトが初めて拾った時刻(「New since last visit」の判定用) */
  firstSeen?: string | null;
  image: string | null;
  source: string;
  sourceId: string;
  kind: FeedKind;
  lang: "ja" | "en";
  score: number;
  categories: string[];
  /** Platform(switch2 / switch / ps5 / ps4 / xbox / pc / mobile / vr) */
  platforms: string[];
  works: string[];
  spoiler: boolean;
  /** 元記事が見つからず、再配信ポータルの記事だけが残っているもの */
  syndicated?: boolean;
  sources: NewsSource[];
  /** Sales and giveawaysの記事(scripts/lib/filter.mjs の classifyDeal) */
  deal?: Deal | null;
}

export interface Deal {
  /** 店(steam / epic / ps / nintendo / xbox / other)。見出し・要約から分かったものだけ */
  stores: string[];
  /** 見出しにある最大の割引率(%) */
  off: number | null;
  /** Free配布 */
  free: boolean;
}

/** Schedule(カレンダー)。scripts/fetch-news.mjs の buildCalendar が作る */
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
  /** 「見たくないTopics」として閲覧側で隠せるもの(事 articles・熱愛・訃報) */
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
/** 初期Displayと同じくJapaneseの記事だけ(ヒーロー・テロップ・JS無効時の一覧用) */
export const jaNews = allNews.filter((it) => it.lang === "ja");
export const generatedAt = data.generatedAt;
export const feedStatus = data.feeds;
export const dedupeStats = data.dedupe;
export const scheduleLabels: Record<string, string> = {release: "Release", launch: "Launch", update: "Update", demo: "Demo / test", event: "Event / broadcast"};
export const calendar: CalendarEntry[] = (data.calendar ?? []).map(e => ({...e, label: scheduleLabels[e.verb] ?? e.label}));
export const feeds = feedsData as { id: string; name: string; url: string; kind: FeedKind; lang: string; minScore?: number }[];
const categoryLabels: Record<string, string> = {"new": "New announcements", "release": "Releases", "update": "Updates and DLC", "trailer": "Trailers and videos", "sale": "Sales and free games", "demo": "Demos and tests", "event": "Events and showcases", "hardware": "Hardware and accessories", "esports": "Esports and tournaments", "mobile": "Mobile games", "indie": "Indie", "review": "Reviews and interviews", "media": "Anime and film adaptations", "collab": "Collaborations and merchandise", "business": "Industry and business", "ranking": "Rankings and surveys", "trouble": "Incidents and controversy"};
export const categories = (filtersData as unknown as { categories: Category[] }).categories.map(c => ({...c, label: categoryLabels[c.id] ?? c.label, ...(c.hint ? {hint: "Threats, arrests, lawsuits, controversy, misconduct, outages or service closures"} : {})}));
/** Filtersのチップに並べるCategories */
export const topicCategories = categories.filter((c) => !c.sensitive);
/** 「Hide unwanted topics」に並べるCategories */
export const sensitiveCategories = categories.filter((c) => c.sensitive);

export interface Platform {
  id: string;
  label: string;
}
export const platforms = (filtersData as unknown as { platforms: { list: Platform[] } }).platforms.list.map(({ id, label }) => ({ id, label: id === "mobile" ? "Mobile" : label }));

/** 直近 hours 時間の、Platformごとの記事数(ヒーローのステータスDisplay用) */
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

/** 直近 hours 時間のJapanese記事の数 */
/** Sale記事の店 */
export const dealStores = (filtersData as unknown as { deals: { stores: { id: string; label: string }[] } }).deals.stores.map(({ id, label }) => ({ id, label: id === "nintendo" ? "eShop" : id === "other" ? "Other" : label }));

/** いま sales and giveawaysの記事(Newest first)。ヒーローの「ショップ」とSaleの RSS に使う */
export function currentDeals(days = 7, limit = Infinity): NewsItem[] {
  const since = (new Date(generatedAt).getTime() || Date.now()) - days * 86400_000;
  const sensitive = new Set(sensitiveCategories.map((c) => c.id));
  return jaNews
    .filter((it) => it.deal && (!it.pubDate || Date.parse(it.pubDate) >= since) && !it.categories.some((c) => sensitive.has(c)))
    .slice(0, limit);
}

/** Saleの札の文字(Free / -70% / Sale) */
export function dealLabel(deal: Deal): string {
  return deal.free ? "Free" : deal.off ? `-${deal.off}%` : "Sale";
}

export function recentCount(hours = 24): number {
  const base = new Date(generatedAt).getTime() || Date.now();
  return jaNews.filter((it) => it.pubDate && Date.parse(it.pubDate) >= base - hours * 3600_000).length;
}
export const thresholds = (filtersData as unknown as { thresholds: Record<FeedKind, number> }).thresholds;

export const kindLabels: Record<FeedKind, string> = {
  specialist: "Gaming publications",
  general: "General publications",
  aggregator: "Via Google News",
  press: "Press releases",
};

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(d);
}

/** 直近 hours 時間に報じられた articles数が多いTitles(ヒーローとTitlesランキング用) */
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

// ---- Title page -------------------------------------------------------------

/** Title pageを作る最低 articles数。1 articlesだけのTitlesは中身が薄いので作らない */
export const WORK_PAGE_MIN_ITEMS = 2;

/**
 * Titles名から URL 用の名前を作る。Japaneseはそのまま使い、URL で問題になる記号だけ「-」にする。
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

/** 記事が WORK_PAGE_MIN_ITEMS  articles以上あるTitlesの一覧(記事の多い順)。slug が重なったら番号を付ける */
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

/** Titles名 → Title pageの slug(ページがあるTitlesだけ) */
export const workSlugByName: Record<string, string> = Object.fromEntries(workPages.map((w) => [w.name, w.slug]));

