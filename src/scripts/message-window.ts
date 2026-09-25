// トップの「おしらせ」ウィンドウ。▼(またはウィンドウのどこか)を押すと、次のニュースへ
// ファミコンの RPG のテキスト送りのように1文字ずつ表示し、8bit 風の効果音を鳴らす。
//  - 文字を出している途中に押すと、まず全文を出す(もう一度押すと次へ)
//  - 最後まで行ったら最初に戻る
//  - 効果音は Web Audio の矩形波をその場で合成する(音声ファイルは使わない)。♪ボタンで切り替え、端末に覚える
//  - 動きを減らす設定の人には、1文字ずつではなく一度に出す

interface HeroItem {
  t: string;
  l: string;
}

const SOUND_KEY = "game-news:sound";
const TYPE_MS = 32; // 1文字の間隔

let audio: AudioContext | null = null;

/** 矩形波を短く鳴らす(ファミコンの音源と同じ波形)。start は今からの秒 */
function tone(freq: number, dur: number, start = 0, vol = 0.05) {
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

export function startMessageWindow() {
  const win = document.querySelector<HTMLElement>(".msg");
  const link = document.getElementById("msg-link") as HTMLAnchorElement | null;
  const typed = document.getElementById("msg-typed");
  const sr = document.getElementById("msg-sr");
  const count = document.getElementById("msg-count");
  const next = document.getElementById("msg-next");
  const soundBtn = document.getElementById("msg-sound");
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

  const show = (i: number) => {
    index = (i + queue.length) % queue.length;
    const item = queue[index];
    fullText = `▶ ${item.t}`;
    link.href = item.l;
    sr.textContent = `ニュース ${index + 1}件目: ${item.t}`;
    count.textContent = `${index + 1}/${queue.length}`;
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
