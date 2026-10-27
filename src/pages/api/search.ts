// 검색 (⌘K 검색창에서 써요)
import type { APIRoute } from 'astro';
import { searchPosts } from '../../lib/posts';
import { ipHash, rateLimit } from '../../lib/security';
import { formatDate } from '../../lib/time';

export const GET: APIRoute = async ({ url, request }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (!q) return new Response(JSON.stringify({ results: [] }), { headers });

  const limited = await rateLimit('search', await ipHash(request), 60, 60);
  if (!limited.ok) {
    return new Response(JSON.stringify({ error: '검색을 너무 많이 했어요. 잠시 뒤에 다시 해 주세요.' }), {
      status: 429,
      headers: { ...headers, 'retry-after': String(limited.retryAfterSec) },
    });
  }
  const hits = await searchPosts(q, 8);
  const results = hits.map((h) => ({
    slug: h.slug,
    title: h.title,
    snippet: h.snippet,
    date: formatDate(h.publishedAt),
    day: h.dayNumber,
    tags: h.tags.map((t) => ({ name: t.name, color: t.color })),
  }));
  return new Response(JSON.stringify({ results }), { headers });
};
