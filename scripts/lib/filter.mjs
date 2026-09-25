// scripts/lib/filter.mjs
//
// ゲームニュースの「収集時フィルタ」本体(姉妹サイト anime-news と同じ仕組み)。fetch-news.mjs から使うほか、
// filter.test.mjs で単体テストしている。副作用のない純粋関数だけを置く。
//
// フィルタは次の順に効く(src/data/filters.json で調整できる):
//   1. hardExclude  … 広告・成人向け・求人などを無条件で捨てる
//   2. relevance    … フィードの種類(kind)ごとのしきい値で「ゲーム関連か」を判定
//                     (ゲーム専門媒体はしきい値0=全部採用、総合媒体ほど厳しい)
//   3. categories   … 新作・発売・アップデート…のカテゴリを複数付与(表示側の絞り込み用)
//   3'. platforms   … Switch 2 / PS5 / PC…の機種を複数付与(表示側の機種絞り込み用)
//   4. works        … 見出しから作品名を抽出(作品フォロー・同一ニュース統合用)
//   5. spoiler      … ネタバレの恐れがある見出しに印を付ける(表示側でぼかす)

/** 全角英数記号を半角に、連続空白を1つにする(判定用。表示用テキストは変えない) */
export function normalizeForMatch(text) {
  return String(text ?? "")
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, " ")
    .trim();
}

const ASCII_WORD_RE = /^[A-Za-z][A-Za-z0-9 .+\-]*$/;
const matcherCache = new Map();

/**
 * キーワード1つ分の判定関数を作る。英単語のキーワード("game" 等)は単語境界つきで
 * 判定しないと "prevent" に "event" が当たるような誤爆が起きるため、ASCIIの
 * 英単語だけは \b で囲んだ正規表現にする。日本語は単語境界が無いので部分一致。
 */
