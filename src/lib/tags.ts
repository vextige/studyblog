import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import { TAG_COLORS, type TagColor } from '../db/schema';
import { slugify } from './slug';

const { tags, postTags, posts } = schema;
/** 바깥 태그(tags)의 id. 안쪽 글 표(p)의 id와 헷갈리지 않게 표 이름까지 적어요. */
const outerTagId = sql.raw('"tags"."id"');

export type TagWithCount = {
  id: number;
  slug: string;
  name: string;
  description: string;
  color: TagColor;
  sortOrder: number;
  count: number;
};

/** 공개된 글 수와 함께 태그 목록 (publicOnly=false면 모든 글 수) */
export async function listTags(opts: { publicOnly?: boolean } = {}): Promise<TagWithCount[]> {
  const publicOnly = opts.publicOnly ?? true;
  const countExpr = publicOnly
    ? sql<number>`(SELECT count(*) FROM ${postTags} pt JOIN ${posts} p ON p.id = pt.post_id
        WHERE pt.tag_id = ${outerTagId} AND p.status = 'published' AND p.published_at <= ${Date.now()})`
    : sql<number>`(SELECT count(*) FROM ${postTags} pt JOIN ${posts} p ON p.id = pt.post_id
        WHERE pt.tag_id = ${outerTagId} AND p.status != 'trashed')`;
  return getDb()
    .select({
      id: tags.id,
      slug: tags.slug,
      name: tags.name,
      description: tags.description,
      color: tags.color,
      sortOrder: tags.sortOrder,
      count: countExpr,
    })
    .from(tags)
    .orderBy(asc(tags.sortOrder), asc(tags.name))
    .all();
}

export async function getTagBySlug(slug: string) {
  return getDb().select().from(tags).where(eq(tags.slug, slug)).get();
}

async function uniqueTagSlug(base: string, exceptId?: number): Promise<string> {
  const root = base || `tag-${Date.now().toString(36)}`;
  const db = getDb();
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const clash = await db
      .select({ id: tags.id })
      .from(tags)
      .where(exceptId ? and(eq(tags.slug, candidate), ne(tags.id, exceptId)) : eq(tags.slug, candidate))
      .get();
    if (!clash) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export function cleanTagName(name: string): string {
  return name.normalize('NFC').replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

/** 이름으로 태그를 찾고, 없는 건 새로 만들어서 ID 목록을 돌려줘요. */
export async function resolveTagIds(names: string[]): Promise<number[]> {
  const clean = [...new Set(names.map(cleanTagName).filter(Boolean))].slice(0, 10);
  if (clean.length === 0) return [];
  const db = getDb();
  const existing = await db.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.name, clean)).all();
  const byName = new Map(existing.map((t) => [t.name, t.id]));
  const total = await db.select({ n: sql<number>`count(*)` }).from(tags).get();
  let colorIndex = total?.n ?? 0;
  for (const name of clean) {
    if (byName.has(name)) continue;
    const color = TAG_COLORS[colorIndex++ % TAG_COLORS.length]!;
    const created = await db
      .insert(tags)
      .values({ name, slug: await uniqueTagSlug(slugify(name)), color, sortOrder: colorIndex })
      .returning({ id: tags.id })
      .get();
    byName.set(name, created.id);
  }
  return clean.map((name) => byName.get(name)!).filter(Boolean);
}

export async function createTag(input: { name: string; description: string; color: TagColor }) {
  const name = cleanTagName(input.name);
  const db = getDb();
  const max = await db.select({ n: sql<number>`coalesce(max(${tags.sortOrder}), 0)` }).from(tags).get();
  return db
    .insert(tags)
    .values({
      name,
      slug: await uniqueTagSlug(slugify(name)),
      description: input.description.trim().slice(0, 200),
      color: input.color,
      sortOrder: (max?.n ?? 0) + 1,
    })
    .returning()
    .get();
}

export async function updateTag(id: number, input: { name: string; description: string; color: TagColor; slug: string }) {
  const name = cleanTagName(input.name);
  await getDb()
    .update(tags)
    .set({
      name,
      slug: await uniqueTagSlug(slugify(input.slug || name), id),
      description: input.description.trim().slice(0, 200),
      color: input.color,
    })
    .where(eq(tags.id, id));
}

export async function deleteTag(id: number) {
  await getDb().delete(tags).where(eq(tags.id, id));
}

export async function reorderTags(ids: number[]) {
  const db = getDb();
  const [first, ...rest] = ids.map((id, index) => db.update(tags).set({ sortOrder: index + 1 }).where(eq(tags.id, id)));
  if (first) await db.batch([first, ...rest]);
}
