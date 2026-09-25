# ゲームニュース全部

ゲーム関連ニュースのRSSを片っ端から集め、関係ない記事・転載・重複を落として、機種や話題で読みたいものだけに絞り込めるようにした静的サイトです。
姉妹サイト [アニメニュース全部](https://fourgetkun.com/anime-news/)（4getkun/anime-news）と同じ仕組みで、デザインだけ別にしています（こちらは JRPG のコマンドウィンドウ）。

- 公開URL: https://fourgetkun.com/game-news/ （fourgetkun-hub 配下）
- 配信元: https://game-news.pages.dev （Cloudflare Pages。直接開くと公開URLへ転送される）
- 更新: GitHub Actions が1時間ごとにRSSを取得 → コミット → ビルド → `wrangler pages deploy`

## 公開の仕組み

news-lifespan・anime-news と同じ方式です。ビルド結果は Cloudflare Pages のプロジェクト `game-news` へ Direct Upload し、
fourgetkun-hub の Worker（`src/pages-proxy/proxy.js`）が `/game-news/*` を pages.dev から取ってきて返します。
リポジトリは private のままで構いません。

- `astro.config.mjs` の `site` / `base` は公開側（`https://fourgetkun.com` / `/game-news`）に合わせてあります。
- ハブ側の設定は fourgetkun-hub の `proxy.js` の `SITES`、`wrangler.jsonc` の `run_worker_first`、
  `public/game-news/`（トップ索引用の名札）、`build-manifest.js` の `CATEGORY_OF` / `PROXIED` / `PROXIED_SITEMAPS`。
- 取り次ぎのエッジキャッシュは約5分なので、デプロイから公開側に出るまで最大5分かかります。
- 共有カード画像は `python tools/make-og.py`、ファビコン一式（16x16 のドット絵）は `python tools/make-icons.py` で作り直せます（要 Pillow）。
  OG画像を変えたら fourgetkun-hub の `public/game-news/og-image.png` にも写し、hub の手順で縮小画像を作り直します。
- Pages プロジェクトは作成済み。作り直すときは `wrangler pages project create game-news --production-branch=main --force`
  （`--force` が無いと Workers へ振り替えられ、Astro の設定まで書き換えられる）。

## しくみ

```
feeds.json の23媒体 ─┐
                    ├─ scripts/fetch-news.mjs
                    │    1. 取得して data/archive.json に30日分を積み増し（生データ）
                    │    2. アーカイブ全体に filters.json のルールをかけ直す
                    │    3. 再配信・重複をまとめて src/data/news.json に書き出し
                    └─ Astro がビルド。/data/news.json をブラウザ側の絞り込みUIが読む
```

### 収集時フィルタ（`scripts/lib/filter.mjs` / `src/data/filters.json`）

| 段階 | 内容 |
| --- | --- |
| 除外 | 広告・PR、成人向け、求人、パチンコ・パチスロ、カジノなどは無条件で捨てる |
| 関連度スコア | 語ごとの重み（見出しは2倍）の合計を媒体の種類ごとのしきい値と比べる。専門媒体は全部採用、Googleニュース3点・総合4点・プレス6点（`feeds.json` の `minScore` で上書き。ファミ通・電撃の site 検索は2点）。野球の「ゲーム差」「ゲームセット」や MLB の試合速報は減点 |
| 作品辞書 | 専門媒体の見出しの『』からタイトル名を集め、総合媒体・Googleニュースの見出しにあれば加点する |
| 機種 | Switch 2 / Switch / PS5 / PS4 / Xbox / PC / スマホ / VR を複数付与（「Switch 2」だけの記事に Switch は付けない） |
| カテゴリ | 新作・発売・アップデート・PV・セール・体験版・イベント・ハード・eスポーツ・スマホ・インディー・レビュー・アニメ化・コラボ・業界・ランキング |
| 見たくない話題 | 事件・トラブル（訴訟・炎上・不正・障害・サービス終了など）。見出しだけで判定し『』「」の中は無視（熱愛・結婚／訃報はアニメ版だけ） |
| ネタバレ | 「エンディング」「ラスボス」などに印を付け、表示時にぼかす |
| 再配信・同じ話題の統合 | anime-news と同じ（見出しの完全一致、再配信ポータルは72時間・類似度0.7、別媒体は12時間・0.55。同じタイトル同士はタイトル名を除いて比べ、グループの最初の記事とも似ていることを条件にする） |

### 表示時フィルタ（`src/scripts/feed.ts`）

- 初期表示は日本語の記事のみ（英語は「すべて」「English」で表示）
- 機種・話題（複数選択）、キーワード（スペースでAND、`-語` で除外、`/` キーで検索欄へ）、期間、話題順
- タイトルのフォロー、ミュートする言葉、見たくない話題、媒体の表示切り替え、既読、ネタバレぼかし
- 条件はURLに、好みはブラウザの localStorage（`game-news:*`）に保存

## 開発

```bash
npm install
npm run fetch-news   # RSSを取得して data/ と src/data/news.json を更新
npm run dev          # http://localhost:4321/game-news/
npm test             # フィルタの単体テスト
npm run probe-feeds  # feeds.json の全フィードの生存確認（URLを渡すとそのURLだけ）
```

## GitHub Actions の設定

1. リポジトリの Settings → Secrets and variables → Actions に次の2つを登録する（mahjong-war・anime-news と同じもの）
   - `CLOUDFLARE_API_TOKEN` … Account > Cloudflare Pages > Edit の権限を持つトークン
   - `CLOUDFLARE_ACCOUNT_ID` … アカウントID
   未登録の間は、収集とコミットだけ行いデプロイを飛ばします。
   （データのコミットに要る書き込み権限は、ワークフローの `permissions: contents: write` で付けている）
2. Actions タブで「Update news and deploy to Cloudflare Pages」を有効にして手動実行（以後は毎時47分に自動）

間隔を1時間にしているのは、private リポジトリの Actions 無料枠（月2,000分）をほかのリポジトリと分け合っているためです。

## 著作権について

記事本文はコピーしていません。見出し・短い要約・RSSが配信しているサムネイルURL・リンクのみを掲載し、全文は配信元へ誘導します。
フォント（`tools/fonts/`）は画像生成用で、いずれも SIL Open Font License です。
