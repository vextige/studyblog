// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import cloudflare from '@astrojs/cloudflare';
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';

// 화면이 깜빡이지 않게 <head>에서 바로 실행하는 다크 모드 스크립트.
// 보안 정책(CSP)이 "허락한 스크립트만 실행"하도록, 이 스크립트 내용의 지문(해시)을 미리 등록해요.
const themeInit = readFileSync(new URL('./src/scripts/theme-init.js', import.meta.url), 'utf8').trim();
const themeInitHash = `sha256-${createHash('sha256').update(themeInit).digest('base64')}`;

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [preact()],
  // 로그인은 직접 만든 D1 세션을 써요. (Astro 기본 세션의 KV 저장소는 필요 없어요)
  session: false,
  compressHTML: true,
  // 글은 직접 만든 변환기(src/lib/markdown.ts)로 바꿔서, Astro 기본 코드 색칠(Shiki)은 꺼요.
  markdown: { syntaxHighlight: false },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  devToolbar: { enabled: false },
  security: {
    // 다른 사이트에서 몰래 보낸 POST 요청(CSRF)을 막아요.
    checkOrigin: true,
    actionBodySizeLimit: 1024 * 1024,
    // 콘텐츠 보안 정책: 허락한 출처의 스크립트·스타일·이미지만 불러오게 해요.
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "media-src 'self' https:",
        'frame-src https://www.youtube-nocookie.com',
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
      ],
      scriptDirective: {
        resources: ["'self'"],
        hashes: [/** @type {`sha256-${string}`} */ (themeInitHash)],
      },
      styleDirective: {
        resources: ["'self'", "'unsafe-inline'"],
      },
    },
  },
  vite: {
    define: {
      __THEME_INIT__: JSON.stringify(themeInit),
    },
  },
});
