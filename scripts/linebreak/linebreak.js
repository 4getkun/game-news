// Sentence starts (span.ss, marked by cli.mjs): when no more than 30% of a line holds the
// first words of a sentence that runs on to the next line ("…目立ちます。通算の" / "実績は…"),
// start it on a new line instead. Depends on the width, so it is redone on resize, when the
// web fonts arrive, and on a "linebreak:refit" event (dispatch it after showing hidden text).
// Columns narrower than NARROW characters are marked .bx-ragged (flush left, linebreak.css).
// Include inline at the end of <body>, next to linebreak.css.
(() => {
  const TAIL = 0.3; // largest share of a line left to a sentence's first words
  const lineOf = (r) => r.top + r.height / 2;
  function fit(el) {
    const ss = [...el.querySelectorAll(".ss")];
    ss.forEach((s) => s.classList.remove("on"));
    const cs = getComputedStyle(el);
    const width = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    for (let i = 0; i < ss.length; i++) {
      const first = ss[i].getClientRects()[0];
      if (!first) continue;
      const range = document.createRange();
      range.setStartBefore(ss[i]);
      if (ss[i + 1]) range.setEndBefore(ss[i + 1]); else range.setEndAfter(el.lastChild);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      if (!rects.some((r) => lineOf(r) > first.bottom)) continue; // the sentence ends on this line
      // what of the sentence is on its first line (the line may end short of the edge)
      const onFirst = Math.max(...rects.filter((r) => lineOf(r) < first.bottom).map((r) => r.right)) - first.left;
      if (onFirst <= width * TAIL) ss[i].classList.add("on");
    }
  }
  const NARROW = 36; // columns narrower than this many characters are set flush left (linebreak.css)
  const run = () => {
    document.querySelectorAll('[data-bx="t"]').forEach((el) =>
      el.classList.toggle("bx-ragged", el.clientWidth < NARROW * parseFloat(getComputedStyle(el).fontSize)));
    document.querySelectorAll("[data-bx]").forEach((el) => el.querySelector(".ss") && fit(el));
  };
  let w = innerWidth, t;
  addEventListener("resize", () => {
    if (innerWidth === w) return;
    w = innerWidth;
    clearTimeout(t);
    t = setTimeout(run, 150);
  });
  addEventListener("linebreak:refit", run);
  run();
  document.fonts?.ready.then(run);
})();
