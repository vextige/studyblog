/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

declare const __THEME_INIT__: string;

declare namespace App {
  interface Locals {
    /** 로그인한 관리자 (로그인 안 했으면 null) */
    user: import('./lib/auth/session').SessionUser | null;
    session: import('./lib/auth/session').SessionInfo | null;
    /** 이 요청에서 이미 불러온 블로그 설정·메뉴 (lib/site.ts) */
    chrome?: Promise<import('./lib/site').SiteChrome>;
  }
}

declare namespace Cloudflare {
  interface Env {
    ADMIN_SETUP_TOKEN?: string;
    HASH_SECRET?: string;
    SITE_URL?: string;
  }
}

declare module 'markdown-it-container' {
  import type { MarkdownIt, RendererRule } from 'markdown-it';
  const container: (
    md: MarkdownIt,
    name: string,
    options?: { marker?: string; validate?: (params: string, markup: string) => boolean; render?: RendererRule },
  ) => void;
  export default container;
}

declare module 'markdown-it-mark' {
  import type { MarkdownIt } from 'markdown-it';
  const mark: (md: MarkdownIt) => void;
  export default mark;
}
