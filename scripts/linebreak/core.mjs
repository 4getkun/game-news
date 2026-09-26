// Japanese line breaking for static HTML, the pure part: given a parsed document and a config,
// insert BudouX phrase breaks (<wbr>) so lines break between phrases instead of inside a word,
// in every browser (CSS `word-break: auto-phrase` is Chrome-only). No file access, no site
// knowledge: selectors, protected names and unit words all come from the config (see
// README.md). cli.mjs walks a build folder and calls processDocument on each page.
//
// What an element gets (the CSS in linebreak.css relies on it):
//   data-bx=""   short text (headings, captions, labels): breaks only between phrases
//   data-bx="t"  running text (paragraphs, list items): also words wrapped in span.nw so a
//                phone width can break anywhere else, the paragraph's last phrases kept
//                together (no widow), and span.ss on each sentence's first phrase, which
//                linebreak.js may move to a new line
import { loadDefaultJapaneseParser } from "budoux";

export const DEFAULTS = {
  // short, prominent text: its lines are balanced by linebreak.css
  selectors: ["h1", "h2", "h3", "h4", "figcaption", "dt", "caption", "summary", "th", "label", "legend"],
  // running text: justified by linebreak.css
  text: ["p", "li", "dd", "blockquote"],
  // proper nouns BudouX may split ("佐々|木寿人"), longest first is not needed: sorted here
  names: [],
  // counters and units kept with the number before them (94%, 23,550件, 2.5倍)
  units: ["%", "％", "件", "回", "人", "位", "枚", "点", "分", "秒", "年", "月", "日", "時", "個", "円", "倍", "代", "歳", "本", "冊", "km", "kg", "px"],
  // no break inside full-width brackets this short or shorter (「（副露率など）」 stays whole)
  maxBracket: 9,
  // phrases this long may break before katakana after kanji and after a middle dot
  longPhrase: 7,
  // the last line of a paragraph holds at least this many characters, taking whole phrases
  // while they fit in widowJoin
  widowMin: 5,
  widowJoin: 12,
  // longest phrase made by joining tightly bound phrases (この|データでは, 投げて|降板時点で)
  boundJoin: 9,
  // elements never touched, nor their contents
  skip: ["script", "style", "code", "pre", "kbd", "samp", "var", "svg", "math", "textarea", "template", "noscript", "ruby", "select", "option"],
  // an element (or an ancestor) with one of these opts out
  optOut: "[data-bx-skip], [translate=no], [contenteditable]:not([contenteditable=false])",
  // inline marks a running-text element may hold (anything else, or a styled span, makes it a
  // layout block, not running text)
  inline: ["a", "strong", "b", "em", "i", "code", "small", "sup", "sub", "br", "wbr", "span", "q", "abbr", "time", "mark", "kbd", "s", "u", "cite", "dfn"],
};

const JA = /[぀-ヿ㐀-鿿]/;
const WIDE = /[　-鿿＀-￯]/;
const KANJI = /[一-鿿々〆〇]/, KATA = /[ァ-ヺ]/;
const PARTICLE = "のをにがはでともへや";
// a particle followed by these is part of one word or ending, not a place to break: the copula
// (で|す, で|した), the -yasui ending (なりや|すく), particles in a row (に|は, で|も, と|の)
const BOUND = /^(で[すしせ]|やす|[のをにがはでともへや][はもの])/;
// a closing bracket and the kana after it: browsers may break between them (勝利」|を数えます),
// leaving a particle at the start of a line
export const GLUE = /[」』）］】〕〉》〙〗〟][ぁ-ゖ]/;
// words BudouX splits at a "が" it takes for a particle (手が|かりには), kept whole like names
const KEEP = ["手がかり", "足がかり", "気がかり", "大がかり", "通りがかり"];
// "に" and the verb that makes a compound particle with it (投手に|よって, 試合に|ついて)
const COMPOUND = /^(よっ|よる|より|よれ|つい|つき|とっ|対し|対す|関し|関す|おい|おけ|わた|基づ|向け)/;
// words that modify the noun after them and read badly at a line end (この|データ)
const PRENOUN = /^(この|その|あの|どの|こんな|そんな|あんな|どんな|同じ|大きな|小さな|いわゆる)$/;
// characters that may not start a line (JIS X 4051 gyoto kinsoku, the common subset)
export const NO_START = /[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰ-ㇿーヽヾゝゞ々〻、。，．：；）」』］】〕〉》〙〗〟！？‼⁇⁈⁉・‥…]/;
export const OPEN = "（「『［【〔〈《〘〖〝", CLOSE = "）」』］】〕〉》〙〗〟";

