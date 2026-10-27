// 글 조회수 기록. 글을 연 브라우저가 하루에 한 번만 보내요. (봇과 관리자 본인 조회는 세지 않아요)
import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import { recordView } from '../../lib/engagement';
import { isPublic } from '../../lib/posts';
import { waitUntil } from '../../lib/runtime';
import { ipHash, rateLimit } from '../../lib/security';

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|python|curl|wget/i;

export const POST: APIRoute = async ({ request, locals }) => {
  const done = new Response(null, { status: 204 });
  if (locals.user || BOT_UA.test(request.headers.get('user-agent') ?? '')) return done;
  let postId = 0;
  try {
    const body = (await request.json()) as { postId?: unknown };
    postId = Number(body.postId);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!Number.isInteger(postId) || postId <= 0) return new Response(null, { status: 400 });

  const limited = await rateLimit('view', await ipHash(request), 120, 3600);
  if (!limited.ok) return done;

  const post = await getDb()
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(eq(schema.posts.id, postId), isPublic()))
    .get();
  if (post) waitUntil(locals, recordView(post.id));
  return done;
};
