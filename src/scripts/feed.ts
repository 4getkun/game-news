// トップページの絞り込みUI。
//
// 収集時のフィルタ(scripts/lib/filter.mjs)で「アニメ関連かどうか」は判定済みなので、
// ここでは「その中から自分が読みたいものを選ぶ」ための絞り込みだけを担当する。
//
//  - URLに載せる(共有できる)条件: キーワード / 機種 / カテゴリ / 期間 / 並び順 / 作品 / 言語
//    (言語は日本語が既定。英語の記事は「すべて」「English」に切り替えたときだけ出す)
//  - 端末に保存する好み: ミュート語 / フォロー作品 / 非表示の媒体 / 表示オプション / 既読
//
// 保存は localStorage。使えない環境(プライベートモード等)でも動作はするよう全て try で囲む。

interface RawItem {
  t: string;
  s: string;
  l: string;
  d: string | null;
  /** このサイトが初めて拾った時刻(「前回から新着」の判定用) */
  fs?: string | null;
  i: string | null;
  src: string;
  sn: string;
  k: string;
  lang: string;
  c: string[];
  /** 機種 */
  p: string[];
  w: string[];
  sp: 0 | 1;
  /** 元記事が見つからず再配信ポータルの記事だけが残っているもの */
  sy?: 0 | 1;
  /** 同じ話題を報じた他の媒体。sy=1 は再配信(転載) */
  x: { n: string; l: string; sy?: 1 }[];
  /** セール・無料配布の記事(s: 店 / o: 最大の割引率 / f: 無料配布) */
  dl?: { s: string[]; o: number | null; f: 0 | 1 };
}

interface Item extends RawItem {
  time: number;
  /** 初めて拾った時刻(ms)。前回の訪問より後なら NEW */
  seen: number;
  haystack: string;
  /** 再配信を除いた、独自に報じた他媒体の数(「話題順」の基準) */
  originals: number;
}

interface Config {
  dataUrl: string;
  generatedAt: string;
  categories: { id: string; label: string; emoji: string; sensitive: boolean }[];
  platforms: { id: string; label: string }[];
  /** セール記事の店(steam / epic / ps / nintendo / xbox / other) */
  stores: { id: string; label: string }[];
  feeds: { id: string; name: string; kind: string; lang: string }[];
  kindLabels: Record<string, string>;
  /** タイトル名 → タイトルページの slug(ページがあるタイトルだけ) */
  workSlugs: Record<string, string>;
  /** サイトのトップの URL(タイトルページへのリンクに使う) */
  baseUrl: string;
}

type Period = "all" | "24h" | "3d" | "7d";

interface State {
  q: string;
  cats: Set<string>;
  plats: Set<string>;
  /** セール・無料配布の記事だけ */
  deal: boolean;
  /** セールの店(deal のときだけ効く) */
  stores: Set<string>;
  period: Period;
  sort: "new" | "hot";
  work: string;
  lang: "all" | "ja" | "en";
  // 端末に保存する好み
  mute: string[];
  follow: string[];
  hiddenSources: Set<string>;
  /** 隠す「見たくない話題」(事件・トラブル / 熱愛・結婚 / 訃報) */
  hiddenTopics: Set<string>;
  onlyFollow: boolean;
  spoilerBlur: boolean;
  hideRead: boolean;
  multiOnly: boolean;
  /** 前回の訪問から後に拾った記事だけ(保存しない) */
  newOnly: boolean;
}

// 最初に描く件数。サーバー側で描く最新30件とそろえ、残りはスクロールに合わせて足す
const PAGE_SIZE = 30;
const MORE_LABEL = "つづきを よむ";
const MORE_LEFT = "のこり";
const PREFS_KEY = "game-news:prefs";
const READ_KEY = "game-news:read";
const READ_MAX = 4000;
// 「前回から新着」: 最後に開いた時刻を localStorage に残す。同じ訪問の中で再読み込みしても
// NEW が消えないよう、訪問の最初に読んだ値を sessionStorage に取っておいてそちらを使う
const LAST_VISIT_KEY = PREFS_KEY.replace(":prefs", ":lastVisit");
const VISIT_BASE_KEY = PREFS_KEY.replace(":prefs", ":visitBase");
const PERIOD_HOURS: Record<Period, number> = { all: Infinity, "24h": 24, "3d": 72, "7d": 168 };

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** 全角英数を半角・大文字を小文字に寄せる(検索とミュートの判定用) */
function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase();
}

function storageGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 保存できなくても表示は続ける */
  }
}

