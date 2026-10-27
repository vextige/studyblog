/**
 * 글(posts) 읽기·쓰기
 * "공개된 글" = status가 'published'이고 발행 시각이 지금보다 과거인 글 (미래면 예약 발행)
 */
import { and, desc, eq, inArray, isNotNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import type { PostStatus, TagColor } from '../db/schema';
import type { TocItem } from './markdown';
import { mediaUrl } from './media';

const { posts, postTags, tags } = schema;

export type TagRef = { id: number; slug: string; name: string; color: TagColor };

export type PostCard = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  dayNumber: number | null;
  /** 공부한 시간(분) */
  studyMinutes: number | null;
  readingMinutes: number;
  publishedAt: Date;
  viewCount: number;
  coverMediaId: string | null;
  /** 대표 이미지 주소 (/media/해시.webp) */
  coverUrl: string | null;
  featured: boolean;
  tags: TagRef[];
};

export type PostDetail = PostCard & {
  contentHtml: string;
  toc: TocItem[];
  ogMediaId: string | null;
  /** SNS 공유 미리보기 이미지 주소 (없으면 대표 이미지) */
  ogUrl: string | null;
  allowComments: boolean;
  updatedAt: Date;
};

/** 공개된 글 조건 */
export function isPublic(now = Date.now()): SQL {
  return and(eq(posts.status, 'published'), lte(posts.publishedAt, new Date(now)))!;
}

/** 글에 붙은 태그를 JSON 배열 하나로 함께 가져와요. (쿼리를 한 번만 보내려고) */
/**
 * 바깥 글(posts)의 id. 그냥 ${posts.id}로 쓰면 "id"로만 적혀서, 안쪽 표(tags, comments)의 id로 잘못 읽혀요.
 */
const outerPostId = sql.raw('"posts"."id"');

const tagsJson = sql<string>`(
  SELECT json_group_array(json_object('id', t.id, 'slug', t.slug, 'name', t.name, 'color', t.color))
  FROM (
    SELECT tg.id, tg.slug, tg.name, tg.color FROM ${postTags} pt
    JOIN ${tags} tg ON tg.id = pt.tag_id
    WHERE pt.post_id = ${outerPostId}
    ORDER BY tg.sort_order, tg.name
  ) t
)`.as('tags_json');

/** 이미지 주소에 확장자가 필요해서 이미지 형식(mime)을 함께 가져와요. */
const coverMime = sql<string | null>`(SELECT m.mime FROM ${schema.media} m WHERE m.id = "posts"."cover_media_id")`.as('cover_mime');
const ogMime = sql<string | null>`(SELECT m.mime FROM ${schema.media} m WHERE m.id = "posts"."og_media_id")`.as('og_mime');

const cardColumns = {
  id: posts.id,
  slug: posts.slug,
  title: posts.title,
  excerpt: posts.excerpt,
  dayNumber: posts.dayNumber,
  studyMinutes: posts.studyMinutes,
  readingMinutes: posts.readingMinutes,
  publishedAt: posts.publishedAt,
  viewCount: posts.viewCount,
  coverMediaId: posts.coverMediaId,
  coverMime,
  featured: posts.featured,
  tagsJson,
};

type CardRow = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  dayNumber: number | null;
  studyMinutes: number | null;
  readingMinutes: number;
  publishedAt: Date | null;
  viewCount: number;
  coverMediaId: string | null;
  coverMime: string | null;
  featured: boolean;
  tagsJson: string | null;
};

export function parseTags(json: string | null | undefined): TagRef[] {
  if (!json) return [];
  try {
    const list = JSON.parse(json) as TagRef[];
    return Array.isArray(list) ? list.filter((t) => t && typeof t.id === 'number') : [];
  } catch {
    return [];
  }
}

function toCard(row: CardRow): PostCard {
  const { tagsJson: json, publishedAt, coverMime: mime, ...rest } = row;
  return {
    ...rest,
    coverUrl: rest.coverMediaId && mime ? mediaUrl(rest.coverMediaId, mime) : null,
    publishedAt: publishedAt ?? new Date(0),
    tags: parseTags(json),
  };
}

export function cardQuery() {
  return getDb().select(cardColumns).from(posts);
}

