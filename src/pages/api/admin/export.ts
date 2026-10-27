// 내 블로그 데이터 내보내기 (백업용 JSON 파일 다운로드)
import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../db/client';
import { audit } from '../../../lib/security';
import { getSettings } from '../../../lib/settings';
import { kstDay } from '../../../lib/time';

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) return new Response(null, { status: 401 });
  const db = getDb();
  const [posts, postTags, tags, pages, comments, media, goals] = await db.batch([
    db
      .select({
        id: schema.posts.id,
        slug: schema.posts.slug,
        title: schema.posts.title,
        excerpt: schema.posts.excerpt,
        contentMd: schema.posts.contentMd,
        status: schema.posts.status,
        dayNumber: schema.posts.dayNumber,
        studyMinutes: schema.posts.studyMinutes,
        coverMediaId: schema.posts.coverMediaId,
        featured: schema.posts.featured,
        allowComments: schema.posts.allowComments,
        viewCount: schema.posts.viewCount,
        publishedAt: schema.posts.publishedAt,
        createdAt: schema.posts.createdAt,
        updatedAt: schema.posts.updatedAt,
      })
      .from(schema.posts),
    db.select().from(schema.postTags),
    db.select().from(schema.tags),
    db
      .select({
        slug: schema.pages.slug,
        title: schema.pages.title,
        contentMd: schema.pages.contentMd,
        published: schema.pages.published,
        showInNav: schema.pages.showInNav,
        navOrder: schema.pages.navOrder,
        updatedAt: schema.pages.updatedAt,
      })
      .from(schema.pages),
    db
      .select({
        id: schema.comments.id,
        postId: schema.comments.postId,
        parentId: schema.comments.parentId,
        authorName: schema.comments.authorName,
        body: schema.comments.body,
        status: schema.comments.status,
        isAdmin: schema.comments.isAdmin,
        createdAt: schema.comments.createdAt,
      })
      .from(schema.comments),
    db.select().from(schema.media),
    db.select().from(schema.goals),
  ]);
  const data = {
    exportedAt: new Date().toISOString(),
    note: '이미지 파일 본체는 이 파일에 들어 있지 않아요. 전체 백업은 README의 "백업" 부분을 참고하세요.',
    settings: await getSettings(),
    posts: posts.map((p) => ({ ...p, tags: postTags.filter((pt) => pt.postId === p.id).map((pt) => pt.tagId) })),
    tags,
    pages,
    comments,
    media,
    goals,
  };
  await audit(context, 'export.downloaded');
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="studyblog-backup-${kstDay()}.json"`,
    },
  });
};
