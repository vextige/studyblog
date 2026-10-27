// 이미지 목록 보기 · 업로드 (관리자 전용 — 로그인 확인은 middleware.ts에서도 해요)
import type { APIRoute } from 'astro';
import { listMedia, MAX_MEDIA_BYTES, saveMedia } from '../../../lib/media';

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** 글쓰기 화면의 "이미지 고르기" 창에서 써요. */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) return reply(401, { error: '로그인이 필요해요.' });
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const { items, pages } = await listMedia(page, 30);
  return reply(200, {
    page,
    pages,
    items: items.map((m) => ({ id: m.id, url: m.url, alt: m.alt, width: m.width, height: m.height, size: m.size })),
  });
};

export const POST: APIRoute = async ({ request, url, locals }) => {
  if (!locals.user) return reply(401, { error: '로그인이 필요해요.' });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_MEDIA_BYTES) return reply(413, { error: '이미지가 너무 커요. (최대 1.9MB)' });
  if (!(request.headers.get('content-type') ?? '').startsWith('image/')) {
    return reply(415, { error: '이미지 파일만 올릴 수 있어요.' });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return reply(400, { error: '빈 파일이에요.' });
  try {
    const saved = await saveMedia(bytes, {
      alt: url.searchParams.get('alt') ?? '',
      width: Number(url.searchParams.get('w')) || null,
      height: Number(url.searchParams.get('h')) || null,
    });
    return reply(201, saved);
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : '업로드하지 못했어요.' });
  }
};
