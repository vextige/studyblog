/**
 * 이미지 저장소 (D1 데이터베이스 안에 저장)
 *
 * - 사진은 업로드 전에 브라우저에서 줄이고 WebP로 바꿔요. 이때 위치 정보(EXIF) 같은 숨은 정보도 지워져요.
 * - 서버는 파일 앞부분의 "파일 서명"을 직접 확인해서 진짜 이미지인지 검사해요. (확장자만 믿지 않아요)
 * - SVG는 안에 스크립트를 숨길 수 있어서 받지 않아요.
 */
import { desc, eq, or, sql } from 'drizzle-orm';
import { getD1, getDb, schema } from '../db/client';
import { sha256Hex } from './crypto';

/** D1의 한 행 크기 제한(2MB)보다 조금 작게 */
export const MAX_MEDIA_BYTES = 1_900_000;

export const MEDIA_TYPES = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/avif': 'avif',
} as const;
export type MediaMime = keyof typeof MEDIA_TYPES;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

/** 파일 앞부분(매직 넘버)으로 진짜 형식을 알아내요. */
export function sniffImageType(bytes: Uint8Array): MediaMime | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 12))) return 'image/avif';
  return null;
}

export function mediaUrl(id: string, mime: string): string {
  return `/media/${id}.${MEDIA_TYPES[mime as MediaMime] ?? 'bin'}`;
}

export type SavedMedia = { id: string; mime: MediaMime; size: number; url: string; width: number | null; height: number | null };

export async function saveMedia(
  bytes: Uint8Array<ArrayBuffer>,
  opts: { alt?: string; width?: number | null; height?: number | null },
): Promise<SavedMedia> {
  const mime = sniffImageType(bytes);
  if (!mime) throw new Error('PNG, JPG, WebP, GIF, AVIF 이미지만 올릴 수 있어요.');
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error('이미지가 너무 커요. (최대 1.9MB)');
  const id = (await sha256Hex(bytes)).slice(0, 24);
  const clamp = (n: number | null | undefined) =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 20000 ? Math.round(n) : null;
  const width = clamp(opts.width);
  const height = clamp(opts.height);
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare('INSERT OR IGNORE INTO media (id, mime, size, width, height, alt) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(id, mime, bytes.byteLength, width, height, (opts.alt ?? '').slice(0, 200)),
    d1.prepare('INSERT OR IGNORE INTO media_blobs (media_id, data) VALUES (?1, ?2)').bind(id, bytes),
  ]);
  return { id, mime, size: bytes.byteLength, url: mediaUrl(id, mime), width, height };
}

function toBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return null;
}

export async function getMediaFile(id: string): Promise<{ mime: string; bytes: Uint8Array<ArrayBuffer> } | null> {
  const row = await getD1()
    .prepare('SELECT m.mime AS mime, b.data AS data FROM media m JOIN media_blobs b ON b.media_id = m.id WHERE m.id = ?1')
    .bind(id)
    .first<{ mime: string; data: unknown }>();
  if (!row) return null;
  const bytes = toBytes(row.data);
  return bytes ? { mime: row.mime, bytes } : null;
}

export async function listMedia(page = 1, perPage = 40) {
  const db = getDb();
  const [rows, total] = await db.batch([
    db
      .select()
      .from(schema.media)
      .orderBy(desc(schema.media.createdAt))
      .limit(perPage)
      .offset((Math.max(1, page) - 1) * perPage),
    db.select({ n: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${schema.media.size}), 0)` }).from(schema.media),
  ]);
  return {
    items: rows.map((m) => ({ ...m, url: mediaUrl(m.id, m.mime) })),
    total: total[0]?.n ?? 0,
    totalBytes: total[0]?.bytes ?? 0,
    pages: Math.max(1, Math.ceil((total[0]?.n ?? 0) / perPage)),
  };
}

/** 이 이미지를 쓰는 글·페이지 수 */
export async function mediaUsage(id: string): Promise<number> {
  const pattern = `%/media/${id}%`;
  const db = getDb();
  const [postUse, pageUse] = await db.batch([
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.posts)
      .where(
        or(
          sql`${schema.posts.contentMd} LIKE ${pattern}`,
          eq(schema.posts.coverMediaId, id),
          eq(schema.posts.ogMediaId, id),
        ),
      ),
    db.select({ n: sql<number>`count(*)` }).from(schema.pages).where(sql`${schema.pages.contentMd} LIKE ${pattern}`),
  ]);
  return (postUse[0]?.n ?? 0) + (pageUse[0]?.n ?? 0);
}

export async function deleteMedia(id: string) {
  await getDb().delete(schema.media).where(eq(schema.media.id, id));
}
