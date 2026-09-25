"""共有カード画像 public/og-image.png (1200x630) を作る。

JRPG の画面の絵柄: 上にタイトルのウィンドウ、左下にメッセージウィンドウ、右下にコマンドウィンドウ。
コマンドの項目がサイトでできること(機種で絞る・話題で絞る・タイトルをフォロー)になっている。
手元で1回動かしてコミットする(ビルド時には動かない)。要 Pillow。
    python tools/make-og.py

フォント: tools/fonts/DotGothic16-Regular.ttf(見出し・ウィンドウ内。OFL)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "og-image.png"
PIXEL = str(ROOT / "tools" / "fonts" / "DotGothic16-Regular.ttf")

W, H = 1200, 630
PAGE = (7, 11, 36)
WIN = (19, 32, 110)
WIN_DEEP = (11, 20, 70)
FRAME = (244, 246, 255)
MUTED = (170, 180, 230)
CURSOR = (255, 216, 74)
HP = (75, 224, 138)


def font(size):
    return ImageFont.truetype(PIXEL, size)


img = Image.new("RGB", (W, H), PAGE)
d = ImageDraw.Draw(img)

# 背景のマス目(フィールド)
for y in range(0, H, 24):
    for x in range(0, W, 24):
        d.rectangle((x, y, x + 1, y + 1), fill=(24, 34, 84))


def window(box, title=None):
    x0, y0, x1, y1 = box
    # 縦グラデーションの紺
    for i, y in enumerate(range(y0, y1)):
        t = i / max(1, y1 - y0 - 1)
        c = tuple(int(WIN[k] * (1 - t) + WIN_DEEP[k] * t) for k in range(3))
        d.line((x0, y, x1, y), fill=c)
    d.rounded_rectangle(box, 12, outline=WIN_DEEP, width=10)
    d.rounded_rectangle((x0 + 4, y0 + 4, x1 - 4, y1 - 4), 9, outline=FRAME, width=4)
    d.rounded_rectangle((x0 + 11, y0 + 11, x1 - 11, y1 - 11), 5, outline=(120, 132, 200), width=1)
    if title:
        f = font(22)
        tw = d.textlength(title, font=f)
        d.rounded_rectangle((x0 + 24, y0 - 16, x0 + 24 + tw + 24, y0 + 16), 6, fill=WIN, outline=FRAME, width=3)
        d.text((x0 + 36, y0 - 12), title, font=f, fill=FRAME)


# タイトル
window((60, 56, 1140, 236))
title_font = font(92)
d.text((104, 92), "ゲームニュース全部", font=title_font, fill=FRAME)

# メッセージウィンドウ
window((60, 290, 700, 560), "おしらせ")
msg = font(34)
d.text((100, 334), "ゲームのニュースが", font=msg, fill=FRAME)
d.text((100, 386), "ぜんぶ とどいた！", font=msg, fill=FRAME)
d.text((100, 452), "23媒体を 1時間ごとに あつめて", font=font(26), fill=MUTED)
d.text((100, 490), "転載や 同じ話題は ひとつに まとめる", font=font(26), fill=MUTED)
d.text((648, 510), "▼", font=font(26), fill=CURSOR)

# コマンドウィンドウ
window((740, 290, 1140, 560), "コマンド")
cmd = font(30)
items = ["きしゅで しぼる", "わだいで しぼる", "タイトルを フォロー", "ネタバレを ぼかす"]
for i, text in enumerate(items):
    y = 332 + i * 52
    if i == 0:
        # DotGothic16 には ▶ が無いので、ドットの三角を描く
        cx, cy = 776, y + 17
        for k in range(6):
            d.rectangle((cx + k * 3, cy - 15 + k * 3, cx + k * 3 + 2, cy + 15 - k * 3), fill=CURSOR)
    d.text((806, y), text, font=cmd, fill=CURSOR if i == 0 else FRAME)

# 下の HP バー風の帯(機種)
bar_y = 584
labels = [("Switch 2", 0.92), ("PS5", 0.74), ("PC", 0.8), ("Xbox", 0.55)]
x = 64
small = font(20)
for label, v in labels:
    d.text((x, bar_y - 2), label, font=small, fill=MUTED)
    lx = x + d.textlength(label, font=small) + 10
    d.rectangle((lx, bar_y + 4, lx + 120, bar_y + 18), outline=FRAME, width=2, fill=(0, 0, 0))
    d.rectangle((lx + 3, bar_y + 7, lx + 3 + int(114 * v), bar_y + 15), fill=HP)
    x = lx + 140
d.text((W - 60 - d.textlength("fourgetkun.com/game-news", font=small), bar_y - 2), "fourgetkun.com/game-news", font=small, fill=CURSOR)

img = img.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, optimize=True)
print(OUT, OUT.stat().st_size)