/** 글 목록 (태그로 거르기, 페이지 나누기) */
export async function listPublishedPosts(opts: { page?: number; perPage?: number; tagId?: number } = {}) {
  const perPage = opts.perPage ?? 12;
  const page = Math.max(1, opts.page ?? 1);
  const db = getDb();
  const where = opts.tagId
    ? and(isPublic(), sql`${posts.id} IN (SELECT post_id FROM ${postTags} WHERE tag_id = ${opts.tagId})`)
    : isPublic();
  const [rows, total] = await db.batch([
    db
      .select(cardColumns)
      .from(posts)
      .where(where)
      .orderBy(desc(posts.publishedAt), desc(posts.id))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ n: sql<number>`count(*)` }).from(posts).where(where),
  ]);
  const count = total[0]?.n ?? 0;
  return { posts: rows.map(toCard), total: count, page, pages: Math.max(1, Math.ceil(count / perPage)) };
}

export type PublicPostResult = { post: PostDetail } | { redirectTo: string } | null;

export async function getPublishedPost(slug: string): Promise<PublicPostResult> {
  const db = getDb();
  const [found, redirect] = await db.batch([
    db
      .select({
        ...cardColumns,
        contentHtml: posts.contentHtml,
        toc: posts.toc,
        ogMediaId: posts.ogMediaId,
        ogMime,
        allowComments: posts.allowComments,
        updatedAt: posts.updatedAt,
      })
      .from(posts)
      .where(and(eq(posts.slug, slug), isPublic()))
      .limit(1),
    db
      .select({ slug: posts.slug })
      .from(schema.postRedirects)
      .innerJoin(posts, eq(posts.id, schema.postRedirects.postId))
      .where(and(eq(schema.postRedirects.oldSlug, slug), isPublic()))
      .limit(1),
  ]);
  const row = found[0];
  if (row) {
    const { contentHtml, toc, ogMediaId, ogMime: mime, allowComments, updatedAt, ...card } = row;
    const base = toCard(card);
    const ogUrl = ogMediaId && mime ? mediaUrl(ogMediaId, mime) : base.coverUrl;
    return { post: { ...base, contentHtml, toc, ogMediaId, ogUrl, allowComments, updatedAt } };
  }
  if (redirect[0]) return { redirectTo: redirect[0].slug };
  return null;
}

/** 이전 글(더 오래된 글)과 다음 글(더 최근 글) */
export async function getAdjacentPosts(post: Pick<PostCard, 'id' | 'publishedAt'>) {
  const db = getDb();
  const at = post.publishedAt;
  const pick = { slug: posts.slug, title: posts.title, dayNumber: posts.dayNumber };
  const [older, newer] = await db.batch([
    db
      .select(pick)
      .from(posts)
      .where(
        and(isPublic(), or(sql`${posts.publishedAt} < ${at.getTime()}`, and(eq(posts.publishedAt, at), sql`${posts.id} < ${post.id}`))),
      )
      .orderBy(desc(posts.publishedAt), desc(posts.id))
      .limit(1),
    db
      .select(pick)
      .from(posts)
      .where(
        and(isPublic(), or(sql`${posts.publishedAt} > ${at.getTime()}`, and(eq(posts.publishedAt, at), sql`${posts.id} > ${post.id}`))),
      )
      .orderBy(posts.publishedAt, posts.id)
      .limit(1),
  ]);
  return { older: older[0] ?? null, newer: newer[0] ?? null };
}

/** 태그가 많이 겹치는 순서로 비슷한 글 */
export async function getRelatedPosts(postId: number, tagIds: number[], limit = 3): Promise<PostCard[]> {
  if (tagIds.length === 0) return [];
  const rows = await getDb()
    .select(cardColumns)
    .from(posts)
    .innerJoin(postTags, eq(postTags.postId, posts.id))
    .where(and(isPublic(), inArray(postTags.tagId, tagIds), ne(posts.id, postId)))
    .groupBy(posts.id)
    .orderBy(desc(sql`count(*)`), desc(posts.publishedAt))
    .limit(limit);
  return rows.map(toCard);
}

