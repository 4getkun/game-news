// 検索窓の下に開く候補(サジェスト)。作品名・話題(ゲーム版は機種も)を、打った文字で絞って出す。
//  - ひらがな/カタカナ・全角/半角・大文字/小文字・空白の違いは無視して照合する
//  - 前方一致を先に、同じなら記事数の多い順
//  - 空欄でフォーカスしたときは「話題の作品」を出す
//  - ↑↓で選ぶ、Enter で決定、Esc で閉じる。WAI-ARIA の combobox(listbox)の形にしている

export interface Suggestion {
  kind: "work" | "cat" | "plat";
  /** 表示名(作品名・話題名など) */
  label: string;
  /** 絞り込みに使う値(作品名・カテゴリID・機種ID) */
  value: string;
  /** 記事数(並び順と表示に使う) */
  count: number;
}

const KIND_LABEL: Record<Suggestion["kind"], string> = { work: "作品", cat: "話題", plat: "機種" };
const MAX = 8;

/** 照合用: NFKC・小文字・ひらがな→カタカナ・空白と中黒を除く */
export function suggestKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・･]/g, "");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function attachSuggest(opts: {
  input: HTMLInputElement;
  list: HTMLElement;
  /** 候補の全体(記事の読み込み後に決まる) */
  candidates: () => Suggestion[];
  /** 空欄のときに出す候補 */
  trending: () => Suggestion[];
  /** 見出しの語(作品名など)の呼び方。アニメ版は「作品」、ゲーム版は「タイトル」 */
  workWord?: string;
  onPick: (s: Suggestion) => void;
}) {
  const { input, list } = opts;
  const kindLabel = { ...KIND_LABEL, work: opts.workWord ?? KIND_LABEL.work };
  let shown: Suggestion[] = [];
  let active = -1;

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const render = () => {
    const q = input.value.trim();
    // 除外(-語)や複数語のときは、最後の語で候補を出す
    const last = q.split(/\s+/).pop() ?? "";
    const key = last.startsWith("-") ? "" : suggestKey(last);
    let items: Suggestion[];
    let heading = "";
    if (!q) {
      items = opts.trending().slice(0, MAX);
      heading = `話題の${kindLabel.work}`;
    } else if (!key) {
      items = [];
    } else {
      items = opts
        .candidates()
        .map((s) => {
          const k = suggestKey(s.label);
          const at = k.indexOf(key);
          return { s, rank: at === 0 ? 0 : at > 0 ? 1 : -1 };
        })
        .filter((x) => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || b.s.count - a.s.count)
        .slice(0, MAX)
        .map((x) => x.s);
    }
    shown = items;
    active = -1;
    if (items.length === 0) {
      close();
      return;
    }
    list.innerHTML =
      (heading ? `<li class="suggest-head" role="presentation">${esc(heading)}</li>` : "") +
      items
        .map(
          (s, i) =>
            `<li id="${list.id}-${i}" class="suggest-item" role="option" aria-selected="false" data-i="${i}">` +
            `<span class="suggest-kind suggest-kind-${s.kind}">${esc(kindLabel[s.kind])}</span>` +
            `<span class="suggest-label">${esc(s.label)}</span>` +
            `<span class="suggest-count">${s.count}件</span></li>`,
        )
        .join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const setActive = (i: number) => {
    const opts2 = list.querySelectorAll<HTMLElement>(".suggest-item");
    if (opts2.length === 0) return;
    active = (i + opts2.length) % opts2.length;
    opts2.forEach((el, j) => el.setAttribute("aria-selected", String(j === active)));
    input.setAttribute("aria-activedescendant", opts2[active].id);
    opts2[active].scrollIntoView({ block: "nearest" });
  };

  const pick = (i: number) => {
    const s = shown[i];
    if (!s) return;
    close();
    opts.onPick(s);
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (list.hidden) {
      if (e.key === "ArrowDown") {
        render();
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      setActive(active + 1);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActive(active - 1);
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (active >= 0) {
        e.preventDefault();
        pick(active);
      } else close();
    } else if (e.key === "Escape") {
      close();
    }
  });
  // 押したときに入力欄からフォーカスが外れて閉じないよう、mousedown を止める
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>(".suggest-item");
    if (li) pick(Number(li.dataset.i));
  });
  list.addEventListener("mousemove", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>(".suggest-item");
    if (li && Number(li.dataset.i) !== active) setActive(Number(li.dataset.i));
  });
}
