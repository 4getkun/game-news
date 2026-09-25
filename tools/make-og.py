"""共有カード画像 public/og-image.png (1200x630) を作る。

サイトのトップ(ヒーロー)をそのまま1枚にしたもの。色・枠の太さ・見出しの書体は
src/styles/global.css の値に合わせている(デザインを変えたらここも直す)。
  - 明るい地にドットのマス目、左上にロゴ(ファビコンのドット絵)とサイト名
  - ドット書体の見出し「ゲームのニュースを ぜんぶ よむ。」
  - 「おしらせ」ウィンドウ(メッセージ)と「ステータス」ウィンドウ(機種ごとのHPバー)
手元で1回動かしてコミットする(ビルド時には動かない)。要 Pillow。
    python tools/make-og.py

フォント: tools/fonts/DotGothic16-Regular.ttf(OFL)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "og-image.png"
ICON = ROOT / "public" / "icon-192.png"
PIXEL = str(ROOT / "tools" / "fonts" / "DotGothic16-Regular.ttf")

S = 2  # 2倍で描いて縮小する(文字は DotGothic16 のドットが崩れないよう整数倍)
W, H = 1200 * S, 630 * S

# global.css の :root と同じ値
PAGE = (232, 237, 248)  # --page
TEXT = (14, 21, 56)  # --text
MUTED = (78, 88, 120)  # --muted
DOT = (200, 207, 224)  # マス目(--text 10%)
WIN = (19, 32, 110)  # --win
WIN_DEEP = (11, 20, 70)  # --win-deep
FRAME = (244, 246, 255)  # --frame
WIN_MUTED = (170, 180, 230)  # --win-muted
CURSOR = (255, 216, 74)  # --cursor
HP = (75, 224, 138)  # --hp
FOCUS = (255, 138, 0)  # --focus


def font(size):
    return ImageFont.truetype(PIXEL, size * S)


def px(v):
    return int(v * S)


img = Image.new("RGB", (W, H), PAGE)
d = ImageDraw.Draw(img)

# 背景のマス目(.hero と同じ 16px 間隔)
for y in range(0, H, px(16)):
    for x in range(0, W, px(16)):
        d.ellipse((x - px(1), y - px(1), x + px(1), y + px(1)), fill=DOT)


def window(box, title=None):
    """.win と同じ: 外に紺の輪(3px)、白い枠(3px)、内側に薄い細線。地は紺の縦グラデーション"""
    x0, y0, x1, y1 = (px(v) for v in box)
    d.rounded_rectangle((x0 - px(3), y0 - px(3), x1 + px(3), y1 + px(3)), px(13), fill=WIN_DEEP)
    d.rounded_rectangle((x0, y0, x1, y1), px(10), fill=FRAME)
    inner = (x0 + px(3), y0 + px(3), x1 - px(3), y1 - px(3))
    grad = Image.new("RGB", (inner[2] - inner[0], inner[3] - inner[1]))
    gd = ImageDraw.Draw(grad)
    for i in range(grad.height):
        t = i / max(1, grad.height - 1)
        gd.line((0, i, grad.width, i), fill=tuple(int(WIN[k] * (1 - t) + WIN_DEEP[k] * t) for k in range(3)))
    mask = Image.new("L", grad.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, grad.width - 1, grad.height - 1), px(7), fill=255)
    img.paste(grad, inner[:2], mask)
    d.rounded_rectangle(
        (inner[0] + px(3), inner[1] + px(3), inner[2] - px(3), inner[3] - px(3)), px(5), outline=(90, 104, 170), width=px(1)
    )
    if title:
        f = font(20)
        tw = d.textlength(title, font=f)
        tx, ty = x0 + px(18), y0 - px(16)
        d.rounded_rectangle((tx, ty, tx + tw + px(24), ty + px(30)), px(6), fill=WIN, outline=FRAME, width=px(2))
        d.text((tx + px(12), ty + px(3)), title, font=f, fill=FRAME)


def cursor(x, y, size, color):
    """▶ をドットで描く(DotGothic16 には ▶ が無い)"""
    step = size / 12  # 横に6列、1列ごとに上下を step ずつ削る
    for k in range(6):
        d.rectangle(
            (px(x + k * step * 2), px(y + k * step), px(x + (k + 1) * step * 2) - 1, px(y + size - k * step) - 1), fill=color
        )


# ロゴ行(ヘッダーと同じ: ドット絵のマーク＋サイト名)
logo = Image.open(ICON).convert("RGBA").resize((px(48), px(48)), Image.NEAREST)
img.paste(logo, (px(64), px(48)), logo)
d.text((px(126), px(55)), "ゲームニュース全部", font=font(32), fill=TEXT)
url = "fourgetkun.com/game-news"
uf = font(22)
d.text((W - px(64) - d.textlength(url, font=uf), px(62)), url, font=uf, fill=MUTED)

# 見出し(.hero-title)
title_font = font(72)
d.text((px(64), px(132)), "ゲームのニュースを", font=title_font, fill=TEXT)
d.text((px(64), px(222)), "ぜんぶ よむ。", font=title_font, fill=TEXT)

# おしらせウィンドウ(.msg)
window((64, 350, 760, 570), "おしらせ")
msg = font(30)
d.text((px(96), px(384)), "ゲームのニュースが ぜんぶ とどいた！", font=msg, fill=FRAME)
cursor(98, 442, 24, CURSOR)
d.text((px(132), px(436)), "23媒体を 1時間ごとに あつめる", font=msg, fill=CURSOR)
d.text((px(132), px(484)), "機種・話題で しぼりこめる", font=msg, fill=FRAME)
d.text((px(724), px(530)), "▼", font=font(22), fill=CURSOR)

# ステータスウィンドウ(.status)
window((808, 206, 1136, 570), "ステータス（24時間）")
rows = [("Switch 2", 0.62), ("Switch", 0.4), ("PS5", 0.8), ("Xbox", 0.38), ("PC", 1.0), ("スマホ", 0.5), ("VR", 0.22)]
sf = font(20)
for i, (label, v) in enumerate(rows):
    y = 246 + i * 44
    d.text((px(836), px(y)), label, font=sf, fill=FRAME)
    bx0, bx1 = 928, 1106
    d.rounded_rectangle((px(bx0), px(y + 6), px(bx1), px(y + 20)), px(3), outline=FRAME, width=px(2), fill=(8, 12, 40))
    d.rectangle((px(bx0 + 3), px(y + 9), px(bx0 + 3 + (bx1 - bx0 - 6) * v), px(y + 17)), fill=HP)

img = img.resize((1200, 630), Image.LANCZOS)
img = img.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, optimize=True)
print(OUT, OUT.stat().st_size)