/** 홈 화면에 필요한 것을 한 번에 가져와요. */
export async function getHomeData() {
  const db = getDb();
  const [recent, featured, challengeDays, publishedDates, stats, reactionTotal] = await db.batch([
    db.select(cardColumns).from(posts).where(isPublic()).orderBy(desc(posts.publishedAt), desc(posts.id)).limit(7),
    db
      .select(cardColumns)
      .from(posts)
      .where(and(isPublic(), eq(posts.featured, true)))
      .orderBy(desc(posts.publishedAt))
      .limit(1),
    db
      .select({ day: posts.dayNumber, slug: posts.slug, title: posts.title })
      .from(posts)
      .where(and(isPublic(), isNotNull(posts.dayNumber)))
      .orderBy(posts.dayNumber),
    db.select({ at: posts.publishedAt }).from(posts).where(isPublic()).orderBy(desc(posts.publishedAt)).limit(400),
    db
      .select({
        count: sql<number>`count(*)`,
        views: sql<number>`coalesce(sum(${posts.viewCount}), 0)`,
        minutes: sql<number>`coalesce(sum(${posts.studyMinutes}), 0)`,
      })
      .from(posts)
      .where(isPublic()),
    db.select({ n: sql<number>`count(*)` }).from(schema.reactions),
  ]);
  return {
    recent: recent.map(toCard),
    featured: featured[0] ? toCard(featured[0]) : null,
    challengeDays: challengeDays.filter((d): d is { day: number; slug: string; title: string } => d.day !== null),
    publishedDates: publishedDates.map((d) => d.at).filter((d): d is Date => d !== null),
    postCount: stats[0]?.count ?? 0,
    totalViews: stats[0]?.views ?? 0,
    studyMinutes: stats[0]?.minutes ?? 0,
    reactionCount: reactionTotal[0]?.n ?? 0,
  };
}

/** RSS·사이트맵용 */
export async function listFeedPosts(limit = 20) {
  const rows = await getDb()
    .select({ ...cardColumns, contentHtml: posts.contentHtml, updatedAt: posts.updatedAt })
    .from(posts)
    .where(isPublic())
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(limit);
  return rows.map(({ contentHtml, updatedAt, ...row }) => ({ ...toCard(row), contentHtml, updatedAt }));
}

export async function listSitemapPosts() {
  return getDb()
    .select({ slug: posts.slug, updatedAt: posts.updatedAt })
    .from(posts)
    .where(isPublic())
    .orderBy(desc(posts.publishedAt))
    .limit(5000)
    .all();
}

/** 검색어의 %, _ 같은 특수 문자를 글자 그대로 찾도록 바꿔요. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type SearchHit = PostCard & { snippet: string };

export async function searchPosts(query: string, limit = 10): Promise<SearchHit[]> {
  const terms = query
    .normalize('NFC')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 5)
    .map((t) => t.slice(0, 40));
  if (terms.length === 0) return [];
  const matches = terms.map((term) => {
    const p = likePattern(term);
    return sql`(${posts.title} LIKE ${p} ESCAPE '\\' OR ${posts.excerpt} LIKE ${p} ESCAPE '\\' OR ${posts.contentText} LIKE ${p} ESCAPE '\\')`;
  });
  const first = likePattern(terms[0]!);
  const rows = await getDb()
    .select({ ...cardColumns, contentText: posts.contentText })
    .from(posts)
    .where(and(isPublic(), ...matches))
    .orderBy(desc(sql`CASE WHEN ${posts.title} LIKE ${first} ESCAPE '\\' THEN 1 ELSE 0 END`), desc(posts.publishedAt))
    .limit(limit);
  return rows.map(({ contentText, ...row }) => ({ ...toCard(row), snippet: makeSnippet(contentText, terms) }));
}

function makeSnippet(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, ' ');
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    at = lower.indexOf(term.toLowerCase());
    if (at >= 0) break;
  }
  if (at < 0) return flat.slice(0, 120);
  const start = Math.max(0, at - 40);
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + 140)}${start + 140 < flat.length ? '…' : ''}`;
}

/* ───────── 관리자용 ───────── */

export type AdminPostFilter = 'all' | 'published' | 'scheduled' | 'draft' | 'trashed';

