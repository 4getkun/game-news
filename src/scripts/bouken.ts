// 「ぼうけんのしょ」: ここまで読んだ、の栞(しおり)。ドラクエのセーブ画面のような黒いウィンドウで出す。
//
//  - 一覧は1日の中を 0時→24時 の順に並べているので、上から下へ読むと時刻が進む。
//    栞は「この記事の時刻までは読んだ」という印。その記事のすぐ下に「ここまで よんだ」の帯をはさみ、
//    それより前の記事は薄く、後の記事(記録の後に届いた記事も)は「みどく」として普通に出す
//  - 記録のしかた: 自動(ページを離れるとき、今回いちばん下まで読んだ記事。前の栞より深いときだけ上書き)
//    と手動(一覧まで下りると右下に出る「しおりを はさむ」。画面のまん中の記事に栞をはさむ)
//  - レベル: 訪れた日(日本時間の日付で1日1回)ごとに けいけんち 100。必要なけいけんちは RPG のように
//    べき関数で増える(最初はすぐ上がり、だんだんゆっくり)。上がった日は「レベルが あがった！」
//  - きょうゆう: X に投稿(ハッシュタグ #ゲームニュース全部)。共有する URL は /share/lv◯/ で、そのページの
//    og:image(レベルごとのカード。tools/make-share-cards.py)が投稿に埋め込まれる。画像の保存/共有も
//  - 冊数は1冊、置き場所はこの端末(localStorage)。3冊・ふっかつのじゅもん は使ってみてから
//  - 並び順が「話題順」のときは帯を出さない(時刻の並びではないため)

import { tone, soundEnabled } from "./message-window";

const KEY = "game-news:bouken";
const DISMISS_KEY = "game-news:bouken-dismissed";
const VISITS_KEY = "game-news:visits";

const SITE_NAME = "ゲームニュース全部";
const SITE_URL = "https://fourgetkun.com/game-news/";
/** 訪れた1日あたりのけいけんち */
const EXP_PER_DAY = 100;
/** レベル L になるのに要る けいけんちの合計(RPG のべき関数)。L2: 20, L3: 74, L5: 278, L10: 1300, L20: 5300 …
 *  1日目で レベル3、3日目で 5、1週間で 7、1か月で 15、100日で 27 くらい */
const expForLevel = (level: number) => Math.floor(20 * Math.pow(level - 1, 1.9));
function levelOf(days: number) {
  const exp = days * EXP_PER_DAY;
  let level = 1;
  while (expForLevel(level + 1) <= exp) level++;
  return { level, exp, next: expForLevel(level + 1) - exp };
}
/** レベルに応じた しょうごう */
function titleOf(level: number) {
  if (level >= 50) return "でんせつの ゲーマー";
  if (level >= 35) return "ゲームの けんじゃ";
  if (level >= 25) return "ゲーム ものしり";
  if (level >= 15) return "ベテラン ゲーマー";
  if (level >= 8) return "いちにんまえ ゲーマー";
  if (level >= 4) return "かけだし ゲーマー";
  return "みならい ゲーマー";
}

/** 今日(日本時間)を訪問日に加え、訪問日数と「今日レベルが上がったか」を返す */
function recordVisit(): { days: number; levelUp: boolean } {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  try {
    const list = JSON.parse(localStorage.getItem(VISITS_KEY) ?? "[]") as string[];
    if (list.includes(today)) return { days: list.length, levelUp: false };
    const before = list.length ? levelOf(list.length).level : 1;
    list.push(today);
    localStorage.setItem(VISITS_KEY, JSON.stringify(list.slice(-3000)));
    return { days: list.length, levelUp: levelOf(list.length).level > before };
  } catch {
    return { days: 1, levelUp: false };
  }
}

interface Save {
  /** 栞をはさんだ記事 */
  link: string;
  /** その記事の時刻(ms)。これより古い記事が「つづき」 */
  t: number;
  /** (以前の版の名残。使っていない) */
  top?: number;
  /** 記録した時刻(ms) */
  at: number;
}

interface Entry {
  l: string;
  time: number;
}

function load(): Save | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Save | null;
    return s && typeof s.t === "number" ? s : null;
  } catch {
    return null;
  }
}

function store(s: Save | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* 保存できなくても表示は続ける */
  }
}

const fmt = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });

/** 「きろくしました」の効果音(ドラクエのセーブのような上り3音) */
function saveSound() {
  if (!soundEnabled()) return;
  [784, 988, 1175].forEach((f, i) => tone(f, i === 2 ? 0.2 : 0.07, i * 0.08, 0.04));
}