function keywordMatcher(keyword) {
  if (matcherCache.has(keyword)) return matcherCache.get(keyword);
  const kw = normalizeForMatch(keyword);
  let fn;
  if (ASCII_WORD_RE.test(kw)) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`, "i");
    fn = (text) => re.test(text);
  } else {
    const lower = kw.toLowerCase();
    fn = (text) => text.toLowerCase().includes(lower);
  }
  matcherCache.set(keyword, fn);
  return fn;
}

export function containsKeyword(text, keyword) {
  return keywordMatcher(keyword)(normalizeForMatch(text));
}

export function containsAny(text, keywords) {
  return keywords.some((kw) => containsKeyword(text, kw));
}

/** Googleニュース経由の「見出し - 媒体名」や Yahoo!の「見出し(媒体名)」から媒体名を分離する */
export function splitPublisherSuffix(title) {
  const g = title.match(/^(.*\S)\s+-\s+([^-]{1,40})$/);
  if (g) return { title: g[1], publisher: g[2].trim() };
  return { title, publisher: null };
}

/** 判定用に、見出し末尾の「(オリコン)」のような出典表記を取り除く */
export function stripTrailingSource(title) {
  return title.replace(/[（(][^（）()]{1,30}[）)]\s*$/, "").trim();
}

export function isHardExcluded(title, summary, config) {
  const t = normalizeForMatch(title);
  const all = `${t} ${normalizeForMatch(summary)}`;
  const { hardExclude } = config;
  if (hardExclude.title.some((kw) => t.toUpperCase().includes(normalizeForMatch(kw).toUpperCase()))) {
    return true;
  }
  return containsAny(all, hardExclude.any);
}

/**
 * ゲーム関連度スコア。重み付きキーワードの合計 + 既知作品名ボーナス。
 * 見出しに出てくるキーワードは要約だけに出てくるものより強いシグナルなので2倍にする。
 */
export function relevanceScore(title, summary, config, knownWorks = null) {
  const t = normalizeForMatch(title);
  const s = normalizeForMatch(summary);
  let score = 0;
  const hits = [];
  for (const [kw, weight] of Object.entries(config.relevance.weights)) {
    const inTitle = containsKeyword(t, kw);
    const inSummary = !inTitle && containsKeyword(s, kw);
    if (!inTitle && !inSummary) continue;
    const w = inTitle && weight > 0 ? weight * 2 : weight;
    score += w;
    hits.push(kw);
  }
  if (knownWorks && knownWorks.size > 0) {
    const titleWorks = extractWorks(title, config, { lenient: true });
    // 作品辞書は workKey で持つ(表記ゆれがあっても当たるように)
    if (titleWorks.some((w) => knownWorks.has(workKey(w, config)))) {
      score += config.relevance.knownWorkBonus;
      hits.push("#known-work");
    }
  }
  return { score, hits };
}

export function thresholdFor(feed, config) {
  // feeds.json 側で minScore を指定したフィードはそれを優先(媒体ごとの微調整用)
  if (typeof feed.minScore === "number") return feed.minScore;
  const kind = feed.kind;
  return config.thresholds[kind] ?? config.thresholds.general;
}

export function classifyCategories(title, summary, config) {
  const full = `${normalizeForMatch(title)} ${normalizeForMatch(summary)}`;
  const titleOnly = normalizeForMatch(title);
  return config.categories
    .filter((c) => {
      // scope: "title" は見出しだけで判定(要約=あらすじに出る「殺害」「死去」などを拾わない)
      let t = c.scope === "title" ? titleOnly : full;
      // skipQuoted: 『』「」の中(作品名・台詞)を無視する(『わたしの幸せな結婚』で結婚扱いにしない)
      if (c.skipQuoted) t = t.replace(/『[^』]*』|「[^」]*」/g, " ");
      // ignore: そのカテゴリの判定の前に消す語(「エンドゲーム」の「ゲーム」でゲーム扱いにしない等)
      for (const w of c.ignore ?? []) t = t.split(normalizeForMatch(w)).join(" ");
      return containsAny(t, c.keywords);
    })
    .map((c) => c.id);
}

/** 機種を判定する。exclude の語を先に消してから探す(「Switch 2」だけの記事に Switch を付けない) */
export function classifyPlatforms(title, summary, config) {
  const text = `${normalizeForMatch(title)} ${normalizeForMatch(summary)}`;
  return (config.platforms?.list ?? [])
    .filter((p) => {
      let t = text;
      for (const w of p.exclude ?? []) t = t.split(normalizeForMatch(w)).join(" ");
      return containsAny(t, p.keywords);
    })
    .map((p) => p.id);
}

/**
 * セール・無料配布の記事かを判定する(見出しで判定。店は見出し＋要約)。
 * 返り値: null(セールではない) か { stores: ["steam", ...], off: 最大の割引率(%) | null, free: 無料配布か }
 * Kindle のマンガのポイント還元・ハードや周辺機器の値引き・ガチャは対象外(deals.exclude)
 */
export function classifyDeal(title, summary, config) {
  const d = config.deals;
  if (!d) return null;
  const t = normalizeForMatch(title);
  if (!d.signals.some((re) => new RegExp(re, "i").test(t))) return null;
  if (d.exclude.some((re) => new RegExp(re, "i").test(t))) return null;
  const all = `${t} ${normalizeForMatch(summary)}`;
  const stores = d.stores.filter((st) => new RegExp(st.pattern, "i").test(all)).map((st) => st.id);
  const offs = [...t.matchAll(/(\d{1,3})\s*%\s*(オフ|off|引き|割引)/gi)].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 100);
  const free = /無料配布|期間限定(で)?無料|無料で(入手|もらえる|配布)|(?<![\d,])0円で|→\s*0円|free to keep|free this week|giveaway/i.test(t);
  return { stores, off: offs.length ? Math.max(...offs) : null, free };
}

export function isSpoiler(title, config) {
  const t = normalizeForMatch(title);
  if (containsAny(t, config.spoiler.keywords)) return true;
  return config.spoiler.patterns.some((p) => new RegExp(p, "i").test(t));
}

/** 作品名の表記ゆれを寄せる(「新作『X』」「Switch 2版『X』」→「X」) */
export function canonicalWork(raw, config) {
  let w = normalizeForMatch(raw).replace(/[　\s]+/g, " ").trim();
  for (const prefix of config.works.stripPrefixes) {
    if (w.startsWith(prefix) && w.length > prefix.length + 1) {
      w = w.slice(prefix.length).trim();
    }
  }
  for (const p of config.works.stripSuffixPatterns) {
    w = w.replace(new RegExp(p, "i"), "").trim();
  }
  return w;
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16 };

/**
 * 作品名の「同じ作品か」を判定するためのキー。表示には使わない。
 *  - 全角/半角・大文字小文字・空白・中黒・コロン・波線・™ の違いを無視
 *  - works.aliases で略称にそろえる(「ファイナルファンタジー」「FINAL FANTASY」→「FF」など)
 *  - 略称の直後のローマ数字を数字にする(「FFVII」→「ff7」、「ドラクエXI」→「ドラクエ11」)
 * 「FFX/X-2 HD Remaster」「FINAL FANTASY X/X-2 HD Remaster」「ファイナルファンタジーX/X-2 HDリマスター」は同じキーになる。
 */
export function workKey(name, config) {
  let k = normalizeForMatch(name).toLowerCase();
  for (const [from, to] of Object.entries(config.works.aliases ?? {})) {
    k = k.split(normalizeForMatch(from).toLowerCase()).join(normalizeForMatch(to).toLowerCase());
  }
  const prefixes = (config.works.numeralPrefixes ?? []).map((x) => normalizeForMatch(x).toLowerCase());
  for (const pre of prefixes) {
    const esc = pre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    k = k.replace(new RegExp(`(${esc})\\s?(xvi|xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)(?![a-z])`, "g"), (_, a, n) => a + ROMAN[n]);
  }
  // ハイフンは「X-2」の区切りなので残す(消すと「FFX-2」が「FF102」になる)
  return k.replace(/[\s・･:：~〜～™®]/g, "");
}

/**
 * 同じ作品の表記ゆれを1つの表示名にそろえる対応表を作る。
 * キーごとに最も多く使われている表記を選ぶ(同数なら短い方)。
 */
export function buildWorkDisplayMap(allWorks, config) {
  const byKey = new Map();
  for (const w of allWorks) {
    const key = workKey(w, config);
    if (!byKey.has(key)) byKey.set(key, new Map());
    const counts = byKey.get(key);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const display = new Map();
  for (const counts of byKey.values()) {
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    for (const w of counts.keys()) display.set(w, best);
  }
  return display;
}

/**
 * 見出しから作品名を取り出す。
 *  - 『』で囲まれた語は常に作品名とみなす(日本語メディアの慣例)
 *  - 「」は発言の引用にも使われるので、直前が「ゲーム」「新作」「シリーズ」等のときだけ採用。
 *    lenient=true(ゲーム専門媒体)なら、句読点や感嘆符を含まない短い「」も採用する
 *  - 英語見出しは MAL 形式の先頭 'Title' だけ拾う
 */
export function extractWorks(title, config, { lenient = false } = {}) {
  const found = [];
  const text = String(title ?? "");
  for (const m of text.matchAll(/『([^』]{1,60})』/g)) found.push(m[1]);

  const ctx = new RegExp(config.works.cornerQuoteContextPattern);
  for (const m of text.matchAll(/「([^」]{1,40})」/g)) {
    const before = text.slice(0, m.index);
    const inner = m[1];
    const looksLikeTitle = inner.length <= 25 && !/[。、！？!?…]/.test(inner);
    // ゲームの記事では「」はキャラ名・モンスター名・用語に使われることが多いので、
    // filters.json の works.lenientCornerQuotes が false なら寛容モードでも拾わない
    const allowLenient = lenient && config.works.lenientCornerQuotes !== false;
    if (ctx.test(before) || (allowLenient && looksLikeTitle)) found.push(inner);
  }

  const en = text.match(/^'([^']{2,60})'/);
  if (en) found.push(en[1]);

  const ignore = new Set(config.works.ignore);
  const out = [];
  for (const raw of found) {
    const w = canonicalWork(raw, config);
    if (w.length < 2 || ignore.has(w) || out.includes(w)) continue;
    out.push(w);
  }
  return out;
}

/**
 * 1記事ぶんの判定をまとめて行う。採用しない場合は null を返す。
 * feed: feeds.json の1要素 / knownWorks: 専門媒体から集めた作品名の Set
 */
/**
 * ゲーム専門媒体が出すアニメ・音楽・映画などの記事か。見出しにアニメ・コンサート等の語があり、
 * ゲームの語が1つも無い(作品辞書の加点は数えない)ものを true にする。
 * ゲームが原作のタイトル(offTopic.gameOriginWorks)のアニメ化・コンサートは false(ゲームの話題として残す)
 */
export function isOffTopic(title, summary, config) {
  const o = config.offTopic;
  if (!o) return false;
  const t = normalizeForMatch(title);
  if (!o.signals.some((re) => new RegExp(re).test(t))) return false;
  if (o.gameOriginWorks.some((w) => containsKeyword(t, w))) return false;
  return relevanceScore(title, summary, config, null).score <= 0;
}

export function evaluateItem({ title, summary }, feed, config, knownWorks = null) {
  if (isHardExcluded(title, summary, config)) return null;

  const matchTitle = stripTrailingSource(splitPublisherSuffix(title).title);
  if (isOffTopic(matchTitle, summary, config)) return null;
  const { score, hits } = relevanceScore(matchTitle, summary, config, knownWorks);
  if (feed.kind !== "specialist" && score < thresholdFor(feed, config)) return null;

  return {
    score,
    hits,
    categories: classifyCategories(matchTitle, summary, config),
    deal: classifyDeal(matchTitle, summary, config),
    platforms: classifyPlatforms(matchTitle, summary, config),
    works: extractWorks(matchTitle, config, { lenient: feed.kind === "specialist" }),
    spoiler: isSpoiler(matchTitle, config),
  };
}

// ---- 再配信(転載)の検出 ------------------------------------------------
//
// Yahoo!ニュース・dメニューニュース・エキサイト等のポータルは、元媒体の記事を
// そのまま(または見出しを少し変えて)再配信する。Googleニュースの検索結果には
// 元記事と再配信が両方並ぶため、放っておくと同じ記事が何件も並ぶ。
// ポータルの媒体名・ドメインで「再配信」と判定し、元記事側にまとめる。

function hostOf(link) {
  try {
    return new URL(link).hostname;
  } catch {
    return "";
  }
}

/** 媒体名またはURLのドメインが再配信ポータルなら true */
export function isSyndicated({ source = "", link = "" }, config) {
  const synd = config.syndication;
  if (!synd) return false;
  const name = normalizeForMatch(source).toLowerCase();
  if (synd.portals.some((p) => name === normalizeForMatch(p).toLowerCase())) return true;
  const host = hostOf(link);
  return synd.hosts.some((h) => host === h || host.endsWith("." + h));
}

/** 「見出し(オリコン)」「見出し（コミックナタリー）」の末尾から元媒体名を取り出す */
export function originalPublisherFromTitle(title) {
  const m = String(title ?? "").match(/[（(]([^（）()]{1,30})[）)]\s*$/);
  return m ? m[1].trim() : null;
}

// ---- 同一ニュースの統合 ---------------------------------------------------
//
// 3つの条件のどれかに当てはまれば同じニュースとみなしてまとめる。
//  1. 見出しが(記号・出典表記を除いて)完全一致 … 再配信・プレスリリースの転載。期間は問わない
//  2. 片方が再配信ポータルで、72時間以内・見出しがかなり似ている … 見出しを少し変えた転載
//  3. 12時間以内・見出しがよく似ている(同じ作品ならやや緩め) … 別媒体が同じ発表を報じたもの
// 誤統合(別のニュースが隠れる)の方が統合漏れより害が大きいので、しきい値は保守的。
// 代表記事には再配信でない記事を優先して選ぶ。
//
// 3 には news-lifespan のクラスタリングから2つの考え方を取り入れている。
//  - 連鎖の防止: A≒B、B≒C でも A と C が似ていないのに1つにまとまる(union-find の連鎖)のを
//    避けるため、グループの最初の記事(リーダー)とも似ていることを条件にする
//  - ありふれた語だけの一致を無視: 同じ作品の記事は作品名だけで見出しが似て見えるので、
//    作品名を取り除いた残りで比べる(「『X』PV公開」と「『X』グッズ発売」を別扱いにする)

export const DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;
export const DEDUPE_SIMILARITY = 0.55;
export const DEDUPE_SIMILARITY_SAME_WORK = 0.4;
export const EXACT_TITLE_MIN_LENGTH = 10;
export const DEDUPE_LEADER_SIMILARITY = 0.45;

export function normalizeTitleForCompare(title) {
  return normalizeForMatch(stripTrailingSource(splitPublisherSuffix(title).title))
    .replace(/^[【\[][^】\]]*[】\]]/, "")
    .replace(/[\s「」『』【】\[\]（）()、。！？!?・:：\-—―~〜"'“”‘’…]/g, "")
    .toLowerCase();
}

export function bigrams(text) {
  const set = new Set();
  if (text.length === 1) set.add(text);
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

function timeOf(item) {
  const t = item.pubDate ? new Date(item.pubDate).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
}

function mergeGroup(group, kindRank) {
  if (group.length === 1) return group[0];
  // 代表記事: 見出しが途中で切れていない記事 > 再配信でない記事 > 専門媒体 > 総合 > プレス > Googleニュース経由、
  // 同順位なら要約が長い方
  const rank = (it) => kindRank(it) + (it.syndicated ? 100 : 0) + (isTruncatedTitle(it.title) ? 1000 : 0);
  const primary = group.reduce((best, cur) => {
    const rb = rank(best);
    const rc = rank(cur);
    if (rc !== rb) return rc < rb ? cur : best;
    return (cur.summary?.length ?? 0) > (best.summary?.length ?? 0) ? cur : best;
  });
  const times = group.map(timeOf).filter((t) => t !== null);
  const seenLinks = new Set();
  const seenNames = new Set();
  const sources = [];
  // 元記事の出典を先に、再配信を後ろに並べる
  const ordered = [primary, ...group.filter((it) => it !== primary).sort((a, b) => rank(a) - rank(b))];
  for (const it of ordered) {
    for (const s of it.sources ?? []) {
      const key = s.link.split("?")[0];
      // Googleニュース経由で同じ媒体の同じ記事が別URLで来ることがあるので、媒体名でも重複を落とす
      if (seenLinks.has(key) || seenNames.has(s.name)) continue;
      seenLinks.add(key);
      seenNames.add(s.name);
      sources.push(s);
    }
  }
  const union = (key) => [...new Set(group.flatMap((it) => it[key] ?? []))];
  return {
    ...primary,
    pubDate: times.length ? new Date(Math.min(...times)).toISOString() : primary.pubDate,
    // 「前回から新着」の判定用。まとめたうち一番早く拾った時刻
    firstSeen: group.map((it) => it.firstSeen).filter(Boolean).sort()[0] ?? primary.firstSeen ?? null,
    image: primary.image ?? group.find((it) => it.image)?.image ?? null,
    categories: union("categories"),
    deal: primary.deal ?? group.find((it) => it.deal)?.deal ?? null,
    platforms: union("platforms"),
    works: [...new Set([...(primary.works ?? []), ...union("works")])],
    spoiler: group.some((it) => it.spoiler),
    score: Math.max(...group.map((it) => it.score ?? 0)),
    syndicated: group.every((it) => it.syndicated),
    sources,
  };
}

/**
 * 同じニュースをまとめた配列を返す。どの条件で何件まとめたかは dedupeItems.lastStats に入る。
 * kindRank: 代表記事の選び方(小さいほど優先)
 * options: syndicationWindowMs / syndicationSimilarity (filters.json の syndication から渡す)
 */
/**
 * 途中で切れた見出しか(Googleニュース経由で「人気ゾンビサバイバルゲーム『7 Days to」のように届くことがある)。
 * 括弧の開きと閉じの数が合わないものを true にする。「…」で終わる見出しは、あらすじの見出し
 * (「〜は…」)のようにわざと付けているものが多いので、切れているとは見なさない
 */
export function isTruncatedTitle(title) {
  const t = String(title ?? "").trim();
  const pairs = [["『", "』"], ["「", "」"], ["【", "】"], ["（", "）"], ["《", "》"], ["〈", "〉"]];
  return pairs.some(([o, c]) => t.split(o).length > t.split(c).length);
}

export function dedupeItems(items, kindRank = () => 0, options = {}) {
  const syndWindow = options.syndicationWindowMs ?? 72 * 60 * 60 * 1000;
  const syndSim = options.syndicationSimilarity ?? 0.7;
  const parent = items.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const stats = { exact: 0, syndicated: 0, similar: 0 };
  // グループごとのリーダー(最も早い記事)。連鎖の防止に使う
  const leader = items.map((_, i) => i);
  const union = (a, b, kind) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    parent[ra] = rb;
    const la = leader[ra];
    const lb = leader[rb];
    leader[rb] = (timeOf(items[la]) ?? Infinity) < (timeOf(items[lb]) ?? Infinity) ? la : lb;
    stats[kind]++;
  };
  const langOf = (it) => it.lang ?? "ja";
  const norms = items.map((it) => normalizeTitleForCompare(it.title));
  const grams = norms.map((n) => bigrams(n));

  // 1. 見出しの完全一致
  const byTitle = new Map();
  items.forEach((it, i) => {
    if (norms[i].length < EXACT_TITLE_MIN_LENGTH) return;
    const key = langOf(it) + "|" + norms[i];
    if (byTitle.has(key)) union(i, byTitle.get(key), "exact");
    else byTitle.set(key, i);
  });

  // 1'. 途中で切れた見出しは、同じ書き出しで始まる完全な見出しの記事にまとめる
  items.forEach((it, i) => {
    if (!isTruncatedTitle(it.title)) return;
    const head = norms[i];
    if (head.length < 12) return;
    const t = timeOf(it);
    const j = items.findIndex(
      (other, k) =>
        k !== i &&
        langOf(other) === langOf(it) &&
        norms[k].length > head.length &&
        norms[k].startsWith(head) &&
        (t === null || timeOf(other) === null || Math.abs(timeOf(other) - t) <= syndWindow),
    );
    if (j >= 0) union(i, j, "syndicated");
  });

  const dated = items
    .map((item, i) => ({ item, i, t: timeOf(item) }))
    .filter((x) => x.t !== null)
    .sort((a, b) => a.t - b.t);

  // 2. 再配信ポータルの記事は、前後72時間の記事と少し緩めに比べる
  for (let a = 0; a < dated.length; a++) {
    const x = dated[a];
    if (!x.item.syndicated) continue;
    for (let b = a - 1; b >= 0 && x.t - dated[b].t <= syndWindow; b--) {
      const y = dated[b];
      if (langOf(x.item) === langOf(y.item) && jaccard(grams[x.i], grams[y.i]) >= syndSim) union(x.i, y.i, "syndicated");
    }
    for (let b = a + 1; b < dated.length && dated[b].t - x.t <= syndWindow; b++) {
      const y = dated[b];
      if (langOf(x.item) === langOf(y.item) && jaccard(grams[x.i], grams[y.i]) >= syndSim) union(x.i, y.i, "syndicated");
    }
  }

  // 3. 別媒体が同じ発表を報じたもの
  const withoutWorks = (i, works) => {
    let t = norms[i];
    for (const w of works) t = t.split(normalizeTitleForCompare(w)).join("");
    return bigrams(t);
  };
  const similarEnough = (i, j) => {
    const shared = (items[i].works ?? []).filter((w) => (items[j].works ?? []).includes(w));
    if (shared.length === 0) return jaccard(grams[i], grams[j]) >= DEDUPE_SIMILARITY;
    return jaccard(withoutWorks(i, shared), withoutWorks(j, shared)) >= DEDUPE_SIMILARITY_SAME_WORK;
  };
  const nearLeader = (i, j) => {
    const li = leader[find(i)];
    return li === i || jaccard(grams[li], grams[j]) >= DEDUPE_LEADER_SIMILARITY || similarEnough(li, j);
  };
  for (let a = 0; a < dated.length; a++) {
    for (let b = a + 1; b < dated.length && dated[b].t - dated[a].t <= DEDUPE_WINDOW_MS; b++) {
      const x = dated[a];
      const y = dated[b];
      if (langOf(x.item) !== langOf(y.item) || find(x.i) === find(y.i)) continue;
      if (similarEnough(x.i, y.i) && nearLeader(x.i, y.i) && nearLeader(y.i, x.i)) union(x.i, y.i, "similar");
    }
  }

  const groups = new Map();
  items.forEach((item, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(item);
  });
  dedupeItems.lastStats = stats;
  return [...groups.values()].map((g) => mergeGroup(g, kindRank));
}

// ---- 予定(カレンダー)の抽出 --------------------------------------------------
//
// 見出しの「12月10日発売」「10月3日より放送開始」「2027年1月から配信」「本日発売」のような
// 「日付 + 動詞」を拾って、発売日・放送日などの予定にする。
//  - 年が書かれていなければ、記事の日付から見て一番近い将来(45日前まで許す)の年にする
//  - 日付の直後が「まで」「〆」のものは締め切りなので拾わない
//  - 日付と動詞の間に「PV」「ビジュアル」などがあるもの(「12月10日にPV公開」)は予定ではない
//  - 日まで分かれば precision: "day"、月までなら "month"(「2027年1月放送」「10月期」)
// 動詞と除外語は filters.json の schedule で決める。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function jstParts(date) {
  const d = new Date(date.getTime() + JST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * 年の無い日付に年を補う。記事の日付より150日以上前になるときだけ翌年にする
 * (9月の記事の「1月8日放送」は来年、「7月15日に放送された」は今年)
 */
function inferYear(month, day, pub) {
  const p = jstParts(pub);
  let y = p.y;
  const candidate = Date.UTC(y, month - 1, day || 1);
  if (candidate < Date.UTC(p.y, p.m - 1, p.d) - 150 * 86400000) y += 1;
  return y;
}

const DATE_RE =
  /(?:(\d{4})年\s*)?(\d{1,2})月(?:\s*(\d{1,2})日)?(期)?|(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])|(本日)/g;

/**
 * 1つの文から予定を取り出す。pubDate は記事の公開日時(年の補完と「本日」に使う)。
 * 返り値: [{ date: "2026-12-10" | "2026-12", precision: "day" | "month", verb, label }]
 */
export function extractSchedules(text, pubDate, config) {
  const sched = config.schedule;
  if (!sched || !pubDate) return [];
  const pub = new Date(pubDate);
  if (Number.isNaN(pub.getTime())) return [];
  const t = normalizeForMatch(text);
  // 毎週の話数の告知(「第96話 放送」)はカレンダーを埋めてしまうので拾わない
  if ((sched.skipIfMatches ?? []).some((re) => new RegExp(re, "i").test(t))) return [];
  const out = [];
  for (const m of t.matchAll(DATE_RE)) {
    let year;
    let month;
    let day;
    if (m[7]) {
      ({ y: year, m: month, d: day } = jstParts(pub));
    } else if (m[5]) {
      month = Number(m[5]);
      day = Number(m[6]);
    } else {
      year = m[1] ? Number(m[1]) : undefined;
      month = Number(m[2]);
      day = m[3] ? Number(m[3]) : undefined;
      if (m[4]) day = undefined; // 「10月期」は月まで
    }
    if (!month || month > 12 || (day !== undefined && (day < 1 || day > 31))) continue;

    // 「本日」は直後の動詞だけ(「本日限定の…」のような別の意味を拾わない)
    const windowLen = m[7] ? 6 : (sched.window ?? 16);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + windowLen);
    if (/^\s*[（(][^）)]{1,3}[）)]\s*まで|^\s*まで|^\s*〆/.test(after)) continue;

    // 一番手前に出てくる動詞を採用する
    let best = null;
    for (const v of sched.verbs) {
      for (const kw of v.keywords) {
        const i = after.indexOf(normalizeForMatch(kw));
        if (i !== -1 && (best === null || i < best.i)) best = { i, v };
      }
    }
    if (!best) continue;
    // 「放送され」「公開された」「発売した」のような過去の出来事や、「開催中止」「発売延期」は予定ではない
    const verbWord = best.v.keywords.find((kw) => after.startsWith(normalizeForMatch(kw), best.i)) ?? "";
    const rest = after.slice(best.i + normalizeForMatch(verbWord).length);
    if (/^(され|された|した|していた|済み|済|中止|延期|見送)/.test(rest)) continue;
    const between = after.slice(0, best.i);
    if ((sched.excludeBetween ?? []).some((w) => between.includes(normalizeForMatch(w)))) continue;
    if (/[。！？!?]/.test(between)) continue; // 文をまたいだものは別の話

    if (year === undefined) year = inferYear(month, day, pub);
    const precision = day === undefined ? "month" : "day";
    const date = precision === "day" ? `${year}-${pad(month)}-${pad(day)}` : `${year}-${pad(month)}`;
    if (!out.some((e) => e.date === date && e.verb === best.v.id)) {
      out.push({ date, precision, verb: best.v.id, label: best.v.label });
    }
  }
  return out;
}