export async function listAdminPosts(opts: { filter: AdminPostFilter; q?: string; page?: number; perPage?: number }) {
  const db = getDb();
  const perPage = opts.perPage ?? 20;
  const page = Math.max(1, opts.page ?? 1);
  const now = new Date();
  const conditions: SQL[] = [];
  if (opts.filter === 'trashed') conditions.push(eq(posts.status, 'trashed'));
  else conditions.push(ne(posts.status, 'trashed'));
  if (opts.filter === 'published') conditions.push(eq(posts.status, 'published'), lte(posts.publishedAt, now));
  if (opts.filter === 'scheduled') conditions.push(eq(posts.status, 'published'), sql`${posts.publishedAt} > ${now.getTime()}`);
  if (opts.filter === 'draft') conditions.push(eq(posts.status, 'draft'));
  const q = opts.q?.trim();
  if (q) conditions.push(sql`(${posts.title} LIKE ${likePattern(q)} ESCAPE '\\' OR ${posts.slug} LIKE ${likePattern(q)} ESCAPE '\\')`);
  const where = and(...conditions);
  const [rows, total, counts] = await db.batch([
    db
      .select({
        id: posts.id,
        slug: posts.slug,
        title: posts.title,
        status: posts.status,
        dayNumber: posts.dayNumber,
        viewCount: posts.viewCount,
        publishedAt: posts.publishedAt,
        updatedAt: posts.updatedAt,
        tagsJson,
        commentCount: sql<number>`(SELECT count(*) FROM comments c WHERE c.post_id = ${outerPostId} AND c.status = 'approved')`,
      })
      .from(posts)
      .where(where)
      .orderBy(desc(posts.updatedAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ n: sql<number>`count(*)` }).from(posts).where(where),
    db
      .select({
        all: sql<number>`coalesce(sum(CASE WHEN ${posts.status} != 'trashed' THEN 1 ELSE 0 END), 0)`,
        published: sql<number>`coalesce(sum(CASE WHEN ${posts.status} = 'published' AND ${posts.publishedAt} <= ${now.getTime()} THEN 1 ELSE 0 END), 0)`,
        scheduled: sql<number>`coalesce(sum(CASE WHEN ${posts.status} = 'published' AND ${posts.publishedAt} > ${now.getTime()} THEN 1 ELSE 0 END), 0)`,
        draft: sql<number>`coalesce(sum(CASE WHEN ${posts.status} = 'draft' THEN 1 ELSE 0 END), 0)`,
        trashed: sql<number>`coalesce(sum(CASE WHEN ${posts.status} = 'trashed' THEN 1 ELSE 0 END), 0)`,
      })
      .from(posts),
  ]);
  const tally = counts[0] ?? { all: 0, published: 0, scheduled: 0, draft: 0, trashed: 0 };
  const count = total[0]?.n ?? 0;
  return {
    posts: rows.map(({ tagsJson: json, ...r }) => ({ ...r, tags: parseTags(json) })),
    total: count,
    page,
    pages: Math.max(1, Math.ceil(count / perPage)),
    tally,
  };
}

export async function getPostForEdit(id: number) {
  const db = getDb();
  const [found, tagRows] = await db.batch([
    db.select().from(posts).where(eq(posts.id, id)).limit(1),
    db
      .select({ id: tags.id, slug: tags.slug, name: tags.name, color: tags.color })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(eq(postTags.postId, id))
      .orderBy(tags.sortOrder, tags.name),
  ]);
  const post = found[0];
  return post ? { ...post, tags: tagRows } : null;
}

export async function nextDayNumber(): Promise<number> {
  const row = await getDb()
    .select({ max: sql<number | null>`max(${posts.dayNumber})` })
    .from(posts)
    .where(ne(posts.status, 'trashed'))
    .get();
  return (row?.max ?? 0) + 1;
}

export function statusLabel(status: PostStatus, publishedAt: Date | null): { label: string; tone: string } {
  if (status === 'trashed') return { label: '휴지통', tone: 'muted' };
  if (status === 'draft') return { label: '임시저장', tone: 'draft' };
  if (publishedAt && publishedAt.getTime() > Date.now()) return { label: '예약됨', tone: 'scheduled' };
  return { label: '발행됨', tone: 'published' };
}
