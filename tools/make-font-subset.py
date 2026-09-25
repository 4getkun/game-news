"""ドット書体(DotGothic16)を、よく使う文字だけに絞った woff2 にする。

    python tools/make-font-subset.py

- Google Fonts から読むと、日本語フォントは約120個の小さなファイルに分かれていて、
  届くたびにページ全体の文字の配置をやり直すため、トップの最初の表示が遅くなっていた。
- このサイトはニュースの見出し(メッセージウィンドウ)や作品名もドット書体で出すので、
  テンプレートの文字に加えて JIS 第1水準の漢字(約3,000字)・かな・英数・記号を入れる。
  最近の見出しの文字の99%以上が入る。入っていない字は本文の書体で表示される。
- テンプレートの文言を変えたら実行し直して public/fonts/ をコミットする。
  必要なもの: pip install fonttools brotli
"""
import glob
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "fonts" / "DotGothic16-Regular.ttf"
OUT = ROOT / "public" / "fonts" / "dotgothic16-sub.woff2"

chars = set()
for pattern in ("src/**/*.astro", "src/**/*.ts", "src/data/filters.json"):
    for f in glob.glob(str(ROOT / pattern), recursive=True):
        chars |= set(Path(f).read_text(encoding="utf-8"))
# JIS 第1水準の漢字(Shift_JIS の先頭バイト 0x88〜0x98)
for hi in range(0x88, 0x99):
    for lo in [*range(0x40, 0x7F), *range(0x80, 0xFD)]:
        try:
            chars.add(bytes([hi, lo]).decode("shift_jis"))
        except UnicodeDecodeError:
            pass
for a, b in [(0x20, 0x7F), (0x2000, 0x2070), (0x2190, 0x2200), (0x2460, 0x2500), (0x25A0, 0x2700), (0x3000, 0x3100), (0xFF01, 0xFF5F)]:
    chars |= {chr(c) for c in range(a, b)}
text = "".join(sorted(c for c in chars if c.strip()))

tmp = ROOT / "tools" / ".subset-chars.txt"
tmp.write_text(text, encoding="utf-8")
try:
    subprocess.run(
        [sys.executable, "-m", "fontTools.subset", str(SRC), f"--text-file={tmp}", "--flavor=woff2", f"--output-file={OUT}"],
        check=True,
    )
finally:
    tmp.unlink(missing_ok=True)
print(f"{OUT.relative_to(ROOT)}: {len(text)} chars, {OUT.stat().st_size // 1024} KB")
