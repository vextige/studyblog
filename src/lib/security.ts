import { env } from 'cloudflare:workers';
import { lt } from 'drizzle-orm';
import { getD1, getDb, schema } from '../db/client';
import { hmacHex } from './crypto';
import { clientIp, isHttps, requestCountry, type RequestContext } from './runtime';

/* ───────── 방문자 IP 해시 ───────── */

function hashSecret(): string {
  const secret = env.HASH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('HASH_SECRET 비밀 값이 없어요. README의 "배포" 부분을 참고해서 설정해 주세요.');
  }
  return secret;
}

/** IP 주소를 비밀 키로 해시해요. 같은 IP는 같은 값이 되지만, 값에서 IP를 알아낼 수는 없어요. */
export async function ipHash(request: Request): Promise<string> {
  return (await hmacHex(hashSecret(), `ip:${clientIp(request)}`)).slice(0, 32);
}

/* ───────── 요청 횟수 제한 ───────── */

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSec: number };

/**
 * bucket(종류)별로 subject(보통 IP 해시)가 windowSec초 동안 limit번까지만 요청하게 해요.
 * 하나의 SQL로 "읽고 + 1 더하기"를 동시에 해서 동시에 요청이 몰려도 정확해요.
 */
export async function rateLimit(
  bucket: string,
  subject: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const row = await getD1()
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
       RETURNING count, reset_at`,
    )
    .bind(`${bucket}:${subject}`, now + windowSec * 1000, now)
    .first<{ count: number; reset_at: number }>();
  const count = row?.count ?? 1;
  const resetAt = row?.reset_at ?? now + windowSec * 1000;
  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

/** 만료된 로그인 정보·카운터를 가끔 청소해요. */
export async function cleanupExpired(): Promise<void> {
  const now = new Date();
  const db = getDb();
  await db.batch([
    db.delete(schema.rateLimits).where(lt(schema.rateLimits.resetAt, now.getTime())),
    db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)),
    db.delete(schema.authChallenges).where(lt(schema.authChallenges.expiresAt, now)),
  ]);
}

/* ───────── 보안 로그 ───────── */

export async function audit(ctx: RequestContext, action: string, detail = '', userId?: number | null) {
  let hash = '';
  try {
    hash = await ipHash(ctx.request);
  } catch {
    // 비밀 키가 없어도 로그는 남겨요.
  }
  await getDb()
    .insert(schema.auditLogs)
    .values({
      userId: userId === undefined ? (ctx.locals.user?.id ?? null) : userId,
      action,
      detail: detail.slice(0, 500),
      ipHash: hash,
      country: requestCountry(ctx.request),
    });
}

/* ───────── 같은 사이트에서 온 요청인지 확인 (CSRF 방지) ───────── */

export function isSameOriginRequest(request: Request, url: URL): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  return false;
}

/* ───────── 보안 헤더 ───────── */

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'usb=()',
  'browsing-topics=()',
].join(', ');

export function withSecurityHeaders(response: Response, url: URL, opts: { private: boolean }): Response {
  let res = response;
  try {
    res.headers.set('X-Content-Type-Options', 'nosniff');
  } catch {
    // 헤더를 바꿀 수 없는 응답이면 복사해서 바꿔요.
    res = new Response(response.body, response);
    res.headers.set('X-Content-Type-Options', 'nosniff');
  }
  const h = res.headers;
  const contentType = h.get('content-type') ?? '';
  const isHtml = contentType.includes('text/html');

  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', PERMISSIONS_POLICY);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (!h.has('Cross-Origin-Resource-Policy')) h.set('Cross-Origin-Resource-Policy', 'same-origin');
  const existing = h.get('Content-Security-Policy');
  if (existing && isHtml) {
    // Astro가 만든 규칙(스크립트·스타일)에 <meta>로는 못 정하는 규칙을 덧붙여요.
    const extra = ["frame-ancestors 'none'"];
    if (isHttps(url)) extra.push('upgrade-insecure-requests');
    h.set('Content-Security-Policy', `${existing.replace(/;\s*$/, '')}; ${extra.join('; ')}`);
  } else if (!existing) {
    const directives = isHtml
      ? ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"]
      : ["default-src 'none'", "frame-ancestors 'none'"];
    if (isHtml && isHttps(url)) directives.push('upgrade-insecure-requests');
    h.set('Content-Security-Policy', directives.join('; '));
  }
  if (isHttps(url)) h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  if (opts.private) {
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
    h.set('X-Robots-Tag', 'noindex, nofollow');
  } else if (isHtml && !h.has('Cache-Control')) {
    h.set('Cache-Control', 'no-cache');
  }
  return res;
}
