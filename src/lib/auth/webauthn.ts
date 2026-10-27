/**
 * 패스키(WebAuthn) 로그인
 *
 * 비밀번호 대신 내 기기(지문·얼굴·Windows Hello·휴대폰)로 로그인해요.
 * - 서버에는 공개 키만 저장돼요. 비밀 키는 기기 밖으로 나오지 않아서 서버가 털려도 로그인을 훔칠 수 없어요.
 * - 패스키는 이 사이트 주소에만 묶여 있어서 가짜(피싱) 사이트에서는 작동하지 않아요.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, count, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import { base64UrlToBytes, bytesToBase64Url, randomBytes, randomToken } from '../crypto';
import { isHttps, siteOrigin, type RequestContext } from '../runtime';

const CHALLENGE_TTL = 5 * 60 * 1000;

function challengeCookieName(url: URL) {
  return isHttps(url) ? '__Host-sb_webauthn' : 'sb_webauthn';
}

function relyingParty(url: URL) {
  const origin = siteOrigin(url);
  return { origin, rpID: new URL(origin).hostname };
}

export class PasskeyError extends Error {}

async function storeChallenge(
  ctx: RequestContext,
  purpose: 'register' | 'login',
  challenge: string,
  userId: number | null,
) {
  const id = randomToken(24);
  await getDb()
    .insert(schema.authChallenges)
    .values({ id, challenge, purpose, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL) });
  ctx.cookies.set(challengeCookieName(ctx.url), id, {
    httpOnly: true,
    secure: isHttps(ctx.url),
    sameSite: 'strict',
    path: '/',
    maxAge: CHALLENGE_TTL / 1000,
  });
}

/** 도전 값은 한 번 쓰면 바로 지워요. (같은 응답을 다시 보내는 재전송 공격 방지) */
async function consumeChallenge(ctx: RequestContext, purpose: 'register' | 'login') {
  const name = challengeCookieName(ctx.url);
  const id = ctx.cookies.get(name)?.value;
  ctx.cookies.delete(name, { httpOnly: true, secure: isHttps(ctx.url), sameSite: 'strict', path: '/' });
  if (!id) throw new PasskeyError('로그인 요청이 만료됐어요. 다시 시도해 주세요.');
  const row = await getDb()
    .delete(schema.authChallenges)
    .where(eq(schema.authChallenges.id, id))
    .returning()
    .get();
  if (!row || row.purpose !== purpose || row.expiresAt.getTime() < Date.now()) {
    throw new PasskeyError('로그인 요청이 만료됐어요. 다시 시도해 주세요.');
  }
  return row;
}

export async function countPasskeys(): Promise<number> {
  const row = await getDb().select({ n: count() }).from(schema.passkeys).get();
  return row?.n ?? 0;
}

/** 블로그 주인 계정을 가져오고, 없으면 만들어요. */
export async function ensureOwner(displayName: string) {
  const db = getDb();
  const existing = await db.select().from(schema.users).orderBy(schema.users.id).limit(1).get();
  if (existing) return existing;
  return db
    .insert(schema.users)
    .values({ displayName, webauthnUserId: bytesToBase64Url(randomBytes(32)) })
    .returning()
    .get();
}

export async function startRegistration(
  ctx: RequestContext,
  user: { id: number; displayName: string; webauthnUserId: string },
  siteTitle: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = relyingParty(ctx.url);
  const existing = await getDb()
    .select({ id: schema.passkeys.id, transports: schema.passkeys.transports })
    .from(schema.passkeys)
    .where(eq(schema.passkeys.userId, user.id))
    .all();
  const options = await generateRegistrationOptions({
    rpName: siteTitle,
    rpID,
    userName: user.displayName,
    userDisplayName: user.displayName,
    userID: base64UrlToBytes(user.webauthnUserId),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: CHALLENGE_TTL,
  });
  await storeChallenge(ctx, 'register', options.challenge, user.id);
  return options;
}

export async function finishRegistration(ctx: RequestContext, response: RegistrationResponseJSON, name: string) {
  const challenge = await consumeChallenge(ctx, 'register');
  if (!challenge.userId) throw new PasskeyError('등록 요청이 올바르지 않아요.');
  const { origin, rpID } = relyingParty(ctx.url);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    throw new PasskeyError(`패스키를 확인하지 못했어요. (${error instanceof Error ? error.message : '알 수 없는 오류'})`);
  }
  if (!verification.verified) throw new PasskeyError('패스키를 확인하지 못했어요.');
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  await getDb()
    .insert(schema.passkeys)
    .values({
      id: credential.id,
      userId: challenge.userId,
      publicKey: bytesToBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: name.trim().slice(0, 40) || '내 패스키',
    });
  return { userId: challenge.userId, credentialId: credential.id };
}

export async function startLogin(ctx: RequestContext): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = relyingParty(ctx.url);
  // 저장된 패스키를 브라우저가 알아서 보여 주도록(allowCredentials 비움) 해요.
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', timeout: CHALLENGE_TTL });
  await storeChallenge(ctx, 'login', options.challenge, null);
  return options;
}

export async function finishLogin(ctx: RequestContext, response: AuthenticationResponseJSON) {
  const challenge = await consumeChallenge(ctx, 'login');
  const db = getDb();
  const passkey = await db.select().from(schema.passkeys).where(eq(schema.passkeys.id, response.id)).get();
  if (!passkey) throw new PasskeyError('등록되지 않은 패스키예요.');
  const { origin, rpID } = relyingParty(ctx.url);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: base64UrlToBytes(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
  } catch (error) {
    throw new PasskeyError(`패스키를 확인하지 못했어요. (${error instanceof Error ? error.message : '알 수 없는 오류'})`);
  }
  if (!verification.verified) throw new PasskeyError('패스키를 확인하지 못했어요.');
  await db
    .update(schema.passkeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(schema.passkeys.id, passkey.id));
  return { userId: passkey.userId, passkeyName: passkey.name };
}

export async function listPasskeys(userId: number) {
  return getDb()
    .select({
      id: schema.passkeys.id,
      name: schema.passkeys.name,
      deviceType: schema.passkeys.deviceType,
      backedUp: schema.passkeys.backedUp,
      createdAt: schema.passkeys.createdAt,
      lastUsedAt: schema.passkeys.lastUsedAt,
    })
    .from(schema.passkeys)
    .where(eq(schema.passkeys.userId, userId))
    .orderBy(schema.passkeys.createdAt)
    .all();
}

export async function renamePasskey(userId: number, id: string, name: string) {
  await getDb()
    .update(schema.passkeys)
    .set({ name: name.trim().slice(0, 40) || '내 패스키' })
    .where(and(eq(schema.passkeys.userId, userId), eq(schema.passkeys.id, id)));
}

/** 마지막 남은 패스키는 지울 수 없어요. (지우면 아무도 로그인 못 하니까요) */
export async function deletePasskey(userId: number, id: string): Promise<boolean> {
  const db = getDb();
  const total = await db.select({ n: count() }).from(schema.passkeys).where(eq(schema.passkeys.userId, userId)).get();
  if ((total?.n ?? 0) <= 1) return false;
  await db.delete(schema.passkeys).where(and(eq(schema.passkeys.userId, userId), eq(schema.passkeys.id, id)));
  return true;
}
