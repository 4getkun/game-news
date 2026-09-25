// base(/game-news/)配下でもリンクが壊れないようにするヘルパー
export function withBase(pathname: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}
