// RSS 피드: 구독 앱(피들리 등)에서 새 글 알림을 받을 수 있어요.
import type { APIRoute } from 'astro';
import { listFeedPosts } from '../lib/posts';
import { siteOrigin } from '../lib/runtime';
import { getSettings } from '../lib/settings';
import { absolutizeHtml, escapeXml } from '../lib/xml';

export const GET: APIRoute = async ({ url }) => {
  const [settings, posts] = await Promise.all([getSettings(), listFeedPosts(20)]);
  const origin = siteOrigin(url);
  const items = posts
    .map((post) => {
      const link = `${origin}/posts/${encodeURIComponent(post.slug)}`;
      const categories = post.tags.map((t) => `<category>${escapeXml(t.name)}</category>`).join('');
      return `<item>
<title>${escapeXml(post.title)}</title>
<link>${escapeXml(link)}</link>
<guid isPermaLink="true">${escapeXml(link)}</guid>
<pubDate>${post.publishedAt.toUTCString()}</pubDate>
<description>${escapeXml(post.excerpt)}</description>
<content:encoded>${escapeXml(absolutizeHtml(post.contentHtml, origin))}</content:encoded>
${categories}
</item>`;
    })
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(settings.siteTitle)}</title>
<link>${escapeXml(origin)}/</link>
<description>${escapeXml(settings.siteDescription)}</description>
<language>ko</language>
<atom:link href="${escapeXml(origin)}/rss.xml" rel="self" type="application/rss+xml"/>
${posts[0] ? `<lastBuildDate>${posts[0].publishedAt.toUTCString()}</lastBuildDate>` : ''}
${items}
</channel>
</rss>`;
  return new Response(xml, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=600' },
  });
};