export async function startFeed() {
  const config = JSON.parse($("#app-config").textContent || "{}") as Config;
  const catLabel = Object.fromEntries(config.categories.map((c) => [c.id, c]));
  const platLabel = Object.fromEntries(config.platforms.map((p) => [p.id, p.label]));
  const storeLabel = Object.fromEntries(config.stores.map((st) => [st.id, st.label]));

  const prefs = storageGet(PREFS_KEY, {} as Partial<Record<string, unknown>>);
  const url = new URL(location.href);
  const state: State = {
    q: url.searchParams.get("q") ?? "",
    cats: new Set((url.searchParams.get("cat") ?? "").split(",").filter((c) => c in catLabel)),
    plats: new Set((url.searchParams.get("plat") ?? "").split(",").filter((p) => p in platLabel)),
    deal: url.searchParams.get("deal") === "1" || url.searchParams.has("store"),
    stores: new Set((url.searchParams.get("store") ?? "").split(",").filter((st) => st in storeLabel)),
    period: (["all", "24h", "3d", "7d"].includes(url.searchParams.get("period") ?? "") ? url.searchParams.get("period") : "all") as Period,
    sort: url.searchParams.get("sort") === "hot" ? "hot" : "new",
    work: url.searchParams.get("work") ?? "",
    lang: (["all", "en"].includes(url.searchParams.get("lang") ?? "") ? url.searchParams.get("lang") : "ja") as State["lang"],
    mute: Array.isArray(prefs.mute) ? (prefs.mute as string[]) : [],
    follow: Array.isArray(prefs.follow) ? (prefs.follow as string[]) : [],
    hiddenSources: new Set(Array.isArray(prefs.hiddenSources) ? (prefs.hiddenSources as string[]) : []),
    hiddenTopics: new Set(Array.isArray(prefs.hiddenTopics) ? (prefs.hiddenTopics as string[]) : []),
    onlyFollow: prefs.onlyFollow === true,
    spoilerBlur: prefs.spoilerBlur !== false,
    hideRead: prefs.hideRead === true,
    multiOnly: prefs.multiOnly === true,
    newOnly: url.searchParams.get("new") === "1",
  };
  const readSet = new Set(storageGet<string[]>(READ_KEY, []));
  const visitBase = (() => {
    try {
      let base = sessionStorage.getItem(VISIT_BASE_KEY);
      if (base === null) {
        base = localStorage.getItem(LAST_VISIT_KEY) ?? "";
        sessionStorage.setItem(VISIT_BASE_KEY, base);
      }
      localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
      return Number(base) || 0;
    } catch {
      return 0;
    }
  })();
  const revealed = new Set<string>();

  let items: Item[] = [];
  try {
    const res = await fetch(config.dataUrl);
    const json = (await res.json()) as { items: RawItem[] };
    items = json.items.map((it) => ({
      ...it,
      time: it.d ? Date.parse(it.d) : 0,
      seen: it.fs ? Date.parse(it.fs) : it.d ? Date.parse(it.d) : 0,
      haystack: norm(`${it.t} ${it.s} ${it.w.join(" ")} ${it.sn}`),
      originals: it.x.filter((s) => !s.sy).length,
    }));
  } catch {
    // データが読めない場合はサーバー側で描いた最新30件をそのまま見せる
    $("#hidden-note").textContent = "絞り込み用のデータを読み込めませんでした。再読み込みしてください。";
    return;
  }

  // PC: 絞り込みパネルは中でスクロールさせず(列の間にスクロールバーが出てしまうため)、
  // ページと一緒に流れて、下端が画面の下に来たところで止まるようにする。
  // パネルが画面より短ければ、今まで通りツールバーの下に貼りつく
  const panelEl = $("#panel");
  const wide = matchMedia("(min-width: 961px)");
  function updatePanelTop() {
    if (!wide.matches) {
      panelEl.style.removeProperty("--panel-top");
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const base = parseFloat(css.getPropertyValue("--header-h")) + parseFloat(css.getPropertyValue("--toolbar-h")) + 16;
    const top = Math.min(base, window.innerHeight - panelEl.offsetHeight - 16);
    panelEl.style.setProperty("--panel-top", `${Math.round(top)}px`);
  }
  new ResizeObserver(updatePanelTop).observe(panelEl);
  window.addEventListener("resize", updatePanelTop);
  wide.addEventListener("change", updatePanelTop);
  updatePanelTop();

  const now = Date.now();
  let shown = PAGE_SIZE;
  let lastResult: Item[] = [];

  // ---------------------------------------------------------------- 判定
  function parseQuery(q: string) {
    const include: string[] = [];
    const exclude: string[] = [];
    for (const tok of norm(q).split(/\s+/).filter(Boolean)) {
      if (tok.startsWith("-") && tok.length > 1) exclude.push(tok.slice(1));
      else include.push(tok);
    }
    return { include, exclude };
  }

  /** skip に指定した条件だけを無視して判定する(カテゴリ・媒体の件数表示に使う) */
  function passes(it: Item, skip: "cats" | "sources" | "plats" | "deal" | "stores" | null = null, query = parseQuery(state.q)) {
    if (skip !== "sources" && state.hiddenSources.has(it.src)) return false;
    if (state.lang !== "all" && it.lang !== state.lang) return false;
    const hours = PERIOD_HOURS[state.period];
    if (hours !== Infinity && now - it.time > hours * 3600_000) return false;
    if (skip !== "cats" && state.cats.size > 0 && !it.c.some((c) => state.cats.has(c))) return false;
    if (skip !== "plats" && state.plats.size > 0 && !it.p.some((p) => state.plats.has(p))) return false;
    if (skip !== "deal" && state.deal && !it.dl) return false;
    if (skip !== "deal" && skip !== "stores" && state.deal && state.stores.size > 0 && !it.dl?.s.some((st) => state.stores.has(st))) return false;
    if (state.work && !it.w.includes(state.work)) return false;
    if (state.onlyFollow && state.follow.length > 0 && !it.w.some((w) => state.follow.includes(w))) return false;
    if (state.multiOnly && it.originals === 0) return false;
    if (state.hideRead && readSet.has(it.l)) return false;
    if (state.newOnly && !isNew(it)) return false;
    if (query.include.some((w) => !it.haystack.includes(w))) return false;
    if (query.exclude.some((w) => it.haystack.includes(w))) return false;
    return true;
  }

  /** 前回の訪問より後に拾った記事(初めての訪問では何も NEW にしない) */
  function isNew(it: Item) {
    return visitBase > 0 && it.seen > visitBase;
  }

  function isMuted(it: Item) {
    return state.mute.some((m) => it.haystack.includes(norm(m)));
  }

  function isHiddenTopic(it: Item) {
    return it.c.some((c) => state.hiddenTopics.has(c));
  }

  // ---------------------------------------------------------------- 描画
  const dayFmt = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" });
  const timeFmt = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
  const dayKeyFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" });
  const todayKey = dayKeyFmt.format(new Date());
  const yesterdayKey = dayKeyFmt.format(new Date(Date.now() - 86400_000));

  /** セール記事の札: 無料 > -70% > セール。店が分かれば添える */
  function dealBadge(it: Item) {
    if (!it.dl) return "";
    const what = it.dl.f ? "無料" : it.dl.o ? `-${it.dl.o}%` : "セール";
    const where = it.dl.s.filter((st) => st !== "other").map((st) => storeLabel[st]).join("・");
    return `<button type="button" class="deal-badge${it.dl.f ? " is-free" : ""}" data-deal-tag="${esc(it.dl.s[0] ?? "")}" title="セール記事で絞り込む">${esc(what)}${where ? `<small>${esc(where)}</small>` : ""}</button>`;
  }

  function renderItem(it: Item): string {
    const followed = it.w.some((w) => state.follow.includes(w));
    const guard = state.spoilerBlur && it.sp === 1 && !revealed.has(it.l);
    const classes = ["item", isNew(it) ? "is-new" : "", readSet.has(it.l) ? "is-read" : "", followed ? "is-followed" : "", guard ? "spoiler-guard" : ""]
      .filter(Boolean)
      .join(" ");
    const others = it.x.filter((s) => !s.sy);
    const reposts = it.x.filter((s) => s.sy);
    const link = (s: { n: string; l: string }) =>
      `<a href="${esc(s.l)}" target="_blank" rel="noopener noreferrer" data-read="${esc(it.l)}">${esc(s.n)}</a>`;
    const extra =
      others.length || reposts.length
        ? `<div class="item-extra">${
            others.length
              ? `同じ話題: ${others.slice(0, 6).map(link).join("、")}${others.length > 6 ? ` ほか${others.length - 6}件` : ""}`
              : ""
          }${others.length && reposts.length ? "<br>" : ""}${
            reposts.length ? `<span class="repost">転載: ${reposts.slice(0, 4).map(link).join("、")}</span>` : ""
          }</div>`
        : "";
    const works = it.w
      .slice(0, 3)
      .map((w) => `<button type="button" class="tag tag-work" data-work="${esc(w)}">${esc(w)}</button>`)
      .join("");
    const plats = it.p
      .map((p) => `<button type="button" class="plat" data-tag-plat="${p}">${esc(platLabel[p] ?? p)}</button>`)
      .join("");
    const cats = it.c
      .slice(0, 3)
      .map((c) => `<button type="button" class="tag tag-cat" data-tag-cat="${c}">#${esc(catLabel[c]?.label ?? c)}</button>`)
      .join("");
    return `<article class="${classes}">
      <div class="item-grid cursor-row">
        <time class="item-time" ${it.d ? `datetime="${esc(it.d)}"` : ""}>${it.time ? timeFmt.format(it.time) : ""}</time>
        <div>
          <div class="item-meta">
            ${isNew(it) ? `<span class="new-badge">NEW</span>` : ""}
            ${dealBadge(it)}
            <span class="src"><span class="kind-mark kind-${esc(it.k)}" title="${esc(config.kindLabels[it.k] ?? "")}"></span>${esc(it.sn)}</span>
            ${it.originals ? `<span class="more-src">ほか${it.originals}媒体</span>` : ""}
            ${it.sy ? `<span class="lang" title="元の媒体の記事が見つからなかった再配信記事">転載</span>` : ""}
            ${it.lang === "en" ? `<span class="lang">EN</span>` : ""}
          </div>
          <h3 class="item-title"><a href="${esc(it.l)}" target="_blank" rel="noopener noreferrer" data-read="${esc(it.l)}">${esc(it.t)}</a></h3>
          ${it.s ? `<p class="item-summary">${esc(it.s)}</p>` : ""}
          ${guard ? `<button type="button" class="spoiler-reveal" data-reveal="${esc(it.l)}">ネタバレの可能性あり。タップで表示</button>` : ""}
        </div>
        ${it.i ? `<img class="item-thumb" src="${esc(it.i)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
        ${plats || works || cats ? `<div class="item-tags">${works}${plats || cats ? `<span class="item-cats">${plats}${cats}</span>` : ""}</div>` : ""}
        ${extra}
      </div>
    </article>`;
  }

  function dayLabel(key: string, time: number) {
    const base = dayFmt.format(time);
    if (key === todayKey) return { title: "今日", sub: base };
    if (key === yesterdayKey) return { title: "昨日", sub: base };
    return { title: base, sub: "" };
  }

  /** 日ごとの見出しを付けて記事を並べる。prevKey は直前に描いた日(続きを足すときに同じ日の見出しを重ねないため) */
  function renderGroups(list: Item[], prevKey = ""): { head: string; rest: string; lastKey: string } {
    // head: 直前の日の続き(既存の最後の .day の中に足す分) / rest: 新しい日のまとまり
    let head = "";
    let rest = "";
    let currentKey = prevKey;
    let open = false;
    for (const it of list) {
      const key = it.time ? dayKeyFmt.format(it.time) : "unknown";
      if (key !== currentKey) {
        if (open) rest += "</div>";
        const { title, sub } = key === "unknown" ? { title: "日付不明", sub: "" } : dayLabel(key, it.time);
        rest += `<div class="day"><div class="day-head"><h2>${title}</h2><span>${sub}</span></div>`;
        currentKey = key;
        open = true;
      }
      if (open) rest += renderItem(it);
      else head += renderItem(it);
    }
    if (open) rest += "</div>";
    return { head, rest, lastKey: currentKey };
  }

  let renderedKey = "";
  // 「もっと見る」の先読み: ボタンに近づいたら次の分の HTML を作り、サムネイルを読み始めておく
  let prefetched: { from: number; html: { head: string; rest: string; lastKey: string } } | null = null;

  function nextBatch() {
    const batch = lastResult.slice(shown, shown + PAGE_SIZE);
    return state.sort === "hot" ? { head: batch.map(renderItem).join(""), rest: "", lastKey: renderedKey } : renderGroups(batch, renderedKey);
  }

  function prefetchMore() {
    if (shown >= lastResult.length || prefetched?.from === shown) return;
    prefetched = { from: shown, html: nextBatch() };
    for (const it of lastResult.slice(shown, shown + PAGE_SIZE)) {
      if (it.i) {
        const img = new Image();
        img.referrerPolicy = "no-referrer";
        img.src = it.i;
      }
    }
  }

  function updateMoreButton() {
    const btn = $("#more");
    const left = lastResult.length - shown;
    btn.hidden = left <= 0;
    btn.textContent = `${MORE_LABEL}（${MORE_LEFT}${Math.max(0, left)}件）`;
  }

  /** 「もっと見る」: 次の PAGE_SIZE 件を、いま出ている一覧の下に足す(上の記事は描き直さない) */
  function showMore() {
    const html = prefetched?.from === shown ? prefetched.html : nextBatch();
    prefetched = null;
    const list = $("#feed-list");
    const days = list.querySelectorAll(".day");
    const lastDay = days[days.length - 1];
    if (html.head && lastDay) lastDay.insertAdjacentHTML("beforeend", html.head);
    if (html.rest) list.insertAdjacentHTML("beforeend", html.rest);
    renderedKey = html.lastKey;
    shown += PAGE_SIZE;
    updateMoreButton();
  }

  // 件数(と非表示にした件数)。一覧を描き直すと消えるので、最初の日付の見出しに付け直す
  const countEl = $(".feed-count");

  function renderList() {
    const list = $("#feed-list");
    const slice = lastResult.slice(0, shown);
    prefetched = null;
    if (slice.length === 0) {
      list.innerHTML = `<div class="day"><div class="day-head"><h2>見つかりません</h2></div><div class="empty"><p>条件に合うニュースはありません。</p><button type="button" class="btn btn-solid" id="reset-all">絞り込みをすべて解除</button></div></div>`;
      list.querySelector(".day-head")!.append(countEl);
      $("#more").hidden = true;
      return;
    }
    if (state.sort === "hot") {
      list.innerHTML = `<div class="day"><div class="day-head"><h2>話題順</h2><span>報じた媒体の数が多い順</span></div>${slice.map(renderItem).join("")}</div>`;
      renderedKey = "";
    } else {
      const g = renderGroups(slice);
      list.innerHTML = g.rest;
      renderedKey = g.lastKey;
    }
    list.querySelector(".day-head")!.append(countEl);
    updateMoreButton();
  }

  function renderCounts(query: ReturnType<typeof parseQuery>) {
    const catCounts = new Map<string, number>();
    const srcCounts = new Map<string, number>();
    const platCounts = new Map<string, number>();
    const storeCounts = new Map<string, number>();
    let dealCount = 0;
    for (const it of items) {
      if (isMuted(it) || isHiddenTopic(it)) continue;
      if (it.dl && passes(it, "deal", query)) dealCount++;
      if (it.dl && passes(it, "stores", query)) for (const st of it.dl.s) storeCounts.set(st, (storeCounts.get(st) ?? 0) + 1);
      if (passes(it, "cats", query)) for (const c of it.c) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
      if (passes(it, "sources", query)) srcCounts.set(it.src, (srcCounts.get(it.src) ?? 0) + 1);
      if (passes(it, "plats", query)) for (const p of it.p) platCounts.set(p, (platCounts.get(p) ?? 0) + 1);
    }
    document.querySelectorAll<HTMLButtonElement>("#cat-chips [data-cat]").forEach((btn) => {
      const n = catCounts.get(btn.dataset.cat!) ?? 0;
      btn.querySelector(".count")!.textContent = String(n);
      btn.setAttribute("aria-pressed", String(state.cats.has(btn.dataset.cat!)));
      btn.classList.toggle("is-empty", n === 0);
    });
    document.querySelectorAll<HTMLButtonElement>("#plat-menu [data-plat]").forEach((btn) => {
      const n = platCounts.get(btn.dataset.plat!) ?? 0;
      btn.querySelector(".count")!.textContent = String(n);
      btn.setAttribute("aria-pressed", String(state.plats.has(btn.dataset.plat!)));
      btn.classList.toggle("is-empty", n === 0);
    });
    document.querySelectorAll<HTMLButtonElement>("#store-menu [data-store]").forEach((btn) => {
      const n = storeCounts.get(btn.dataset.store!) ?? 0;
      btn.querySelector(".count")!.textContent = String(n);
      btn.setAttribute("aria-pressed", String(state.deal && state.stores.has(btn.dataset.store!)));
      btn.classList.toggle("is-empty", n === 0);
    });
    document.querySelectorAll<HTMLButtonElement>("[data-deal-toggle]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(state.deal));
      const c = btn.querySelector(".deal-count");
      if (c) c.textContent = String(dealCount);
    });
    document.querySelectorAll<HTMLInputElement>("#source-list [data-source]").forEach((input) => {
      input.checked = !state.hiddenSources.has(input.dataset.source!);
      input.closest("label")!.querySelector(".count")!.textContent = String(srcCounts.get(input.dataset.source!) ?? 0);
    });
  }

  function renderControls() {
    $<HTMLInputElement>("#q").value = state.q;
    const setSeg = (id: string, value: string) =>
      document.querySelectorAll<HTMLButtonElement>(`#${id} button`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === value)));
    setSeg("period", state.period);
    setSeg("sort", state.sort);
    setSeg("lang", state.lang);
    const newBtn = document.getElementById("new-only");
    if (newBtn) {
      const n = items.filter((it) => isNew(it) && it.lang === "ja").length;
      newBtn.hidden = visitBase === 0 || n === 0;
      newBtn.setAttribute("aria-pressed", String(state.newOnly));
      newBtn.querySelector(".new-count")!.textContent = String(n);
    }
    $<HTMLInputElement>("#only-follow").checked = state.onlyFollow;
    $<HTMLInputElement>("#spoiler-blur").checked = state.spoilerBlur;
    $<HTMLInputElement>("#hide-read").checked = state.hideRead;
    $<HTMLInputElement>("#multi-only").checked = state.multiOnly;
    document.querySelectorAll<HTMLInputElement>("[data-hide-topic]").forEach((input) => {
      input.checked = state.hiddenTopics.has(input.dataset.hideTopic!);
    });

    $("#mute-list").innerHTML = state.mute
      .map((m) => `<button type="button" class="chip" data-unmute="${esc(m)}" aria-label="${esc(m)} のミュートを解除">${esc(m)}</button>`)
      .join("");
    $("#follow-list").innerHTML = state.follow.length
      ? state.follow
          .map((w) => `<button type="button" class="chip" data-work="${esc(w)}" aria-pressed="${state.work === w}">★ ${esc(w)}</button>`)
          .join("")
      : "";

    // 作品バナー(作品で絞り込んでいるとき)
    const banner = $("#work-banner");
    if (state.work) {
      const following = state.follow.includes(state.work);
      banner.innerHTML = `<div class="work-banner"><h2>${esc(state.work)}</h2>
        ${config.workSlugs[state.work] ? `<a class="chip" href="${config.baseUrl}work/${encodeURIComponent(config.workSlugs[state.work])}/">タイトルページ</a>` : ""}
        <button type="button" class="chip" data-toggle-follow="${esc(state.work)}" aria-pressed="${following}">${following ? "★ フォロー中" : "☆ フォローする"}</button>
        <button type="button" class="chip" data-clear="work">タイトルの絞り込みを解除</button></div>`;
    } else {
      banner.innerHTML = "";
    }

    // 選択中の条件
    const active: string[] = [];
    if (state.q) active.push(`<button type="button" class="chip" data-clear="q">「${esc(state.q)}」</button>`);
    if (state.deal) active.push(`<button type="button" class="chip" data-clear="deal">セール・無料${state.stores.size ? `（${[...state.stores].map((st) => storeLabel[st]).join("・")}）` : ""}</button>`);
    for (const p of state.plats) active.push(`<button type="button" class="chip" data-plat="${p}">${esc(platLabel[p])}</button>`);
    for (const c of state.cats) active.push(`<button type="button" class="chip" data-cat="${c}">${esc(catLabel[c].label)}</button>`);
    if (state.period !== "all") active.push(`<button type="button" class="chip" data-clear="period">${{ "24h": "24時間以内", "3d": "3日以内", "7d": "7日以内" }[state.period]}</button>`);
    if (state.lang === "en") active.push(`<button type="button" class="chip" data-clear="lang">Englishのみ</button>`);
    if (state.onlyFollow) active.push(`<button type="button" class="chip" data-clear="onlyFollow">フォロー中のタイトルのみ</button>`);
    if (state.newOnly) active.push(`<button type="button" class="chip" data-clear="newOnly">前回から新着のみ</button>`);
    if (state.multiOnly) active.push(`<button type="button" class="chip" data-clear="multiOnly">複数媒体の話題のみ</button>`);
    if (state.hiddenSources.size) active.push(`<button type="button" class="chip" data-clear="sources">${state.hiddenSources.size}媒体を非表示中</button>`);
    $("#active-filters").innerHTML = active.join("");
    const badge = active.length + (state.work ? 1 : 0);
    $("#filter-badge").textContent = badge ? `（${badge}）` : "";
  }

  // 折りたたみ(媒体・ミュート・言語)の見出しの横に、いまの設定を短く出す
  function renderFoldNotes() {
    const set = (id: string, text: string) => {
      const el = document.getElementById(`${id}-note`);
      if (el) el.textContent = text;
    };
    set("sources", state.hiddenSources.size ? `${state.hiddenSources.size}媒体を非表示中` : "");
    set("mute", state.mute.length ? `${state.mute.length}語` : "");
    set("lang", state.lang === "ja" ? "" : state.lang === "en" ? "English のみ" : "すべて");
  }

  function apply({ resetPage = true } = {}) {
    if (resetPage) shown = PAGE_SIZE;
    const query = parseQuery(state.q);
    let muted = 0;
    let hiddenByTopic = 0;
    const result: Item[] = [];
    for (const it of items) {
      if (!passes(it, null, query)) continue;
      if (isHiddenTopic(it)) {
        hiddenByTopic++;
        continue;
      }
      if (isMuted(it)) {
        muted++;
        continue;
      }
      result.push(it);
    }
    if (state.sort === "hot") {
      result.sort((a, b) => b.originals - a.originals || b.time - a.time);
    }
    lastResult = result;
    $("#result-count").textContent = String(result.length);
    $("#hidden-note").textContent = [
      hiddenByTopic ? `見たくない話題を${hiddenByTopic}件非表示` : "",
      muted ? `ミュートで${muted}件を非表示` : "",
    ]
      .filter(Boolean)
      .join(" / ");
    renderControls();
    renderFoldNotes();
    renderCounts(query);
    updatePanelTop();
    renderList();
    syncUrl();
    savePrefs();
  }

  function syncUrl() {
    const u = new URL(location.href);
    const set = (k: string, v: string, def = "") => (v && v !== def ? u.searchParams.set(k, v) : u.searchParams.delete(k));
    set("q", state.q);
    set("cat", [...state.cats].join(","));
    set("plat", [...state.plats].join(","));
    set("deal", state.deal && state.stores.size === 0 ? "1" : "");
    set("store", state.deal ? [...state.stores].join(",") : "");
    set("period", state.period, "all");
    set("sort", state.sort, "new");
    set("work", state.work);
    set("lang", state.lang, "ja");
    set("new", state.newOnly ? "1" : "");
    if (u.href !== location.href) history.replaceState(null, "", u);
  }

  function savePrefs() {
    storageSet(PREFS_KEY, {
      mute: state.mute,
      follow: state.follow,
      hiddenSources: [...state.hiddenSources],
      hiddenTopics: [...state.hiddenTopics],
      onlyFollow: state.onlyFollow,
      spoilerBlur: state.spoilerBlur,
      hideRead: state.hideRead,
      multiOnly: state.multiOnly,
    });
  }

  function markRead(link: string) {
    readSet.add(link);
    const arr = [...readSet];
    storageSet(READ_KEY, arr.slice(Math.max(0, arr.length - READ_MAX)));
  }

  function resetAll() {
    Object.assign(state, { q: "", period: "all", sort: "new", work: "", lang: "ja", onlyFollow: false, multiOnly: false, hideRead: false, newOnly: false });
    state.cats.clear();
    state.plats.clear();
    state.deal = false;
    state.stores.clear();
    state.hiddenSources.clear();
    apply();
  }

  function setWork(work: string) {
    state.work = state.work === work ? "" : work;
    apply();
    closePanel();
    document.getElementById("feed")?.scrollIntoView({ behavior: "smooth" });
  }

  // ---------------------------------------------------------------- 操作
  let qTimer = 0;
  $<HTMLInputElement>("#q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = window.setTimeout(() => {
      state.q = (e.target as HTMLInputElement).value.trim();
      apply();
    }, 180);
  });

  const segment = (id: string, key: "period" | "sort" | "lang") =>
    $(`#${id}`).addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
      if (!btn) return;
      (state as unknown as Record<string, string>)[key] = btn.dataset.value!;
      apply();
    });
  segment("period", "period");
  segment("sort", "sort");
  segment("lang", "lang");

  const toggle = (id: string, key: "onlyFollow" | "spoilerBlur" | "hideRead" | "multiOnly") =>
    $<HTMLInputElement>(`#${id}`).addEventListener("change", (e) => {
      state[key] = (e.target as HTMLInputElement).checked;
      apply();
    });
  toggle("only-follow", "onlyFollow");
  toggle("spoiler-blur", "spoilerBlur");
  toggle("hide-read", "hideRead");
  toggle("multi-only", "multiOnly");

  document.querySelectorAll<HTMLInputElement>("[data-hide-topic]").forEach((input) =>
    input.addEventListener("change", () => {
      const id = input.dataset.hideTopic!;
      if (input.checked) state.hiddenTopics.add(id);
      else state.hiddenTopics.delete(id);
      apply({ resetPage: false });
    }),
  );

  $("#source-list").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const id = input.dataset.source;
    if (!id) return;
    if (input.checked) state.hiddenSources.delete(id);
    else state.hiddenSources.add(id);
    apply();
  });

  $("#mute-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>("#mute-input");
    const word = input.value.trim();
    if (word && !state.mute.includes(word)) state.mute.push(word);
    input.value = "";
    apply();
  });

  // ボタン類はまとめてイベント委譲で扱う(一覧は描き直すたびに中身が入れ替わるため)
  document.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const read = el.closest<HTMLAnchorElement>("a[data-read]");
    if (read) {
      markRead(read.dataset.read!);
      read.closest(".item")?.classList.add("is-read");
      return;
    }
    const btn = el.closest<HTMLElement>("button, a[data-work-link], a[data-plat-link]");
    if (!btn) return;
    const d = btn.dataset;
    if (d.workLink) {
      e.preventDefault();
      setWork(d.workLink);
    } else if (d.work) {
      setWork(d.work);
    } else if (d.platLink) {
      e.preventDefault();
      state.plats = new Set([d.platLink]);
      apply();
      document.getElementById("feed")?.scrollIntoView({ behavior: "smooth" });
    } else if (d.plat) {
      if (state.plats.has(d.plat)) state.plats.delete(d.plat);
      else state.plats.add(d.plat);
      apply();
    } else if (d.tagPlat) {
      state.plats = new Set([d.tagPlat]);
      apply();
    } else if (d.dealToggle !== undefined) {
      state.deal = !state.deal;
      if (!state.deal) state.stores.clear();
      apply();
    } else if (d.store) {
      // 店は「セールの中で絞る」もの。押したらセールの絞り込みも入れる
      if (state.deal && state.stores.has(d.store)) state.stores.delete(d.store);
      else state.stores.add(d.store);
      state.deal = true;
      apply();
    } else if (d.dealTag !== undefined) {
      state.deal = true;
      state.stores = new Set(d.dealTag && d.dealTag !== "other" ? [d.dealTag] : []);
      apply();
    } else if (d.cat) {
      if (state.cats.has(d.cat)) state.cats.delete(d.cat);
      else state.cats.add(d.cat);
      apply();
    } else if (d.tagCat) {
      state.cats = new Set([d.tagCat]);
      apply();
    } else if (d.unmute) {
      state.mute = state.mute.filter((m) => m !== d.unmute);
      apply({ resetPage: false });
    } else if (d.toggleFollow) {
      const w = d.toggleFollow;
      state.follow = state.follow.includes(w) ? state.follow.filter((x) => x !== w) : [...state.follow, w];
      apply({ resetPage: false });
    } else if (d.reveal) {
      revealed.add(d.reveal);
      renderList();
    } else if (d.clear) {
      const k = d.clear;
      if (k === "q") state.q = "";
      else if (k === "cats") state.cats.clear();
      else if (k === "plats") state.plats.clear();
      else if (k === "deal") {
        state.deal = false;
        state.stores.clear();
      } else if (k === "stores") state.stores.clear();
      else if (k === "period") state.period = "all";
      else if (k === "lang") state.lang = "ja";
      else if (k === "work") state.work = "";
      else if (k === "onlyFollow") state.onlyFollow = false;
      else if (k === "multiOnly") state.multiOnly = false;
      else if (k === "newOnly") state.newOnly = false;
      else if (k === "sources") state.hiddenSources.clear();
      apply();
    } else if (btn.id === "new-only") {
      state.newOnly = !state.newOnly;
      apply();
    } else if (btn.id === "reset-all") {
      resetAll();
    } else if (btn.id === "more") {
      showMore();
    }
  });

  // 続きはボタンを押したときだけ出す。ボタンまであと1000px ほどになったら、次の分を先に作っておく
  // (HTML の組み立てとサムネイルの読み込み)。押したときにすぐ出せる
  const moreBtn = $("#more");
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting) && !moreBtn.hidden) prefetchMore();
    }, { rootMargin: "1000px" }).observe(moreBtn);
  }
  moreBtn.addEventListener("pointerenter", prefetchMore);
  moreBtn.addEventListener("focus", prefetchMore);

  // 折りたたみの開閉を端末に覚えておく(最初は閉じている)
  const FOLD_KEY = PREFS_KEY.replace(":prefs", ":folds");
  const foldState = storageGet<Record<string, boolean>>(FOLD_KEY, {});
  document.querySelectorAll<HTMLDetailsElement>("details.fold").forEach((d) => {
    if (foldState[d.dataset.fold!]) d.open = true;
    d.addEventListener("toggle", () => {
      foldState[d.dataset.fold!] = d.open;
      storageSet(FOLD_KEY, foldState);
      updatePanelTop();
    });
  });


  // スマホ: 絞り込みパネルを下から出す
  const panel = $("#panel");
  const scrim = $("#scrim");
  const openBtn = $("#filter-open");
  function openPanel() {
    panel.classList.add("is-open");
    scrim.hidden = false;
    openBtn.setAttribute("aria-expanded", "true");
    $<HTMLButtonElement>("#filter-close").focus();
  }
  function closePanel() {
    if (!panel.classList.contains("is-open")) return;
    panel.classList.remove("is-open");
    scrim.hidden = true;
    openBtn.setAttribute("aria-expanded", "false");
    openBtn.focus();
  }
  openBtn.addEventListener("click", openPanel);
  $("#filter-close").addEventListener("click", closePanel);
  scrim.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
    // 「/」で検索欄へ(入力中は除く)
    if (e.key === "/" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      $<HTMLInputElement>("#q").focus();
    }
  });

  apply();
}
