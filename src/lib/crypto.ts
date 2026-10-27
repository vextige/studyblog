// 암호화 도우미. 브라우저·Cloudflare Workers·Node가 모두 가진 Web Crypto API만 써요.

const encoder = new TextEncoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** 추측할 수 없는 무작위 문자열 (기본 32바이트 = 256비트) */
export function randomToken(length = 32): string {
  return bytesToBase64Url(randomBytes(length));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const data = typeof input === 'string' ? encoder.encode(input) : input;
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

export async function hmacHex(secret: string, input: string): Promise<string> {
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, key);
  }
  return toHex(await crypto.subtle.sign('HMAC', await key, encoder.encode(input)));
}

/** 두 문자열 비교에 걸리는 시간이 내용과 상관없이 똑같도록 비교해요. (타이밍 공격 방지) */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}
