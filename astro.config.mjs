// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// 公開URL: https://fourgetkun.com/game-news/ (fourgetkun-hub 配下。姉妹サイト anime-news と同じ構成)
//
// ビルド成果物は Cloudflare Pages のプロジェクト game-news (https://game-news.pages.dev) へ
// GitHub Actions から Direct Upload する。ここは「配信元」で、利用者が見るのは
// fourgetkun.com/game-news/。fourgetkun-hub の Worker(src/pages-proxy/proxy.js)が
// /game-news/* を pages.dev から取ってきて返す(リポジトリを private のままにできる)。
// そのため site/base は公開側に合わせる。pages.dev を直接開かれたら Base.astro が公開側へ転送する。
//
// 静的出力のみ(アダプターは使わない)。2026-09 時点の wrangler は `pages project create` を
// Workers へ振り替え、このプロジェクトを Workers + @astrojs/cloudflare に書き換えようとする。
// Pages プロジェクトは `--force` 付きで一度だけ作成済み。以後の `wrangler pages deploy` はそのまま Pages へ届く。
export default defineConfig({
  site: 'https://fourgetkun.com',
  base: '/game-news',
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()],
  },
});
