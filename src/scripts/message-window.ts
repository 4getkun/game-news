// トップの「おしらせ」ウィンドウ。▼(またはウィンドウのどこか)を押すと、次のニュースへ
// ファミコンの RPG のテキスト送りのように1文字ずつ表示し、8bit 風の効果音を鳴らす。
//  - 文字を出している途中に押すと、まず全文を出す(もう一度押すと次へ)
//  - 最後まで行ったら最初に戻る
//  - 効果音は Web Audio の矩形波をその場で合成する(音声ファイルは使わない)。♪ボタンで切り替え、端末に覚える
//  - 動きを減らす設定の人には、1文字ずつではなく一度に出す
//  - 開いたときの「◯けん とどいた！」にも文字送りの音とファンファーレを付ける(playIntro)

interface HeroItem {
  t: string;
  l: string;
}

const SOUND_KEY = "game-news:sound";
const TYPE_MS = 32; // ▼で送ったときの1文字の間隔
/** 開いたときの CSS の1文字ずつ(.typer)の間隔。global.css・index.astro と同じ */
const INTRO_MS = 28;
const LOG_SIZE = 4;

let audio: AudioContext | null = null;

/** ♪(効果音)がオンか。ぼうけんのしょ(bouken.ts)からも使う */
export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

/** 矩形波を短く鳴らす(ファミコンの音源と同じ波形)。start は今からの秒 */
export function tone(freq: number, dur: number, start = 0, vol = 0.05) {
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime + start;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch {
    /* 音が出せない環境でも表示は続ける */
  }
}

/** 「とどいた！」のファンファーレ(ドミソド↑の短い上り) */
function jingle(start = 0) {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? 0.22 : 0.08, start + i * 0.085, 0.045));
}

/**
 * 開いたときの「◯けん とどいた！」の1文字ずつ(CSS のアニメーション)に合わせて音を鳴らす。
 * ブラウザは、ページを一度も押していないうちは音を出させない(自動再生の制限)。
 * 鳴らせないときは、開いてから少しの間に最初に押されたところでファンファーレだけ鳴らす
 */
function playIntro(reduceMotion: boolean) {
  const lines = [...document.querySelectorAll<HTMLElement>(".msg .typer")];
  const schedule = (offset: number) => {
    if (reduceMotion) {
      jingle(0);
      return;
    }
    // 各文字の表示時刻(CSS の --i × 28ms + --d)に合わせ、2文字ごとに「ピッ」
    let lineEnd = 0;
    lines.forEach((line, li) => {
      const d = parseFloat(line.style.getPropertyValue("--d")) || 0;
      const spans = [...line.querySelectorAll<HTMLElement>("span")];
      spans.forEach((sp, i) => {
        const at = (d + i * INTRO_MS) / 1000 - offset;
        if (at >= 0 && i % 2 === 1 && sp.textContent?.trim()) tone(1760 + (i % 3) * 40, 0.025, at, 0.03);
      });
      // 1行目(「とどいた！」)を打ち終えたところでファンファーレ
      if (li === 0) lineEnd = (d + spans.length * INTRO_MS) / 1000 - offset;
    });
    if (lineEnd >= 0) jingle(lineEnd + 0.05);
  };

  const loadedAt = performance.now();
  try {
    audio ??= new AudioContext();
  } catch {
    return;
  }
  if (audio.state === "running") {
    // このスクリプトが動くまでに CSS のアニメーションは少し進んでいるので、その分ずらす
    const anim = lines[0]?.querySelector("span")?.getAnimations()[0];
    schedule(anim && typeof anim.currentTime === "number" ? anim.currentTime / 1000 : 0);
    return;
  }
  const onFirst = (e: Event) => {
    ["pointerdown", "keydown"].forEach((t) => removeEventListener(t, onFirst, true));
    // ♪ボタン(音を切る操作)で鳴らすのは逆効果なので鳴らさない
    if ((e.target as HTMLElement | null)?.closest?.("#msg-sound")) return;
    // 開いてから時間が経っていたら鳴らさない(関係ない操作で急に鳴ると驚くため)
    if (performance.now() - loadedAt > 8000) return;
    void audio!.resume().then(() => jingle(0));
  };
  ["pointerdown", "keydown"].forEach((t) => addEventListener(t, onFirst, { capture: true, once: true }));
}

