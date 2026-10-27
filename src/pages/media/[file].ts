// 업로드한 이미지 보여 주기: /media/{해시}.{확장자} (확장자 없이 /media/{해시} 도 돼요)
import type { APIRoute } from 'astro';
import { getMediaFile, MEDIA_TYPES, type MediaMime } from '../../lib/media';
import { waitUntil } from '../../lib/runtime';

const FILE_PATTERN = /^([a-f0-9]{24})(?:\.(webp|png|jpg|gif|avif))?$/;

export const GET: APIRoute = async ({ params, request, locals }) => {
  const match = FILE_PATTERN.exec(params.file ?? '');
  if (!match) return new Response('Not found', { status: 404 });
  const [, id, ext] = match;
  const etag = `"${id}"`;
  const headers: Record<string, string> = {
    // 파일 이름이 내용의 해시라서 내용이 바뀌면 주소도 바뀌어요. 그래서 1년 동안 마음 놓고 저장(캐시)해도 돼요.
    'cache-control': 'public, max-age=31536000, immutable',
    etag,
    // 이미지를 직접 열어도 스크립트가 실행되지 않게 막아요.
    'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'cross-origin-resource-policy': 'cross-origin',
    'x-content-type-options': 'nosniff',
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });

  // Cloudflare의 기본 캐시 (브라우저 타입에는 없어서 이름을 알려 줘요)
  const cache = (caches as unknown as { default: Cache }).default;
  const cached = await cache.match(request).catch(() => undefined);
  if (cached) return cached;

  const file = await getMediaFile(id!);
  if (!file || (ext && MEDIA_TYPES[file.mime as MediaMime] !== ext)) return new Response('Not found', { status: 404 });
  const response = new Response(file.bytes, {
    headers: { ...headers, 'content-type': file.mime, 'content-length': String(file.bytes.byteLength) },
  });
  waitUntil(locals, cache.put(request, response.clone()));
  return response;
};
