import { and, asc, eq, ne } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import { renderMarkdown } from './markdown';
import { EditorError } from './post-editor';
import { isValidSlug, RESERVED_SLUGS, slugify } from './slug';

const { pages } = schema;

export async function getPublishedPage(slug: string) {
  return getDb()
    .select()
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.published, true)))
    .get();
}

export async function listNavPages() {
  return getDb()
    .select({ slug: pages.slug, title: pages.title })
    .from(pages)
    .where(and(eq(pages.published, true), eq(pages.showInNav, true)))
    .orderBy(asc(pages.navOrder), asc(pages.title))
    .all();
}

export async function listAllPages() {
  return getDb()
    .select({
      id: pages.id,
      slug: pages.slug,
      title: pages.title,
      published: pages.published,
      showInNav: pages.showInNav,
      navOrder: pages.navOrder,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .orderBy(asc(pages.navOrder), asc(pages.title))
    .all();
}

export async function getPageForEdit(id: number) {
  return getDb().select().from(pages).where(eq(pages.id, id)).get();
}

export type SavePageInput = {
  id?: number;
  title: string;
  slug: string;
  contentMd: string;
  published: boolean;
  showInNav: boolean;
  navOrder: number;
  baseUpdatedAt?: number;
};

export async function savePage(input: SavePageInput) {
  const db = getDb();
  const title = input.title.trim();
  if (!title) throw new EditorError('제목을 적어 주세요.');
  const slug = slugify(input.slug || title);
  if (!isValidSlug(slug)) throw new EditorError('주소에는 영어 소문자, 숫자, 한글, 하이픈(-)만 쓸 수 있어요.');
  if (RESERVED_SLUGS.has(slug)) throw new EditorError(`"${slug}"는 사이트가 이미 쓰는 주소라서 쓸 수 없어요.`);
  const clash = await db
    .select({ id: pages.id })
    .from(pages)
    .where(input.id ? and(eq(pages.slug, slug), ne(pages.id, input.id)) : eq(pages.slug, slug))
    .get();
  if (clash) throw new EditorError(`"${slug}" 주소는 다른 페이지가 이미 쓰고 있어요.`);

  const existing = input.id ? await db.select().from(pages).where(eq(pages.id, input.id)).get() : undefined;
  if (input.id && !existing) throw new EditorError('페이지를 찾을 수 없어요.', 'NOT_FOUND');
  if (existing && input.baseUpdatedAt && existing.updatedAt.getTime() !== input.baseUpdatedAt) {
    throw new EditorError('다른 창에서 이 페이지가 먼저 저장됐어요. 새로고침해 주세요.', 'CONFLICT');
  }
  const now = new Date();
  const values = {
    title,
    slug,
    contentMd: input.contentMd,
    contentHtml: renderMarkdown(input.contentMd).html,
    published: input.published,
    showInNav: input.showInNav,
    navOrder: input.navOrder,
    updatedAt: now,
  };
  if (existing) {
    await db.update(pages).set(values).where(eq(pages.id, existing.id));
    return { id: existing.id, slug, updatedAt: now.getTime() };
  }
  const created = await db.insert(pages).values({ ...values, createdAt: now }).returning({ id: pages.id }).get();
  return { id: created.id, slug, updatedAt: now.getTime() };
}

export async function deletePage(id: number) {
  await getDb().delete(pages).where(eq(pages.id, id));
}
