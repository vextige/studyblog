// 휴대폰 홈 화면에 앱처럼 추가할 때 쓰는 정보
import type { APIRoute } from 'astro';
import { getSettings } from '../lib/settings';

export const GET: APIRoute = async () => {
  const settings = await getSettings();
  const manifest = {
    name: settings.siteTitle,
    short_name: settings.siteTitle.slice(0, 12),
    description: settings.siteDescription,
    lang: 'ko',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f4ee',
    theme_color: '#15151b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
