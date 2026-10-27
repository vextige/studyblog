/**
 * 관리자 글쓰기: 저장 · 발행 · 휴지통 · 버전 기록
 */
import { and, desc, eq, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import { makeExcerpt, renderMarkdown } from './markdown';
import { isValidSlug, slugify } from './slug';
import { resolveTagIds } from './tags';

const { posts, postTags, postRevisions, postRedirects } = schema;
const MAX_REVISIONS = 30;

export class EditorError extends Error {
  constructor(
    message: string,
    readonly code: 'CONFLICT' | 'BAD_REQUEST' | 'NOT_FOUND' = 'BAD_REQUEST',
  ) {
    super(message);
  }
}

export type SavePostInput = {
  id?: number;
  title: string;
  slug: string;
  contentMd: string;
  excerpt: string;
  tagNames: string[];
  dayNumber: number | null;
  studyMinutes: number | null;
  status: 'draft' | 'published';
  publishedAt: Date | null;
  coverMediaId: string | null;
  ogMediaId: string | null;
  featured: boolean;
  allowComments: boolean;
  /** 다른 탭에서 먼저 저장했는지 확인하는 값 (마지막으로 불러온 updatedAt) */
  baseUpdatedAt?: number;
};

async function slugTaken(slug: string, exceptId?: number): Promise<boolean> {
  const row = await getDb()
    .select({ id: posts.id })
    .from(posts)
    .where(exceptId ? and(eq(posts.slug, slug), ne(posts.id, exceptId)) : eq(posts.slug, slug))
    .get();
  return Boolean(row);
}

async function chooseSlug(input: SavePostInput): Promise<string> {
  const wanted = input.slug.trim();
  if (wanted) {
    const slug = slugify(wanted);
    if (!isValidSlug(slug)) throw new EditorError('주소에는 영어 소문자, 숫자, 한글, 하이픈(-)만 쓸 수 있어요.');
    if (await slugTaken(slug, input.id)) throw new EditorError(`"${slug}" 주소는 다른 글이 이미 쓰고 있어요.`);
    return slug;
  }
  const base =
    slugify(input.title) || (input.dayNumber ? `day-${String(input.dayNumber).padStart(3, '0')}` : `post-${Date.now().toString(36)}`);
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await slugTaken(candidate, input.id))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function savePost(input: SavePostInput) {
  const db = getDb();
  const title = input.title.trim();
  if (!title) throw new EditorError('제목을 적어 주세요.');

  const existing = input.id ? await db.select().from(posts).where(eq(posts.id, input.id)).get() : undefined;
  if (input.id && !existing) throw new EditorError('글을 찾을 수 없어요. 삭제되었을 수 있어요.', 'NOT_FOUND');
  if (existing && input.baseUpdatedAt && existing.updatedAt.getTime() !== input.baseUpdatedAt) {
    throw new EditorError('다른 창에서 이 글이 먼저 저장됐어요. 새로고침해서 최신 내용을 확인해 주세요.', 'CONFLICT');
  }

  const rendered = renderMarkdown(input.contentMd);
  const slug = await chooseSlug(input);
  const now = new Date();
  const publishedAt =
    input.status === 'published' ? (input.publishedAt ?? existing?.publishedAt ?? now) : (input.publishedAt ?? existing?.publishedAt ?? null);

  const values = {
    slug,
    title,
    excerpt: input.excerpt.trim() || makeExcerpt(rendered.prose),
    contentMd: input.contentMd,
    contentHtml: rendered.html,
    contentText: rendered.text,
    toc: rendered.toc,
    readingMinutes: rendered.readingMinutes,
    status: input.status,
    dayNumber: input.dayNumber,
    studyMinutes: input.studyMinutes,
    coverMediaId: input.coverMediaId,
    ogMediaId: input.ogMediaId,
    featured: input.featured,
    allowComments: input.allowComments,
    publishedAt,
    updatedAt: now,
  };

  let id: number;
  if (existing) {
    id = existing.id;
    await db.update(posts).set(values).where(eq(posts.id, id));
  } else {
    const created = await db.insert(posts).values({ ...values, createdAt: now }).returning({ id: posts.id }).get();
    id = created.id;
  }

  const tagIds = await resolveTagIds(input.tagNames);
  const followUps = [
    db.delete(postTags).where(tagIds.length ? and(eq(postTags.postId, id), notInArray(postTags.tagId, tagIds)) : eq(postTags.postId, id)),
    // 새 주소가 예전에 다른 글의 옛 주소였다면 그 연결은 지워요.
    db.delete(postRedirects).where(eq(postRedirects.oldSlug, slug)),
  ];
  const [first, ...rest] = [
    ...followUps,
    ...(tagIds.length
      ? [db.insert(postTags).values(tagIds.map((tagId) => ({ postId: id, tagId }))).onConflictDoNothing()]
      : []),
    // 발행된 글의 주소를 바꾸면, 옛 주소로 들어와도 새 주소로 보내 줘요.
    ...(existing && existing.slug !== slug && existing.status === 'published'
      ? [db.insert(postRedirects).values({ oldSlug: existing.slug, postId: id }).onConflictDoNothing()]
      : []),
    ...(input.featured ? [db.update(posts).set({ featured: false }).where(and(ne(posts.id, id), eq(posts.featured, true)))] : []),
  ];
  await db.batch([first!, ...rest]);

  // 버전 기록: 마지막 기록과 내용이 다를 때만 남겨요.
  const last = await db
    .select({ title: postRevisions.title, contentMd: postRevisions.contentMd })
    .from(postRevisions)
    .where(eq(postRevisions.postId, id))
    .orderBy(desc(postRevisions.createdAt))
    .limit(1)
    .get();
  if (!last || last.title !== title || last.contentMd !== input.contentMd) {
    await db.insert(postRevisions).values({ postId: id, title, contentMd: input.contentMd, createdAt: now });
    const old = await db
      .select({ id: postRevisions.id })
      .from(postRevisions)
      .where(eq(postRevisions.postId, id))
      .orderBy(desc(postRevisions.createdAt))
      .offset(MAX_REVISIONS)
      .limit(100)
      .all();
    if (old.length) await db.delete(postRevisions).where(inArray(postRevisions.id, old.map((r) => r.id)));
  }

  return { id, slug, status: input.status, publishedAt, updatedAt: now.getTime() };
}

export async function setPostStatus(id: number, status: 'draft' | 'trashed' | 'published') {
  const db = getDb();
  const post = await db.select({ publishedAt: posts.publishedAt }).from(posts).where(eq(posts.id, id)).get();
  if (!post) throw new EditorError('글을 찾을 수 없어요.', 'NOT_FOUND');
  await db
    .update(posts)
    .set({
      status,
      featured: status === 'trashed' ? false : undefined,
      publishedAt: status === 'published' ? (post.publishedAt ?? new Date()) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, id));
}

export async function deletePostForever(id: number) {
  await getDb()
    .delete(posts)
    .where(and(eq(posts.id, id), eq(posts.status, 'trashed')));
}

export async function emptyTrash(olderThanDays = 0) {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  await getDb()
    .delete(posts)
    .where(and(eq(posts.status, 'trashed'), lt(posts.updatedAt, cutoff)));
}

export async function listRevisions(postId: number) {
  return getDb()
    .select({
      id: postRevisions.id,
      title: postRevisions.title,
      createdAt: postRevisions.createdAt,
      length: sql<number>`length(${postRevisions.contentMd})`,
    })
    .from(postRevisions)
    .where(eq(postRevisions.postId, postId))
    .orderBy(desc(postRevisions.createdAt))
    .all();
}

export async function getRevision(postId: number, revisionId: number) {
  return getDb()
    .select()
    .from(postRevisions)
    .where(and(eq(postRevisions.postId, postId), eq(postRevisions.id, revisionId)))
    .get();
}
