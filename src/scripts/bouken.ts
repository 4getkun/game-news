// 「ぼうけんのしょ」: ここまで読んだ、の栞(しおり)。ドラクエのセーブ画面のような黒いウィンドウで出す。
//
//  - 栞は「上(新しい記事)から読んできて、ここまで読んだ」という位置。その記事のすぐ下に
//    「ここまで よんだ」の帯をはさみ、栞から記録した時点のいちばん上までの記事は薄く表示する
//    (記録した後に届いた記事は、今までどおり NEW のまま)
//  - 記録のしかた: 自動(ページを離れるとき、今回いちばん下まで読んだ記事。前の栞より深いときだけ上書き)
//    と手動(記事の「しおり」ボタン)
//  - 冊数は1冊、置き場所はこの端末(localStorage)。3冊・ふっかつのじゅもん は使ってみてから
//  - 並び順が「話題順」のときは帯を出さない(時刻の並びではないため)

import { tone, soundEnabled } from "./message-window";

const KEY = "game-news:bouken";
const DISMISS_KEY = "game-news:bouken-dismissed";

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
  /** 読んだ記事の数(レベルの計算に使う) */
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
    if (!save || dismissed || !deps.sortNew()) {
      deps.win.hidden = true;
      deps.win.innerHTML = "";
      return;
    }
    const result = deps.result();
    const at = result.findIndex((e) => e.l === save!.link);
    const rest = at >= 0 ? result.length - at - 1 : result.filter((e) => e.time < save!.t).length;
    const fresh = result.filter((e) => e.time > save!.top).length;
    const read = deps.readCount();
    const level = 1 + Math.floor(read / 10);
    deps.win.hidden = false;
    const cmd = (id: string, label: string, note = "") =>
      `<button type="button" class="bk-cmd" data-bouken="${id}"><span class="bk-cur" aria-hidden="true">▶</span><span>${label}</span><span class="bk-note">${note}</span></button>`;
    deps.win.innerHTML = `<section class="bk-win" aria-label="ぼうけんのしょ">
      <span class="bk-title">ぼうけんのしょ</span>
      <div class="bk-head"><span>ぼうけんのしょ 1</span><span>${fmt.format(save.at)}</span></div>
      <div class="bk-stats"><span>のこり ${rest}けん</span><span>あたらしく ${fresh}けん</span><span>レベル ${level}</span></div>
      <div class="bk-cmds">${
        confirming
          ? `<p class="bk-ask">ほんとうに ぼうけんのしょを けしますか？</p>${cmd("erase-yes", "はい")}${cmd("erase-no", "いいえ")}`
          : `${rest > 0 ? cmd("continue", "つづきから", "しおりの ところへ") : `<p class="bk-ask">つづきは もう ありません。</p>`}${cmd("top", "さいしょから", "あたらしい じゅん")}${cmd("erase", "ぼうけんのしょを けす")}`
      }</div>
    </section>`;
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
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTimer) return;
      scrollTimer = window.setTimeout(() => {
        scrollTimer = 0;
        const box = deps.list.getBoundingClientRect();
        const el = document.elementFromPoint(box.left + Math.min(80, box.width / 2), window.innerHeight / 2)?.closest<HTMLElement>(".item[data-t]");
        if (!el || !deps.list.contains(el)) return;
        const t = Number(el.dataset.t);
        const link = el.querySelector<HTMLAnchorElement>(".item-title a")?.getAttribute("href") ?? "";
        const index = deps.result().findIndex((e) => e.l === link);
        if (index >= 0 && (!deepest || index > deepest.index)) deepest = { link, t, index };
      }, 400);
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
    const shiori = el.closest<HTMLElement>("[data-shiori]");
    if (shiori) {
      saveAt(shiori.dataset.shiori!, Number(shiori.dataset.t), true);
      return;
    }
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

  return {
    /** 一覧を描いた(足した)後に呼ぶ */
    afterRender() {
      placeMarker();
      renderWindow();
    },
  };
}
