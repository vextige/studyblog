// 글·태그 주소(slug) 만들기. 영어 소문자, 숫자, 한글, 하이픈(-)만 남겨요.
// 예) "Git이 뭐예요? (기초)" → "git이-뭐예요-기초"

export const SLUG_PATTERN = /^[a-z0-9가-힣]+(?:-[a-z0-9가-힣]+)*$/;
export const SLUG_MAX = 80;

export function slugify(input: string): string {
  return input
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= SLUG_MAX && SLUG_PATTERN.test(slug);
}

/** 사이트의 다른 주소와 겹치면 안 되는 이름들 (고정 페이지 주소로 못 써요) */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'posts', 'tags', 'goals', 'tools', 'search', 'media', 'og', 'fonts', 'rss', 'rss.xml', 'feed',
  'sitemap', 'sitemap.xml', 'robots.txt', 'manifest.webmanifest', 'favicon.svg', 'favicon.ico',
  '404', '500', 'login', 'logout', 'setup', '_astro', '_actions', '_image', '.well-known',
]);
