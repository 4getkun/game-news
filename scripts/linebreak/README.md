# ja-linebreak：静的サイトの日本語改行を整える

ビルド後のHTMLに[BudouX](https://github.com/google/budoux)の文節区切り（`<wbr>`）を入れ、「リーチ｜率」「かもしれな｜い」のような単語の途中での改行をなくします。
CSSの `word-break: auto-phrase` はChromeでしか使えませんが、この方法ならどのブラウザでも効きます。

BudouXの出力には、さらに次の補正をかけます。

- **長い文節の分割**：7文字以上の文節は、漢字→カタカナの境目、中黒の後、区切りになる助詞の後でも改行できるようにします
- **行頭禁則**：小書きかな・長音・閉じ括弧・句読点・「…」などが行頭に来ないようにします
- **括弧**：短い括弧（9文字以下）は1行に収め、開き括弧の前では改行できるようにします
- **固有名詞**：設定した名前（人名・チーム名など）は途中で切りません
- **句点で文節を区切る**：文節の途中にある句点では必ず区切り、疑問符・感嘆符は後ろに助詞が続かないときだけ区切ります
- **ソースの改行の除去**：日本語どうしの間にあるソース上の改行・空白を詰めます（「書きます。 数字を」のように空白が出るのを防ぐため）
- **段落の最後**：最後の行は5文字以上にして、「す。」だけの行を作りません
- **結びつきの強い文節**：「この｜データ」「見殺し度の｜一部」「投げて｜降板」のように切ると読みにくい所はつなげます（`boundJoin` 文字まで）。「です」「でした」、1文字の語の後の中黒（セ・リーグ）、「手がかり」のような語も途中で切りません
- **狭い画面**：スマホでは本文をどこでも改行できるようにしつつ、単語・数字＋単位・名前は `span.nw` で1行に保ちます
- **狭い段落**：幅が36文字に満たない段落（カード・注記）は両端をそろえず左寄せにします。両端そろえだと字間が目立って空くためです（`linebreak.js`）
- **サイトのCSSから守る**：足した `span.nw` / `span.ss` は、サイトに「カード内の span を赤く」のような指定があっても周りの文字と同じ見た目になります
- **文の頭**：文の最初の文節が行末に取り残されるときは、次の行から始めます（`linebreak.js`）

## 使い方

1. 入れる。2通りあります。
   - **A. ファイルをコピーする（おすすめ）**：CI に GitHub の認証がいらず、そのプロジェクトだけで完結します

     ```sh
     npx --allow-git=all github:4getkun/ja-linebreak --vendor scripts/linebreak
     npm i -D budoux linkedom
     ```

     `scripts/linebreak/` にファイルが入り、`linebreak.config.mjs` の雛形ができます。以下の `npx ja-linebreak` は `node scripts/linebreak/cli.mjs` に読み替えてください。
   - **B. npm の依存にする**：更新は `npm update ja-linebreak` で済みますが、private リポジトリなので、CI で `npm ci` するには GitHub のトークンの設定が要ります

     ```sh
     npm i -D github:4getkun/ja-linebreak --allow-git=all
     ```

     npm 12 以降は git からの取得が既定で無効なので、プロジェクトの `.npmrc` に `allow-git=all` を書いておきます。

2. ビルドの後に実行する（例：package.json の build の最後に足す）

   ```sh
   npx ja-linebreak dist
   ```

   | オプション | 内容 |
   |---|---|
   | `--config <file>` | 設定ファイル。省略時はカレントの `linebreak.config.mjs`、なければ既定値 |
   | `--check` | 何も書き換えず、未処理のページがあれば終了コード1（CIで確認するとき） |
   | `--dry-run` | 何も書き換えず、件数だけ表示 |
   | `--quiet` | 集計行を出さない |

3. CSS と JS をページに入れる
   - CSS：`ja-linebreak/linebreak.css` をサイトのCSSに読み込みます（例：`@import "ja-linebreak/linebreak.css";`）
   - JS：`ja-linebreak/linebreak.js` の中身を各ページの `</body>` の直前にインラインで入れます
     - Astro：`import js from "ja-linebreak/linebreak.js?raw";` と `<script is:inline set:html={js} />`
     - Vite 以外：ビルド時に `node_modules/ja-linebreak/linebreak.js` を読んで埋め込みます
4. 隠していた文章を表示したときは `dispatchEvent(new Event("linebreak:refit"))` を送り、文頭の位置を計算し直させます。

ビルドの中から関数として呼ぶこともできます。

```js
import { createRules, processDocument } from "ja-linebreak";
import { parseHTML } from "linkedom";
const rules = createRules({ names: ["佐々木寿人"] });
const { document } = parseHTML(html);
processDocument(document, rules); // document を直接書き換え、{ elements, joined, changed } を返す
```

## 設定（linebreak.config.mjs）

設定オブジェクトを返します。関数（`(dir) => config`、asyncも可）にすると、ビルド結果のデータから名前を読み込めます。指定しなかった項目は `core.mjs` の `DEFAULTS` になります。

| 項目 | 内容 | 既定値 |
|---|---|---|
| `selectors` | 短い文（見出し・キャプション・ラベル）。行の長さをそろえます | `h1`〜`h4`, `figcaption`, `dt`, `caption`, `summary`, `th`, `label`, `legend` |
| `text` | 本文（段落・リスト）。両端をそろえます | `p`, `li`, `dd`, `blockquote` |
| `names` | 途中で切らない固有名詞 | なし |
| `units` | 数字と1語として扱う単位 | `%` `件` `回` `人` `円` `倍` `km` など |
| `skip` | 中身を触らない要素 | `code` `pre` `kbd` `ruby` `svg` `math` `textarea` など |
| `optOut` | 除外するセレクタ | `[data-bx-skip]`, `[translate=no]`, `[contenteditable]` |
| `maxBracket` / `longPhrase` / `widowMin` / `widowJoin` / `boundJoin` | 括弧を1行に保つ長さ、長い文節の長さ、最後の行の最小文字数、最後の行にまとめる上限、結びつきの強い文節をつなげる上限 | 9 / 7 / 5 / 12 / 9 |

`lang` 属性が `ja` 以外の要素（`lang="en"` など）は処理しません。

## 出力されるマーク

| マーク | 意味 | CSS |
|---|---|---|
| `data-bx=""` | 短い文。文節の間でだけ改行 | `keep-all` と `text-wrap: balance` |
| `data-bx="t"` | 本文 | `keep-all` と両端そろえ。640px以下では任意の位置で改行し、左寄せ。幅36文字未満は `.bx-ragged` で左寄せ |
| `span.nw` | 1行に保つ語 | `white-space: nowrap` |
| `span.ss` | 文の最初の文節 | `.ss.on` のとき、その前で改行 |

## 注意

- 同じページに2回かけても結果は変わりません（処理済みの要素は `data-bx` で見分けます）。
- HTMLはlinkedomで読み直して書き出すため、属性の引用符などの書式が変わることがあります（表示には影響しません）。
- テスト：`npm test`
- 更新：このリポジトリを直して push し、使う側で `npm update ja-linebreak` を実行します。
- 例：[mahjong-war](https://github.com/4getkun/mahjong-war) の `site/linebreak.config.mjs`（麻雀の単位、選手名・チーム名をビルド結果から読む）
