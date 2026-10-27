// 보안 문제를 발견한 사람이 연락할 곳을 알려 주는 표준 파일 (RFC 9116)
import type { APIRoute } from 'astro';
import { siteOrigin } from '../../lib/runtime';
import { getSettings, safeHref } from '../../lib/settings';

export const GET: APIRoute = async ({ url }) => {
  const { social } = await getSettings();
  const contact = social.email ? `mailto:${social.email}` : safeHref(social.github);
  if (!contact) return new Response('Not found', { status: 404 });
  const expires = new Date(Date.now() + 180 * 86_400_000).toISOString();
  const body = [
    `Contact: ${contact}`,
    `Expires: ${expires}`,
    'Preferred-Languages: ko, en',
    `Canonical: ${siteOrigin(url)}/.well-known/security.txt`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