export function startMessageWindow() {
  const win = document.querySelector<HTMLElement>(".msg");
  const link = document.getElementById("msg-link") as HTMLAnchorElement | null;
  const typed = document.getElementById("msg-typed");
  const sr = document.getElementById("msg-sr");
  const count = document.getElementById("msg-count");
  const next = document.getElementById("msg-next");
  const soundBtn = document.getElementById("msg-sound");
  const log = document.getElementById("msg-log");
  const queue = JSON.parse(document.getElementById("hero-queue")?.textContent || "[]") as HeroItem[];
  if (!win || !link || !typed || !sr || !count || !next || !soundBtn || queue.length === 0) return;

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let soundOn = true;
  try {
    soundOn = localStorage.getItem(SOUND_KEY) !== "off";
  } catch {}
  const renderSound = () => {
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    soundBtn.textContent = soundOn ? "♪" : "♪×";
    soundBtn.title = soundOn ? "効果音: オン" : "効果音: オフ";
  };
  renderSound();
  if (soundOn) playIntro(reduceMotion);

  let index = 0;
  let timer = 0;
  let typing = false;
  let fullText = "";

  const finishTyping = () => {
    clearInterval(timer);
    typing = false;
    typed.textContent = fullText;
    win.classList.remove("is-typing");
  };

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  // 「つづくニュース」(次の4件)を、いま出しているニュースに合わせる
  const renderSide = () => {
    if (log) {
      const rest = Array.from({ length: Math.min(LOG_SIZE, queue.length - 1) }, (_, k) => queue[(index + 1 + k) % queue.length]);
      log.innerHTML = rest.map((it) => `<li><a href="${esc(it.l)}" target="_blank" rel="noopener noreferrer">${esc(it.t)}</a></li>`).join("");
    }
  };

  const show = (i: number) => {
    index = (i + queue.length) % queue.length;
    const item = queue[index];
    fullText = `▶ ${item.t}`;
    link.href = item.l;
    sr.textContent = `ニュース ${index + 1}件目: ${item.t}`;
    count.textContent = `${index + 1}/${queue.length}`;
    renderSide();
    // 最初に描いた、CSS で1文字ずつ出す版を捨てて、ここからは JS で送る
    typed.classList.remove("typer");
    typed.removeAttribute("style");
    if (soundOn) {
      // ページ送りの「ピポッ」
      tone(988, 0.06, 0);
      tone(1319, 0.09, 0.07);
    }
    if (reduceMotion) {
      typed.textContent = fullText;
      return;
    }
    const chars = Array.from(fullText);
    let n = 0;
    typed.textContent = "";
    typing = true;
    win.classList.add("is-typing");
    clearInterval(timer);
    // 送った直後に一瞬だけ空にしてから打ち始める(テキストウィンドウの切り替わり)
    timer = window.setTimeout(() => {
      timer = window.setInterval(() => {
        n++;
        typed.textContent = chars.slice(0, n).join("");
        // 2文字ごとに「ピッ」。少しだけ音程を揺らすと機械的すぎない
        if (soundOn && n % 2 === 0 && chars[n - 1]?.trim()) tone(1760 + (n % 3) * 40, 0.025, 0, 0.03);
        if (n >= chars.length) finishTyping();
      }, TYPE_MS);
    }, 140);
  };

  const advance = () => {
    if (typing) finishTyping();
    else show(index + 1);
  };

  next.addEventListener("click", (e) => {
    e.stopPropagation();
    advance();
  });
  // ウィンドウのどこを押しても送る(見出しのリンクと♪ボタンは除く)
  win.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a, button")) return;
    advance();
  });
  soundBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    try {
      localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off");
    } catch {}
    renderSound();
    if (soundOn) tone(1319, 0.05);
  });
}
