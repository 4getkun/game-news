// 「ぼうけんのしょ」: ここまで読んだ、の栞(しおり)。ドラクエのセーブ画面のような黒いウィンドウで出す。
//
//  - 栞は「上(新しい記事)から読んできて、ここまで読んだ」という位置。その記事のすぐ下に
//    「ここまで よんだ」の帯をはさみ、栞から記録した時点のいちばん上までの記事は薄く表示する
//    (記録した後に届いた記事は、今までどおり NEW のまま)
//  - 記録のしかた: 自動(ページを離れるとき、今回いちばん下まで読んだ記事。前の栞より深いときだけ上書き)
//    と手動(一覧まで下りると右下に出る「しおりを はさむ」。画面のまん中の記事に栞をはさむ)
//  - レベル: 訪れた日(日本時間の日付で1日1回)ごとに けいけんち 100。必要なけいけんちは RPG のように
//    べき関数で増える(最初はすぐ上がり、だんだんゆっくり)。上がった日は「レベルが あがった！」
//  - じまん: X に投稿(ハッシュタグ #ゲームニュース全部)・ぼうけんのしょを画像で保存/共有
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
  /** 記録したときの、いちばん新しい記事の時刻(ms)。これより新しい記事は記録の後に届いたもの */
  top: number;
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
  const newestTime = () => deps.result().reduce((m, e) => Math.max(m, e.time), 0);

  // ---------------------------------------------------------------- 帯と既読の薄表示
  function placeMarker() {
    deps.list.querySelector(".bm-divider")?.remove();
    const items = [...deps.list.querySelectorAll<HTMLElement>(".item[data-t]")];
    items.forEach((el) => el.classList.remove("is-past"));
    if (!save || !deps.sortNew()) return;
    const marker = `<div class="bm-divider" role="separator" aria-label="ここまで読んだ">ここまで よんだ ─ ${fmt.format(save.at)}</div>`;
    // 栞の記事が一覧にあれば、そのすぐ下。無ければ(絞り込みで外れたなど)時刻で位置を決める。
    // 同じ時刻の記事がいくつもあるので、記事そのものを目印にする
    const anchor = items.find((el) => el.querySelector<HTMLAnchorElement>(".item-title a")?.getAttribute("href") === save!.link);
    let reached = false;
    let prevNewer = false;
    let placed = false;
    for (const el of items) {
      const t = Number(el.dataset.t);
      const read = anchor ? !reached : t >= save.t;
      if (read && t <= save.top) el.classList.add("is-past");
      if (anchor) {
        if (el === anchor) {
          el.insertAdjacentHTML("afterend", marker);
          reached = true;
        }
      } else if (!placed && t < save.t && prevNewer) {
        el.insertAdjacentHTML("beforebegin", marker);
        placed = true;
      }
      if (t >= save.t) prevNewer = true;
    }
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
      const at = result.findIndex((e) => e.l === save!.link);
      rest = at >= 0 ? result.length - at - 1 : result.filter((e) => e.time < save!.t).length;
      const fresh = result.filter((e) => e.time > save!.top).length;
      restLine = `<div class="bk-stats"><span>のこり ${rest}けん</span><span>あたらしく ${fresh}けん</span></div>`;
    }
    deps.win.hidden = false;
    const cmd = (id: string, label: string, note = "") =>
      `<button type="button" class="bk-cmd" data-bouken="${id}"><span class="bk-cur" aria-hidden="true">▶</span><span>${label}</span><span class="bk-note">${note}</span></button>`;
    const main = save
      ? `${rest > 0 ? cmd("continue", "つづきから", "しおりの ところへ") : `<p class="bk-ask">つづきは もう ありません。</p>`}${cmd("top", "さいしょから", "あたらしい じゅん")}`
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
          : `${main}${cmd("share-x", "Xで じまんする", "#" + SITE_NAME)}${cmd("share-image", "がぞうで ほぞん", "ぼうけんのしょの カード")}${save ? cmd("erase", "ぼうけんのしょを けす") : ""}`
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
    u.searchParams.set("url", SITE_URL);
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
    save = { link, t, top: Math.max(newestTime(), t), at: Date.now() };
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
  let deepest: { link: string; t: number; index: number } | null = null;
  let scrollTimer = 0;
  /** 画面のまん中にある記事(いま読んでいるところ) */
  const currentItem = () => {
    const box = deps.list.getBoundingClientRect();
    const el = document.elementFromPoint(box.left + Math.min(80, box.width / 2), window.innerHeight / 2)?.closest<HTMLElement>(".item[data-t]");
    if (!el || !deps.list.contains(el)) return null;
    const link = el.querySelector<HTMLAnchorElement>(".item-title a")?.getAttribute("href") ?? "";
    return { link, t: Number(el.dataset.t), index: deps.result().findIndex((e) => e.l === link) };
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
        fab.hidden = !cur || cur.index < 2 || !deps.sortNew();
        if (cur && cur.index >= 0 && (!deepest || cur.index > deepest.index)) deepest = cur;
      }, 250);
    },
    { passive: true },
  );
  const autoSave = () => {
    if (!deepest || !deps.sortNew() || deepest.index < 3) return;
    if (save) {
      // 前の栞より深い(下の)ときだけ上書きする
      const at = deps.result().findIndex((e) => e.l === save!.link);
      if (at >= 0 ? deepest.index <= at : deepest.t >= save.t) return;
    }
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
      const at = result.findIndex((x) => x.l === save!.link);
      const index = at >= 0 ? at + 1 : result.findIndex((x) => x.time < save!.t);
      if (index < 0) return;
      deps.revealUntil(index + 5);
      if (soundEnabled()) [523, 659, 784].forEach((f, i) => tone(f, 0.08, i * 0.07, 0.04));
      // 記事は画面外だと高さを見積もりで描いている(content-visibility)ので、なめらかに動かすと
      // 途中で位置がずれて止まる。一度に飛んでから、描き終わった後にもう一度合わせる
      const jump = () => deps.list.querySelector(".bm-divider")?.scrollIntoView({ block: "center" });
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