export function createRules(config = {}) {
  const c = { ...DEFAULTS, ...config };
  const parser = loadDefaultJapaneseParser();
  const names = [...new Set([...c.names, ...KEEP])].filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const units = [...c.units].sort((a, b) => b.length - a.length).map(esc);
  const oneChar = units.filter((u) => u.length === 1 && !/\\/.test(u)).join("");
  const longer = units.filter((u) => !(u.length === 1 && !/\\/.test(u)));
  const unit = [...longer, ...(oneChar ? [`[${oneChar}]`] : [])].join("|");
  // words kept on one line on a phone: names, katakana words (split at a middle dot), numbers
  // with their unit, Latin words, kanji compounds of 2-4 characters
  const WORD = new RegExp([
    ...names.map(esc),
    GLUE.source,
    "(?<![ァ-ヺー・])[ァ-ヺー]・[ァ-ヺー]{2,8}(?![ァ-ヺー])",
    "(?<![ァ-ヺー])[ァ-ヺー]{2,10}(?![ァ-ヺー])",
    `[A-Za-z0-9０-９][A-Za-z0-9０-９.,+%/²'’-]*${unit ? `(?:${unit})?` : ""}`,
    "(?<![一-鿿々])[一-鿿々]{2,4}(?![一-鿿々])",
  ].join("|"), "g");

  // a middle dot between two words of two characters or more (副露率・リーチ率), not inside a
  // word whose first part is one character (セ・リーグ, パ・リーグ)
  function dotWords(chunk, i) {
    const run = /[ァ-ヺー一-鿿々A-Za-z0-9]/;
    let before = 0, after = 0;
    for (let k = i - 2; k >= 0 && run.test(chunk[k]); k--) before++;
    for (let k = i; k < chunk.length && run.test(chunk[k]); k++) after++;
    return before >= 2 && after >= 2;
  }

  // BudouX keeps long phrases whole (「副露率・リーチ率・和了率が」); in a justified line that
  // stretches the spacing. Long ones may break before katakana after kanji (打率|ランキングと),
  // after a middle dot, and after a particle ending a unit (高いの|かもしれない), two
  // characters at least on each side; never between katakana and the kanji after it.
  function splitLong(chunk) {
    if (chunk.length < c.longPhrase) return [chunk];
    const out = [];
    let start = 0;
    for (let i = 2; i <= chunk.length - 2; i++) {
      const a = chunk[i - 1], b = chunk[i];
      const change = (KANJI.test(a) && KATA.test(b)) || (a === "・" && dotWords(chunk, i)) ||
        (chunk.length >= c.longPhrase + 1 && PARTICLE.includes(a) && !NO_START.test(b) && !BOUND.test(a + b));
      if (change && i - start >= 2) { out.push(chunk.slice(start, i)); start = i; }
    }
    out.push(chunk.slice(start));
    return out;
  }

  // a break inside a protected name is removed
  function keepNames(chunks) {
    if (chunks.length < 2 || !names.length) return chunks;
    const text = chunks.join("");
    const inside = new Set();
    for (const name of names)
      for (let i = text.indexOf(name); i !== -1; i = text.indexOf(name, i + 1))
        for (let j = i + 1; j < i + name.length; j++) inside.add(j);
    if (!inside.size) return chunks;
    const out = [];
    let pos = 0;
    for (const ch of chunks) {
      if (out.length && inside.has(pos)) out[out.length - 1] += ch; else out.push(ch);
      pos += ch.length;
    }
    return out;
  }

  // a break may come just before an opening bracket; short brackets are kept whole (a long one
  // cannot fit a phone line as one piece and would break at an arbitrary character instead)
  function keepBrackets(chunks) {
    const split = [];
    for (const ch of chunks) {
      let start = 0;
      for (let i = 2; i < ch.length; i++) if (OPEN.includes(ch[i])) { split.push(ch.slice(start, i)); start = i; }
      split.push(ch.slice(start));
    }
    const out = [];
    let depth = 0, open = -1;
    for (const ch of split) {
      if (depth > 0 && out[out.length - 1].length - open + ch.length <= c.maxBracket) out[out.length - 1] += ch;
      else { if (depth > 0) depth = 0; out.push(ch); }
      for (let i = 0; i < ch.length; i++) {
        if (OPEN.includes(ch[i])) { if (depth === 0) open = out[out.length - 1].length - ch.length + i; depth++; }
        else if (CLOSE.includes(ch[i])) depth = Math.max(0, depth - 1);
      }
    }
    return out;
  }

  // phrases bound too tightly to break between, joined while the result stays short:
  // a pre-noun word and its noun (この|データでは), "の" before a short noun (見殺し度の|一部を),
  // a verb's -te form run straight into the next word (投げて|降板時点で; not after 、),
  // a compound particle (投手に|よって, 失ったと|いう, 「負け運」と|して)
  function joinBound(chunks) {
    const out = [];
    for (const ch of chunks) {
      const prev = out.at(-1);
      const join = prev !== undefined && !/^[、。，．！？]/.test(ch) && (
        PRENOUN.test(prev) ||
        (/に$/.test(prev) && COMPOUND.test(ch) && prev.length + ch.length <= c.boundJoin + 3) ||
        (/と$/.test(prev) && /^(い[うっえ]|し[てた])/.test(ch) && prev.length + ch.length <= c.boundJoin + 3) ||
        (/[ぁ-ゖァ-ヺ一-鿿々]の$/.test(prev) && ch.length <= 3 && prev.length + ch.length <= c.boundJoin) ||
        (/[ぁ-ゖ一-鿿々]て$/.test(prev) && prev.length + ch.length <= c.boundJoin));
      if (join) out[out.length - 1] += ch; else out.push(ch);
    }
    return out;
  }

  // BudouX sometimes starts a phrase with a character that may not open a line (まだは|っきり)
  function joinNoStart(chunks) {
    const out = [];
    for (const ch of chunks) if (out.length && NO_START.test(ch[0])) out[out.length - 1] += ch; else out.push(ch);
    return out;
  }

  // a sentence end inside a phrase becomes a phrase end; "？" "！" end a sentence only when no
  // particle follows (「正しいの？で詳しく」 goes on)
  const SPLIT = /(?<=。)(?=[^。！？」』）])|(?<=[！？])(?=[^。！？」』）ぁ-ゖ])/;
  const splitSentences = (chunks) => chunks.flatMap((ch) => ch.split(SPLIT));
  const ends = (ch, next) => /。$/.test(ch) || (/[！？]$/.test(ch) && !/^[ぁ-ゖ]/.test(next ?? ""));

  // no widow: whole phrases while they fit, otherwise the end of the previous phrase is
  // borrowed back to a word boundary, never opening with a small kana or a closing mark
  const SAME = (a, b) => [/[ァ-ヺー]/, /[一-鿿々]/, /[A-Za-z0-9０-９.,%]/].some((re) => re.test(a) && re.test(b));
  function splitTail(chunks) {
    const out = [...chunks];
    let tail = out.pop();
    while (out.length && tail.length < c.widowMin && tail.length + out.at(-1).length <= c.widowJoin) tail = out.pop() + tail;
    if (tail.length < c.widowMin && out.length) {
      const prev = out.pop();
      let k = Math.min(prev.length - 1, c.widowMin - tail.length);
      while (k < prev.length - 1 && (SAME(prev[prev.length - k - 1], prev[prev.length - k]) || NO_START.test(prev[prev.length - k]))) k++;
      if (k > 0) { out.push(prev.slice(0, prev.length - k)); tail = prev.slice(-k) + tail; } else out.push(prev);
    }
    return [out, tail];
  }

  const phrases = (text) => keepNames(keepBrackets(splitSentences(joinBound(joinNoStart(parser.parse(text)).flatMap(splitLong)))));
  return { config: c, WORD, phrases, splitLong, keepNames, keepBrackets, joinNoStart, joinBound, splitSentences, splitTail, ends };
}

