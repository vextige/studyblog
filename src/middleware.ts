/**
 * 모든 요청이 지나가는 관문
 * 1) 로그인 쿠키 확인 → Astro.locals.user
 * 2) /admin, /api/admin 은 로그인한 사람만
 * 3) 다른 사이트에서 몰래 보낸 요청(CSRF) 차단
 * 4) 응답에 보안 헤더 붙이기
 */
import { defineMiddleware } from 'astro:middleware';
import { validateSession } from './lib/auth/session';
import { waitUntil } from './lib/runtime';
import { cleanupExpired, isSameOriginRequest, withSecurityHeaders } from './lib/security';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** 로그인하지 않아도 들어갈 수 있는 관리자 화면 */
const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/admin/setup']);

function json(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, locals } = context;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const isAdminPage = path === '/admin' || path.startsWith('/admin/');
  const isAdminApi = path.startsWith('/api/admin/');
  const isApi = path.startsWith('/api/') || path.startsWith('/_actions/');
  const isPrivate = isAdminPage || isAdminApi || path.startsWith('/_actions/admin');

  locals.user = null;
  locals.session = null;

  if (!SAFE_METHODS.has(request.method) && (isApi || isAdminPage) && !isSameOriginRequest(request, url)) {
    return withSecurityHeaders(json(403, '다른 사이트에서 온 요청은 받을 수 없어요.'), url, { private: true });
  }

  if (!context.isPrerendered) {
    try {
      const result = await validateSession(context);
      if (result) {
        locals.user = result.user;
        locals.session = result.session;
      }
    } catch (error) {
      console.error('[session]', error);
    }
  }

  if (isAdminApi && !locals.user) {
    return withSecurityHeaders(json(401, '로그인이 필요해요.'), url, { private: true });
  }
  if (isAdminPage && !locals.user && !PUBLIC_ADMIN_PATHS.has(path)) {
    const nextPath = encodeURIComponent(url.pathname + url.search);
    return withSecurityHeaders(context.redirect(`/admin/login?next=${nextPath}`, 303), url, { private: true });
  }

  // 100번 중 1번꼴로 만료된 데이터를 청소해요.
  if (Math.random() < 0.01) waitUntil(locals, cleanupExpired());

  const response = await next();
  return withSecurityHeaders(response, url, { private: isPrivate || Boolean(locals.user) });
});
