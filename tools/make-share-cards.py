"""ぼうけんのしょの共有カード public/share/lv{1..99}.png (1200x630) を作る。

X(Twitter)の投稿に画像を埋め込むには、共有する URL のページに og:image が要る。ブラウザの中で描いた
画像は X からは見えないので、レベルごとのカードを先に作っておき、src/pages/share/[lv].astro の
ページ(/game-news/share/lv12/ など)が自分のレベルのカードを og:image として示す。
訪問日数・読んだ数は投稿の文面に入れる(カードはレベルと しょうごう だけ)。

レベルとしょうごうの対応は src/scripts/bouken.ts の titleOf と同じにしておく(変えたら両方直す)。
手元で1回動かしてコミットする(ビルド時には動かない)。要 Pillow。
    python tools/make-share-cards.py

フォント: tools/fonts/DotGothic16-Regular.ttf(OFL)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "share"
PIXEL = str(ROOT / "tools" / "fonts" / "DotGothic16-Regular.ttf")
MAX_LEVEL = 99

S = 2  # 2倍で描いて縮小する
W, H = 1200 * S, 630 * S
PAGE = (7, 11, 36)  # ダークテーマの --page
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
GOLD = (255, 216, 74)  # --cursor
MUTED = (170, 180, 230)  # --win-muted


def title_of(level: int) -> str:
    if level >= 50:
        return "でんせつの ゲーマー"
    if level >= 35:
        return "ゲームの けんじゃ"
    if level >= 25:
        return "ゲーム ものしり"
    if level >= 15:
        return "ベテラン ゲーマー"
    if level >= 8:
        return "いちにんまえ ゲーマー"
    if level >= 4:
        return "かけだし ゲーマー"
    return "みならい ゲーマー"


def font(px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(PIXEL, px * S)


def card(level: int) -> Image.Image:
    im = Image.new("RGB", (W, H), PAGE)
    d = ImageDraw.Draw(im)
    s = lambda v: v * S  # noqa: E731
    # ウィンドウ: 黒地に白の太枠(サイトのぼうけんのしょと同じ)
    d.rectangle([s(60), s(70), s(1140), s(560)], fill=BLACK)
    d.rectangle([s(66), s(76), s(1134), s(554)], outline=WHITE, width=s(10))
    # 見出しのタブ
    d.rectangle([s(100), s(46), s(380), s(100)], fill=BLACK, outline=WHITE, width=s(6))
    d.text((s(122), s(73)), "ぼうけんのしょ", font=font(32), fill=WHITE, anchor="lm")
    d.text((s(120), s(165)), "ぼうけんのしょ 1", font=font(40), fill=WHITE, anchor="lm")
    d.text((s(1100), s(165)), "#ゲームニュース全部", font=font(32), fill=GOLD, anchor="rm")
    # カーソルとレベル
    # ▶ はドット書体に無いので三角形を描く
    d.polygon([(s(124), s(266)), (s(124), s(314)), (s(166), s(290))], fill=WHITE)
    d.text((s(190), s(290)), f"レベル {level}", font=font(104), fill=WHITE, anchor="lm")
    d.text((s(190), s(420)), title_of(level), font=font(60), fill=WHITE, anchor="lm")
    d.text((s(120), s(505)), "ゲームニュースを まいにち よんで レベルアップ", font=font(30), fill=MUTED, anchor="lm")
    d.text((s(1140), s(600)), "fourgetkun.com/game-news/", font=font(28), fill=MUTED, anchor="rm")
    return im.resize((1200, 630), Image.NEAREST)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for level in range(1, MAX_LEVEL + 1):
        path = OUT / f"lv{level}.png"
        # 色数が少ないので、パレット画像にすると軽い
        card(level).quantize(colors=16, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
        total += path.stat().st_size
    print(f"{MAX_LEVEL} cards -> {OUT.relative_to(ROOT)} ({total // 1024} KB)")


if __name__ == "__main__":
    main()
