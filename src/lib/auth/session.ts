/**
 * 로그인 세션
 *
 * - 로그인하면 추측할 수 없는 무작위 토큰을 만들어 쿠키에 넣어요.
 * - DB에는 토큰 자체가 아니라 SHA-256 해시만 저장해요. DB가 유출돼도 쿠키를 위조할 수 없어요.
 * - 쿠키: HttpOnly(자바스크립트로 못 읽음) + Secure(HTTPS에서만) + SameSite=Lax(다른 사이트 요청엔 안 붙음)
 * - 14일 동안 안 쓰면 자동 로그아웃, 쓰고 있으면 기간이 자동으로 늘어나요.
 */
import { and, desc, eq, ne } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import { randomToken, sha256Hex } from '../crypto';
import { isHttps, requestCountry, waitUntil, type RequestContext } from '../runtime';

export type SessionUser = { id: number; displayName: string };
export type SessionInfo = { id: string; createdAt: Date; expiresAt: Date };

const DAY = 86_400_000;
export const SESSION_TTL = 14 * DAY;
const REFRESH_WHEN_LEFT = 7 * DAY;
const TOUCH_INTERVAL = 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function sessionCookieName(url: URL): string {
  return isHttps(url) ? '__Host-sb_session' : 'sb_session';
}

function cookieOptions(url: URL) {
  return { httpOnly: true, secure: isHttps(url), sameSite: 'lax' as const, path: '/' };
}

function setSessionCookie(ctx: RequestContext, token: string, expires: Date) {
  ctx.cookies.set(sessionCookieName(ctx.url), token, { ...cookieOptions(ctx.url), expires });
}

export function clearSessionCookie(ctx: RequestContext) {
  ctx.cookies.delete(sessionCookieName(ctx.url), cookieOptions(ctx.url));
}

export async function createSession(ctx: RequestContext, userId: number): Promise<void> {
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL);
  await getDb()
    .insert(schema.sessions)
    .values({
      id: await sha256Hex(token),
      userId,
      createdAt: new Date(now),
      expiresAt,
      lastSeenAt: new Date(now),
      userAgent: (ctx.request.headers.get('user-agent') ?? '').slice(0, 300),
      country: requestCountry(ctx.request),
    });
  setSessionCookie(ctx, token, expiresAt);
}

export async function validateSession(
  ctx: RequestContext,
): Promise<{ user: SessionUser; session: SessionInfo } | null> {
  const token = ctx.cookies.get(sessionCookieName(ctx.url))?.value;
  if (!token) return null;
  if (!TOKEN_PATTERN.test(token)) {
    clearSessionCookie(ctx);
    return null;
  }
  const id = await sha256Hex(token);
  const db = getDb();
  const row = await db
    .select({
      userId: schema.sessions.userId,
      createdAt: schema.sessions.createdAt,
      expiresAt: schema.sessions.expiresAt,
      lastSeenAt: schema.sessions.lastSeenAt,
      displayName: schema.users.displayName,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, id))
    .get();

  const now = Date.now();
  if (!row || row.expiresAt.getTime() <= now) {
    if (row) waitUntil(ctx.locals, db.delete(schema.sessions).where(eq(schema.sessions.id, id)));
    clearSessionCookie(ctx);
    return null;
  }

  let expiresAt = row.expiresAt;
  if (expiresAt.getTime() - now < REFRESH_WHEN_LEFT) {
    expiresAt = new Date(now + SESSION_TTL);
    setSessionCookie(ctx, token, expiresAt);
    waitUntil(
      ctx.locals,
      db.update(schema.sessions).set({ expiresAt, lastSeenAt: new Date(now) }).where(eq(schema.sessions.id, id)),
    );
  } else if (now - row.lastSeenAt.getTime() > TOUCH_INTERVAL) {
    waitUntil(ctx.locals, db.update(schema.sessions).set({ lastSeenAt: new Date(now) }).where(eq(schema.sessions.id, id)));
  }

  return {
    user: { id: row.userId, displayName: row.displayName },
    session: { id, createdAt: row.createdAt, expiresAt },
  };
}

export async function destroyCurrentSession(ctx: RequestContext): Promise<void> {
  const current = ctx.locals.session;
  if (current) await getDb().delete(schema.sessions).where(eq(schema.sessions.id, current.id));
  clearSessionCookie(ctx);
}

export async function listSessions(userId: number) {
  return getDb()
    .select({
      id: schema.sessions.id,
      createdAt: schema.sessions.createdAt,
      lastSeenAt: schema.sessions.lastSeenAt,
      expiresAt: schema.sessions.expiresAt,
      userAgent: schema.sessions.userAgent,
      country: schema.sessions.country,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .orderBy(desc(schema.sessions.lastSeenAt))
    .all();
}

export async function revokeSession(userId: number, sessionId: string): Promise<void> {
  await getDb()
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.id, sessionId)));
}

export async function revokeOtherSessions(userId: number, keepSessionId: string): Promise<void> {
  await getDb()
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, keepSessionId)));
}

/** "Chrome · Windows" 처럼 사람이 알아보기 쉬운 기기 이름 */
export function describeUserAgent(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Whale\//.test(ua)
      ? '웨일'
      : /SamsungBrowser\//.test(ua)
        ? '삼성 인터넷'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : '브라우저';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '알 수 없는 기기';
  return `${browser} · ${os}`;
}
