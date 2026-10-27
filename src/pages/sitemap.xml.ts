// 사이트맵: 검색 엔진(구글, 네이버 등)에 "이런 페이지들이 있어요"라고 알려 주는 목록
import type { APIRoute } from 'astro';
import { listAllPages } from '../lib/pages';
import { listSitemapPosts } from '../lib/posts';
import { siteOrigin } from '../lib/runtime';
import { listTags } from '../lib/tags';
import { escapeXml } from '../lib/xml';

export const GET: APIRoute = async ({ url }) => {
  const origin = siteOrigin(url);
  const [posts, tags, pages] = await Promise.all([listSitemapPosts(), listTags(), listAllPages()]);
  const entry = (path: string, lastmod?: Date) =>
    `<url><loc>${escapeXml(origin + path)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}</url>`;
  const urls = [
    entry('/', posts[0]?.updatedAt),
    entry('/posts'),
    entry('/tags'),
    entry('/goals'),
    entry('/tools'),
    ...posts.map((p) => entry(`/posts/${encodeURIComponent(p.slug)}`, p.updatedAt)),
    ...tags.filter((t) => t.count > 0).map((t) => entry(`/tags/${encodeURIComponent(t.slug)}`)),
    ...pages.filter((p) => p.published).map((p) => entry(`/${encodeURIComponent(p.slug)}`, p.updatedAt)),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
