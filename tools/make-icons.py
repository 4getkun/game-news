"""ファビコン一式を作る(ドット絵)。

図柄: サイトの絞り込みメニューと同じ JRPG のコマンドウィンドウ。紺の地に白い枠、
金色の ▶ カーソルが指している1行目は選択中なので金色(サイトの .menu-item[aria-pressed] と同じ)、
その下の2行目はまだ選んでいない項目なので薄い色。16x16 のマス目で1ドットずつ決めてあるので、ブラウザのタブ(16px)で
そのまま読める。大きいサイズは同じマス目を整数倍に拡大する(ぼかさない)。
(姉妹サイト anime-news は極太書体の「全」がタブでつぶれた。ここは最初から16pxで設計する)

    python tools/make-icons.py   (要 Pillow)

出力(public/): favicon.svg / favicon.ico(16・32・48) / apple-touch-icon.png(180) / icon-192.png / icon-512.png
"""
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "public"

# 1文字=1ドット。. は透明
PALETTE = {
    "N": "#13206E",  # ウィンドウの紺
    "W": "#F4F6FF",  # 枠
    "C": "#FFD84A",  # カーソルと選択中の行(--cursor)
    "M": "#AAB4E6",  # 選んでいない行(--win-muted)
}
GRID = [
    ".NNNNNNNNNNNNNN.",
    "NWWWWWWWWWWWWWWN",
    "NWNNNNNNNNNNNNWN",
    "NWNNNNNNNNNNNNWN",
    "NWNCNNNNNNNNNNWN",
    "NWNCCNNNNNNNNNWN",
    "NWNCCCNCCCCCNNWN",
    "NWNCCCNCCCCCNNWN",
    "NWNCCNNNNNNNNNWN",
    "NWNCNNNNNNNNNNWN",
    "NWNNNNNMMMMNNNWN",
    "NWNNNNNMMMMNNNWN",
    "NWNNNNNNNNNNNNWN",
    "NWNNNNNNNNNNNNWN",
    "NWWWWWWWWWWWWWWN",
    ".NNNNNNNNNNNNNN.",
]
assert len(GRID) == 16 and all(len(row) == 16 for row in GRID)


def hex_rgba(h: str) -> tuple[int, int, int, int]:
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), 255)


def base16() -> Image.Image:
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(GRID):
        for x, ch in enumerate(row):
            if ch in PALETTE:
                img.putpixel((x, y), hex_rgba(PALETTE[ch]))
    return img


def scaled(k: int) -> Image.Image:
    return base16().resize((16 * k, 16 * k), Image.NEAREST)


def svg() -> str:
    # 横に続く同じ色のドットは1本の矩形にまとめる
    rects = []
    for y, row in enumerate(GRID):
        x = 0
        while x < 16:
            ch = row[x]
            if ch not in PALETTE:
                x += 1
                continue
            start = x
            while x < 16 and row[x] == ch:
                x += 1
            rects.append(f'<rect x="{start}" y="{y}" width="{x - start}" height="1" fill="{PALETTE[ch]}"/>')
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">'
        + "".join(rects)
        + "</svg>\n"
    )


(OUT / "favicon.svg").write_text(svg(), encoding="utf-8")
# Pillow は基準画像より大きいサイズを書かないので、48px を基準にして 16/32px を添える
scaled(3).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=[base16(), scaled(2)])
# iOS: 180 は 16 の倍数ではないので、11倍(176px)を紺の地の中央に置く。角は iOS が丸める
touch = Image.new("RGBA", (180, 180), hex_rgba(PALETTE["N"]))
touch.alpha_composite(scaled(11), (2, 2))
touch.convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
scaled(12).save(OUT / "icon-192.png", optimize=True)
scaled(32).save(OUT / "icon-512.png", optimize=True)
for name in ("favicon.svg", "favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png"):
    print(name, (OUT / name).stat().st_size)