export function setupBouken(deps: {
  /** 一覧(#feed-list) */
  list: HTMLElement;
  /** ぼうけんのしょのウィンドウを入れる場所 */
  win: HTMLElement;
  /** いまの絞り込み結果(並び順どおり) */
  result: () => Entry[];
  /** 読んだ(開いた)記事の数(じまん用) */
  readCount: () => number;
  /** 新着順か(帯は新着順のときだけ) */
  sortNew: () => boolean;
  /** index 番目の記事まで一覧に出す(「つづきから」で栞の位置まで描く) */
  revealUntil: (index: number) => void;
}) {
  let save = load();
  let confirming = false;
  let dismissed = false;
  try {
    dismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {}

  const visit = recordVisit();

  // ---------------------------------------------------------------- 帯と既読の薄表示
  const linkOf = (el: Element) => el.querySelector<HTMLAnchorElement>(".item-title a")?.getAttribute("href") ?? "";

  /** 栞より後(みどく)の記事。同じ時刻の記事は、一覧で栞の記事より後にあるものだけ */
  function unread(result: Entry[]) {
    if (!save) return result;
    return result.filter((e) => e.time > save!.t);
  }

  function placeMarker() {
    deps.list.querySelector(".bm-divider")?.remove();
    const items = [...deps.list.querySelectorAll<HTMLElement>(".item[data-t]")];
    items.forEach((el) => el.classList.remove("is-past"));
    if (!save || !deps.sortNew()) return;
    const marker = `<div class="bm-divider" role="separator" aria-label="ここまで読んだ">ここまで よんだ ─ ${fmt.format(save.at)}</div>`;
    // 栞の記事が一覧にあればそのすぐ下。無ければ(絞り込みで外れたなど)、栞の時刻までで最後の記事の下
    const anchor = items.find((el) => linkOf(el) === save!.link);
    let passedAnchor = false;
    let last: HTMLElement | null = null;
    for (const el of items) {
      const t = Number(el.dataset.t);
      // 同じ時刻の記事がいくつもあるので、栞と同じ時刻のものは一覧で栞より前にあるものだけ既読にする
      const read = t < save.t || (t === save.t && (!anchor || !passedAnchor));
      if (el === anchor) passedAnchor = true;
      if (read) {
        el.classList.add("is-past");
        if (!last || t >= Number(last.dataset.t)) last = el;
      }
    }
    (anchor ?? last)?.insertAdjacentHTML("afterend", marker);
  }

  // ---------------------------------------------------------------- ウィンドウ
  function renderWindow() {
    // 栞が無くても、2日目からはレベルとじまんのために出す
    if ((!save && visit.days < 2) || dismissed || !deps.sortNew()) {
      deps.win.hidden = true;
      deps.win.innerHTML = "";
      return;
    }
    const result = deps.result();
    const { level, exp, next } = levelOf(visit.days);
    let restLine = "";
    let rest = 0;
    if (save) {
      rest = unread(result).length;
      restLine = `<div class="bk-stats"><span>みどく ${rest}けん</span></div>`;
    }
    deps.win.hidden = false;
    const cmd = (id: string, label: string, note = "") =>
      `<button type="button" class="bk-cmd" data-bouken="${id}"><span class="bk-cur" aria-hidden="true">▶</span><span>${label}</span><span class="bk-note">${note}</span></button>`;
    const main = save
      ? `${rest > 0 ? cmd("continue", "つづきから", "しおりの ところへ") : `<p class="bk-ask">つづきは もう ありません。</p>`}${cmd("top", "とじる")}`
      : cmd("top", "とじる");
    deps.win.innerHTML = `<section class="bk-win" aria-label="ぼうけんのしょ">
      <span class="bk-title">ぼうけんのしょ</span>
      <div class="bk-head"><span>ぼうけんのしょ 1</span><span>${save ? fmt.format(save.at) : "しおり なし"}</span></div>
      <div class="bk-level"><span class="bk-lv">レベル ${level}</span><span>${titleOf(level)}</span></div>
      <div class="bk-stats"><span>E ${exp}</span><span>つぎの レベルまで ${next}</span><span>ほうもん ${visit.days}にち</span><span>よんだ ${deps.readCount()}けん</span></div>
      ${restLine}
      <div class="bk-cmds">${
        confirming
          ? `<p class="bk-ask">ほんとうに ぼうけんのしょを けしますか？</p>${cmd("erase-yes", "はい")}${cmd("erase-no", "いいえ")}`
          : `${main}${cmd("share-x", "Xで きょうゆう", "カードつき #" + SITE_NAME)}${cmd("share-image", "がぞうで ほぞん", "ぼうけんのしょの カード")}${save ? cmd("erase", "ぼうけんのしょを けす") : ""}`
      }</div>
    </section>`;
  }

  // ---------------------------------------------------------------- じまん
  function shareText() {
    const { level } = levelOf(visit.days);
    return `ぼうけんのしょ 1\nレベル ${level}「${titleOf(level)}」\nほうもん ${visit.days}にち／よんだ ${deps.readCount()}けん`;
  }

  function shareToX() {
    const u = new URL("https://x.com/intent/post");
    u.searchParams.set("text", shareText());
    // レベルごとの共有ページ。そのページの og:image(レベルのカード)が投稿に埋め込まれる
    u.searchParams.set("url", `${SITE_URL}share/lv${Math.min(levelOf(visit.days).level, 99)}/`);
    u.searchParams.set("hashtags", SITE_NAME);
    window.open(u.toString(), "_blank", "noopener,noreferrer");
  }

  /** ぼうけんのしょを 1200×630 の画像にする(黒地に白枠、ドット書体) */
  async function drawCard(): Promise<Blob | null> {
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-pixel").trim() || "monospace";
    try {
      await document.fonts.load(`40px ${font}`, "ぼうけんのしょレベル");
    } catch {}
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 630;
    const g = c.getContext("2d");
    if (!g) return null;
    const { level, exp, next } = levelOf(visit.days);
    g.fillStyle = "#070b24";
    g.fillRect(0, 0, 1200, 630);
    // ウィンドウ(黒地・白の太枠)
    g.fillStyle = "#000";
    g.fillRect(60, 70, 1080, 490);
    g.strokeStyle = "#fff";
    g.lineWidth = 10;
    g.strokeRect(65, 75, 1070, 480);
    // 見出しのタブ
    g.fillStyle = "#000";
    g.fillRect(100, 48, 270, 50);
    g.lineWidth = 6;
    g.strokeRect(100, 48, 270, 50);
    g.fillStyle = "#fff";
    g.textBaseline = "middle";
    g.font = `30px ${font}`;
    g.fillText("ぼうけんのしょ", 122, 74);
    g.font = `36px ${font}`;
    g.fillText("ぼうけんのしょ 1", 120, 160);
    g.font = `72px ${font}`;
    g.fillText(`レベル ${level}`, 120, 265);
    g.font = `44px ${font}`;
    g.fillText(titleOf(level), 120, 350);
    g.font = `32px ${font}`;
    g.fillText(`ほうもん ${visit.days}にち　よんだ ${deps.readCount()}けん`, 120, 430);
    g.fillText(`E ${exp}　つぎの レベルまで ${next}`, 120, 485);
    g.font = `28px ${font}`;
    g.fillStyle = "#ffd84a";
    g.textAlign = "right";
    g.fillText(`#${SITE_NAME}`, 1100, 160);
    g.fillStyle = "#aab4e6";
    g.fillText("fourgetkun.com/game-news/", 1140, 600);
    return new Promise((r) => c.toBlob(r, "image/png"));
  }

  async function shareImage() {
    const blob = await drawCard();
    if (!blob) return;
    const file = new File([blob], "bouken-no-sho.png", { type: "image/png" });
    // スマホなどで画像ごと共有できるなら、共有シートを開く(X に画像つきで投稿できる)
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: `${shareText()}\n#${SITE_NAME} ${SITE_URL}` });
      } catch {
        /* 取り消されたときは何もしない */
      }
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bouken-no-sho.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("ぼうけんのしょの がぞうを ほぞんしました。");
  }

  // ---------------------------------------------------------------- 記録
  let toastTimer = 0;
  function toast(text: string) {
    let el = document.querySelector<HTMLElement>(".bk-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "bk-toast";
      el.setAttribute("role", "status");
      document.body.append(el);
    }
    const box = el;
    clearInterval(toastTimer);
    box.hidden = false;
    box.textContent = "";
    const chars = Array.from(text);
    let n = 0;
    toastTimer = window.setInterval(() => {
      box.textContent = chars.slice(0, ++n).join("");
      if (n >= chars.length) {
        clearInterval(toastTimer);
        toastTimer = window.setTimeout(() => (box.hidden = true), 2200);
      }
    }, 35);
  }

  function saveAt(link: string, t: number, manual: boolean) {
    save = { link, t, top: t, at: Date.now() };
    store(save);
    confirming = false;
    dismissed = false;
    try {
      sessionStorage.removeItem(DISMISS_KEY);
    } catch {}
    if (manual) {
      placeMarker();
      renderWindow();
      saveSound();
      toast("ぼうけんのしょ 1に きろくしました。");
    }
  }

  // 自動の記録: 今回の訪問でいちばん下まで読んだ記事(画面のまん中を通り過ぎた記事)を覚えておき、
  // ページを離れるときに、前の栞より深ければ記録する
  let deepest: { link: string; t: number; index: number; pos: number } | null = null;
  let scrollTimer = 0;
  /** 画面のまん中にある記事(いま読んでいるところ) */
  const currentItem = () => {
    const box = deps.list.getBoundingClientRect();
    const el = document.elementFromPoint(box.left + Math.min(80, box.width / 2), window.innerHeight / 2)?.closest<HTMLElement>(".item[data-t]");
    if (!el || !deps.list.contains(el)) return null;
    const link = linkOf(el);
    const pos = [...deps.list.querySelectorAll(".item[data-t]")].indexOf(el);
    return { link, t: Number(el.dataset.t), index: deps.result().findIndex((e) => e.l === link), pos };
  };

  // 手動の記録: 記事ごとのボタンは一覧が騒がしくなるので、一覧まで下りたときだけ右下に1つ出す
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "bk-fab";
  fab.hidden = true;
  fab.innerHTML = `<span class="bk-cur" aria-hidden="true">▶</span>しおりを はさむ`;
  fab.title = "画面のまん中の記事までを「ここまで よんだ」として、ぼうけんのしょに記録します";
  document.body.append(fab);
  fab.addEventListener("click", () => {
    const cur = currentItem();
    if (cur && cur.index >= 0) saveAt(cur.link, cur.t, true);
  });
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTimer) return;
      scrollTimer = window.setTimeout(() => {
        scrollTimer = 0;
        const cur = currentItem();
        // 一覧の3件目より下にいるときだけ「しおりを はさむ」を出す
        fab.hidden = !cur || cur.pos < 2 || !deps.sortNew();
        // 読み進めた位置 = 画面のまん中を通った記事のうち、いちばん新しい時刻のもの
        if (cur && cur.index >= 0 && cur.pos >= 2 && (!deepest || cur.t > deepest.t)) deepest = cur;
      }, 250);
    },
    { passive: true },
  );
  const autoSave = () => {
    if (!deepest || !deps.sortNew()) return;
    // 前の栞より先(新しい時刻)まで読んだときだけ上書きする
    if (save && deepest.t <= save.t) return;
    saveAt(deepest.link, deepest.t, false);
  };
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && autoSave());
  window.addEventListener("pagehide", autoSave);

  // ---------------------------------------------------------------- 操作
  document.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const btn = el.closest<HTMLElement>("[data-bouken]");
    if (!btn) return;
    const cmd = btn.dataset.bouken;
    if (cmd === "continue" && save) {
      const result = deps.result();
      const next = unread(result).reduce<Entry | null>((m, e) => (!m || e.time < m.time ? e : m), null);
      if (!next) return;
      deps.revealUntil(result.indexOf(next));
      if (soundEnabled()) [523, 659, 784].forEach((f, i) => tone(f, 0.08, i * 0.07, 0.04));
      // 記事は画面外だと高さを見積もりで描いている(content-visibility)ので、なめらかに動かすと
      // 途中で位置がずれて止まる。一度に飛んでから、描き終わった後にもう一度合わせる
      const target = () =>
        [...deps.list.querySelectorAll<HTMLElement>(".item[data-t]")].find((el) => linkOf(el) === next.l) ??
        deps.list.querySelector<HTMLElement>(".bm-divider");
      const jump = () => target()?.scrollIntoView({ block: "center" });
      jump();
      requestAnimationFrame(() => requestAnimationFrame(jump));
      setTimeout(jump, 300);
    } else if (cmd === "share-x") {
      shareToX();
    } else if (cmd === "share-image") {
      void shareImage();
    } else if (cmd === "top") {
      dismissed = true;
      try {
        sessionStorage.setItem(DISMISS_KEY, "1");
      } catch {}
      renderWindow();
    } else if (cmd === "erase") {
      confirming = true;
      renderWindow();
      deps.win.querySelector<HTMLElement>('[data-bouken="erase-no"]')?.focus();
    } else if (cmd === "erase-no") {
      confirming = false;
      renderWindow();
    } else if (cmd === "erase-yes") {
      save = null;
      store(null);
      confirming = false;
      placeMarker();
      renderWindow();
      // ぼうけんのしょが きえた(低い音で下がる)
      if (soundEnabled()) [392, 311, 247].forEach((f, i) => tone(f, 0.12, i * 0.11, 0.04));
      toast("ぼうけんのしょ 1は きえてしまいました。");
    }
  });

  if (visit.levelUp) {
    // 表示が落ち着いてから知らせる
    setTimeout(() => {
      if (soundEnabled()) [523, 523, 523, 698, 880].forEach((f, i) => tone(f, i === 4 ? 0.3 : 0.08, [0, 0.1, 0.2, 0.3, 0.45][i], 0.045));
      toast(`レベルが あがった！ レベル ${levelOf(visit.days).level}`);
    }, 1200);
  }

  return {
    /** 一覧を描いた(足した)後に呼ぶ */
    afterRender() {
      placeMarker();
      renderWindow();
    },
  };
}
