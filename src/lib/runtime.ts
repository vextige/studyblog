import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';

export type RequestContext = Pick<APIContext, 'request' | 'url' | 'locals' | 'cookies'>;

/** 응답을 보낸 뒤에 해도 되는 일(조회수 기록, 청소 등)을 뒤로 미뤄요. */
export function waitUntil(locals: App.Locals, task: PromiseLike<unknown>): void {
  const promise = Promise.resolve(task).catch((error: unknown) => console.error('[background]', error));
  try {
    locals.cfContext.waitUntil(promise);
  } catch {
    // 테스트처럼 실행 환경이 없으면 그냥 기다리지 않고 넘어가요.
  }
}

/** 사이트의 공식 주소 (SITE_URL 설정이 없으면 지금 요청한 주소를 써요) */
export function siteOrigin(url: URL): string {
  const configured = env.SITE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // 잘못된 값이면 무시해요.
    }
  }
  return url.origin;
}

export function absoluteUrl(url: URL, path: string): string {
  return new URL(path, siteOrigin(url)).href;
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? '127.0.0.1';
}

export function requestCountry(request: Request): string {
  const cf = (request as Request & { cf?: { country?: unknown } }).cf;
  return typeof cf?.country === 'string' ? cf.country.slice(0, 2) : '';
}

export function isHttps(url: URL): boolean {
  return url.protocol === 'https:';
}
