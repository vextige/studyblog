// 검색 로봇에게 주는 안내문
import type { APIRoute } from 'astro';
import { siteOrigin } from '../lib/runtime';
import { getSettings } from '../lib/settings';

/** AI 학습용으로 글을 모아 가는 대표적인 로봇들 (설정에서 막을 수 있어요) */
const AI_CRAWLERS = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'meta-externalagent',
  'cohere-ai',
  'Diffbot',
  'PerplexityBot',
];

export const GET: APIRoute = async ({ url }) => {
  const settings = await getSettings();
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api/', 'Disallow: /_actions/', ''];
  if (settings.seo.blockAiCrawlers) {
    for (const bot of AI_CRAWLERS) lines.push(`User-agent: ${bot}`);
    lines.push('Disallow: /', '');
  }
  lines.push(`Sitemap: ${siteOrigin(url)}/sitemap.xml`, '');
  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
