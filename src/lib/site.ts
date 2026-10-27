// 모든 화면이 함께 쓰는 정보(블로그 설정 + 메뉴 + 검색 창의 태그)를 한 번에 가져와요.
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import type { TagRef } from './posts';
import { parseSettings, SETTINGS_KEY, type SiteSettings } from './settings';

export type NavPage = { slug: string; title: string };
export type SiteChrome = { settings: SiteSettings; navPages: NavPage[]; tags: Pick<TagRef, 'slug' | 'name' | 'color'>[] };

async function loadChrome(): Promise<SiteChrome> {
  const db = getDb();
  const { tags, postTags, posts } = schema;
  const [settingsRows, navPages, tagRows] = await db.batch([
    db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, SETTINGS_KEY)).limit(1),
    db
      .select({ slug: schema.pages.slug, title: schema.pages.title })
      .from(schema.pages)
      .where(and(eq(schema.pages.published, true), eq(schema.pages.showInNav, true)))
      .orderBy(asc(schema.pages.navOrder), asc(schema.pages.title)),
    // 공개된 글이 하나라도 있는 태그만
    db
      .select({ slug: tags.slug, name: tags.name, color: tags.color })
      .from(tags)
      .where(
        sql`EXISTS (SELECT 1 FROM ${postTags} pt JOIN ${posts} p ON p.id = pt.post_id
          WHERE pt.tag_id = "tags"."id" AND p.status = 'published' AND p.published_at <= ${Date.now()})`,
      )
      .orderBy(asc(tags.sortOrder), asc(tags.name)),
  ]);
  return { settings: parseSettings(settingsRows[0]?.value), navPages, tags: tagRows };
}

/** 한 요청 안에서는 페이지와 레이아웃이 여러 번 불러도 DB에는 한 번만 물어봐요. */
export function getSiteChrome(locals: App.Locals): Promise<SiteChrome> {
  locals.chrome ??= loadChrome();
  return locals.chrome;
}