const upper = (list) => new Set(list.map((t) => t.toUpperCase()));

// Line breaks in the source between two Japanese sentences render as a space ("書きます。 数字を").
// Whitespace with a full-width character on both sides is removed, also across element
// boundaries ("</strong>\n  数字"). An ideographic space (U+3000) is deliberate and kept.
export function joinWideLines(root, skip) {
  const nodes = [];
  (function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) nodes.push(child);
      else if (child.nodeType === 1 && !skip.has(child.tagName)) walk(child);
    }
  })(root);
  let removed = 0;
  const firstChar = (j, dir) => {
    for (let k = j; k >= 0 && k < nodes.length; k += dir) {
      const t = dir < 0 ? nodes[k].textContent.replace(/\s+$/, "") : nodes[k].textContent.replace(/^\s+/, "");
      if (t) return dir < 0 ? t.at(-1) : t[0];
    }
    return "";
  };
  nodes.forEach((node, i) => {
    const text = node.textContent;
    if (!/[ \t\r\n]/.test(text)) return;
    const out = text.replace(/[ \t\r\n]+/g, (ws, pos) => {
      const prev = pos > 0 ? text[pos - 1] : firstChar(i - 1, -1);
      const next = pos + ws.length < text.length ? text[pos + ws.length] : firstChar(i + 1, 1);
      if (WIDE.test(prev) && WIDE.test(next)) { removed++; return ""; }
      return ws;
    });
    if (out !== text) node.textContent = out;
  });
  return removed;
}

