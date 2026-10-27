/**
 * 반응 스티커와 조회수
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import { REACTION_KINDS, type ReactionKind } from '../db/schema';
import { addDays, kstDay } from './time';

const { reactions, posts, postViewsDaily } = schema;

export const REACTIONS: Record<ReactionKind, { emoji: string; label: string }> = {
  clap: { emoji: '👏', label: '박수' },
  fire: { emoji: '🔥', label: '열정' },
  bulb: { emoji: '💡', label: '배웠어요' },
  heart: { emoji: '💛', label: '응원해요' },
};

export type ReactionSummary = { counts: Record<ReactionKind, number>; mine: ReactionKind[] };

export async function getReactionSummary(postId: number, voterHash: string | null): Promise<ReactionSummary> {
  const db = getDb();
  const [counts, mine] = await db.batch([
    db
      .select({ kind: reactions.kind, n: sql<number>`count(*)` })
      .from(reactions)
      .where(eq(reactions.postId, postId))
      .groupBy(reactions.kind),
    db
      .select({ kind: reactions.kind })
      .from(reactions)
      .where(and(eq(reactions.postId, postId), eq(reactions.voterHash, voterHash ?? '-'))),
  ]);
  const result = Object.fromEntries(REACTION_KINDS.map((k) => [k, 0])) as Record<ReactionKind, number>;
  for (const c of counts) result[c.kind] = c.n;
  return { counts: result, mine: mine.map((m) => m.kind) };
}

/** 누르면 붙이고, 다시 누르면 떼요. */
export async function toggleReaction(postId: number, kind: ReactionKind, voterHash: string) {
  const db = getDb();
  const removed = await db
    .delete(reactions)
    .where(and(eq(reactions.postId, postId), eq(reactions.kind, kind), eq(reactions.voterHash, voterHash)))
    .returning({ kind: reactions.kind })
    .all();
  if (removed.length === 0) {
    await db.insert(reactions).values({ postId, kind, voterHash }).onConflictDoNothing();
  }
  return getReactionSummary(postId, voterHash);
}

export async function recordView(postId: number): Promise<void> {
  const db = getDb();
  const day = kstDay();
  await db.batch([
    db.update(posts).set({ viewCount: sql`${posts.viewCount} + 1` }).where(eq(posts.id, postId)),
    db
      .insert(postViewsDaily)
      .values({ postId, day, views: 1 })
      .onConflictDoUpdate({
        target: [postViewsDaily.postId, postViewsDaily.day],
        set: { views: sql`${postViewsDaily.views} + 1` },
      }),
  ]);
}

/** 최근 n일 하루 조회수 (빈 날은 0) */
export async function viewsByDay(days = 30) {
  const today = kstDay();
  const from = addDays(today, -(days - 1));
  const rows = await getDb()
    .select({ day: postViewsDaily.day, views: sql<number>`sum(${postViewsDaily.views})` })
    .from(postViewsDaily)
    .where(gte(postViewsDaily.day, from))
    .groupBy(postViewsDaily.day)
    .all();
  const map = new Map(rows.map((r) => [r.day, r.views]));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i);
    return { day, views: map.get(day) ?? 0 };
  });
}

export async function topPosts(days = 30, limit = 5) {
  const from = addDays(kstDay(), -(days - 1));
  return getDb()
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      views: sql<number>`sum(${postViewsDaily.views})`,
    })
    .from(postViewsDaily)
    .innerJoin(posts, eq(posts.id, postViewsDaily.postId))
    .where(gte(postViewsDaily.day, from))
    .groupBy(posts.id)
    .orderBy(desc(sql`sum(${postViewsDaily.views})`))
    .limit(limit)
    .all();
}