// Process one parsed document in place. Returns what was done; `changed` says whether the
// page needs writing. Running it again on its own output changes nothing.
const GLUE_ALL = new RegExp(GLUE.source, "g");

export function processDocument(document, rules) {
  const c = rules.config;
  const skip = upper(c.skip);
  const inline = upper(c.inline);
  const stats = { elements: 0, joined: 0, changed: false };
  if (!document.body) return stats;
  const optedOut = (el) => !!el.closest(c.optOut) ||
    // another language set on the element or around it (lang="en" inside a Japanese page)
    ((l) => l !== null && !/^ja\b/i.test(l))(el.closest("[lang]")?.getAttribute("lang") ?? null);

  stats.joined = joinWideLines(document.body, skip);
  stats.changed = stats.joined > 0;

  const textSel = c.text.join(",");
  const blocks = "p, ul, ol, dl, div, table, section, article, figure";
  // innermost first, so a <li> inside a processed <li> is not handled twice
  const text = [...document.querySelectorAll(textSel)].filter((el) => !el.querySelector(blocks));
  const targets = [...document.querySelectorAll(c.selectors.join(",")), ...text]
    .filter((el) => ![...skip].some((t) => el.closest(t.toLowerCase())) && !optedOut(el));

  const textNodes = (el, out = []) => {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) out.push(node);
      else if (node.nodeType === 1 && !skip.has(node.tagName) && !node.hasAttribute("data-bx") && !node.matches(c.optOut)) textNodes(node, out);
    }
    return out;
  };
  const appendWords = (frag, s, words) => {
    let at = 0;
    for (const m of s.matchAll(words ? rules.WORD : GLUE_ALL)) {
      if (m[0].length < 2) continue;
      if (m.index > at) frag.appendChild(document.createTextNode(s.slice(at, m.index)));
      const span = document.createElement("span"); span.className = "nw"; span.textContent = m[0];
      frag.appendChild(span);
      at = m.index + m[0].length;
    }
    if (at < s.length) frag.appendChild(document.createTextNode(s.slice(at)));
  };

  for (const el of targets.reverse()) {
    if (el.hasAttribute("data-bx")) continue;
    // running text holds only text and inline marks; a list item laid out as a card (styled
    // spans, flex rows) is not: spans added inside a flex row would be spread apart
    const running = el.matches(textSel) || el.matches("td.text")
      ? [...el.querySelectorAll("*")].every((x) => inline.has(x.tagName) && !(x.tagName === "SPAN" && x.className && x.className !== "nw" && x.className !== "ss"))
      : false;
    const nodes = textNodes(el);
    let before = "", touched = false;
    const lastJa = [...nodes].reverse().find((n) => JA.test(n.textContent));
    for (const node of nodes) {
      const s = node.textContent;
      const opens = /。\s*$/.test(before) && /\S/.test(s);
      before += s;
      if (!JA.test(s)) continue;
      const chunks = rules.phrases(s);
      if (chunks.length < 2 && !running) { touched = true; continue; } // one phrase: no break inside it
      const frag = document.createDocumentFragment();
      const [body, tail] = running && node === lastJa && chunks.length >= 2 ? rules.splitTail(chunks) : [chunks, null];
      body.forEach((ch, i) => {
        if (i > 0) frag.appendChild(document.createElement("wbr"));
        if (i > 0 ? rules.ends(body[i - 1], ch) : opens) {
          const ss = document.createElement("span"); ss.className = "ss";
          appendWords(ss, ch, running);
          frag.appendChild(ss);
        } else appendWords(frag, ch, running);
      });
      if (tail) {
        if (body.length) frag.appendChild(document.createElement("wbr"));
        const span = document.createElement("span"); span.className = "nw"; span.textContent = tail;
        frag.appendChild(span);
      }
      node.parentNode.replaceChild(frag, node);
      touched = true;
    }
    if (touched) {
      el.setAttribute("data-bx", running ? "t" : "");
      stats.elements++;
      stats.changed = true;
    }
  }
  return stats;
}
