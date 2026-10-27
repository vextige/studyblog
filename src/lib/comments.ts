/**
 * 댓글
 * - 이름과 내용만 받아요. (이메일·비밀번호 X)
 * - 기본 설정은 "승인 후 공개": 관리자가 확인한 댓글만 보여요.
 * - 댓글 쓴 사람은 브라우저에 저장된 삭제 토큰으로 자기 댓글을 지울 수 있어요.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import type { CommentStatus } from '../db/schema';
import { randomToken, safeEqual, sha256Hex } from './crypto';
import { isPublic } from './posts';

const { comments, posts } = schema;

export type PublicComment = {
  id: number;
  parentId: number | null;
  authorName: string;
  body: string;
  isAdmin: boolean;
  createdAt: Date;
  replies: PublicComment[];
};

export async function listApprovedComments(postId: number): Promise<PublicComment[]> {
  const rows = await getDb()
    .select({
      id: comments.id,
      parentId: comments.parentId,
      authorName: comments.authorName,
      body: comments.body,
      isAdmin: comments.isAdmin,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(and(eq(comments.postId, postId), eq(comments.status, 'approved')))
    .orderBy(asc(comments.createdAt))
    .all();
  const byId = new Map<number, PublicComment>();
  const roots: PublicComment[] = [];
  for (const row of rows) byId.set(row.id, { ...row, replies: [] });
  for (const c of byId.values()) {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    if (parent) parent.replies.push(c);
    else roots.push(c);
  }
  return roots;
}

export function countComments(list: PublicComment[]): number {
  return list.reduce((sum, c) => sum + 1 + c.replies.length, 0);
}

export async function createComment(input: {
  postId: number;
  parentId: number | null;
  authorName: string;
  body: string;
  status: CommentStatus;
  isAdmin: boolean;
  ipHash: string;
}) {
  const db = getDb();
  const post = await db
    .select({ id: posts.id, allowComments: posts.allowComments })
    .from(posts)
    .where(and(eq(posts.id, input.postId), isPublic()))
    .get();
  if (!post || !post.allowComments) return { error: '이 글에는 댓글을 달 수 없어요.' } as const;
  let parentId = input.parentId;
  if (parentId) {
    const parent = await db
      .select({ id: comments.id, parentId: comments.parentId })
      .from(comments)
      .where(and(eq(comments.id, parentId), eq(comments.postId, input.postId), eq(comments.status, 'approved')))
      .get();
    // 답글의 답글은 원래 댓글 아래로 모아요. (한 단계만)
    parentId = parent ? (parent.parentId ?? parent.id) : null;
  }
  const deleteToken = randomToken(24);
  const created = await db
    .insert(comments)
    .values({
      postId: input.postId,
      parentId,
      authorName: input.authorName,
      body: input.body,
      status: input.status,
      isAdmin: input.isAdmin,
      deleteTokenHash: await sha256Hex(deleteToken),
      ipHash: input.ipHash,
    })
    .returning({ id: comments.id, createdAt: comments.createdAt })
    .get();
  return { id: created.id, createdAt: created.createdAt, deleteToken, status: input.status } as const;
}

export async function deleteOwnComment(id: number, token: string): Promise<boolean> {
  const db = getDb();
  const row = await db.select({ hash: comments.deleteTokenHash }).from(comments).where(eq(comments.id, id)).get();
  if (!row?.hash) return false;
  if (!(await safeEqual(row.hash, await sha256Hex(token)))) return false;
  await db.delete(comments).where(eq(comments.id, id));
  return true;
}

/* ───────── 관리자 ───────── */

export async function listCommentsForAdmin(status: CommentStatus, page = 1, perPage = 30) {
  const db = getDb();
  const [rows, counts] = await db.batch([
    db
      .select({
        id: comments.id,
        postId: comments.postId,
        parentId: comments.parentId,
        authorName: comments.authorName,
        body: comments.body,
        status: comments.status,
        isAdmin: comments.isAdmin,
        ipHash: comments.ipHash,
        createdAt: comments.createdAt,
        postTitle: posts.title,
        postSlug: posts.slug,
      })
      .from(comments)
      .innerJoin(posts, eq(posts.id, comments.postId))
      .where(eq(comments.status, status))
      .orderBy(desc(comments.createdAt))
      .limit(perPage)
      .offset((Math.max(1, page) - 1) * perPage),
    db.select({ status: comments.status, n: sql<number>`count(*)` }).from(comments).groupBy(comments.status),
  ]);
  const tally: Record<CommentStatus, number> = { pending: 0, approved: 0, spam: 0 };
  for (const c of counts) tally[c.status] = c.n;
  return { comments: rows, tally };
}

export async function pendingCommentCount(): Promise<number> {
  const row = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(comments)
    .where(eq(comments.status, 'pending'))
    .get();
  return row?.n ?? 0;
}

export async function setCommentStatus(ids: number[], status: CommentStatus) {
  if (ids.length === 0) return;
  await getDb().update(comments).set({ status }).where(inArray(comments.id, ids));
}

export async function deleteComments(ids: number[]) {
  if (ids.length === 0) return;
  await getDb().delete(comments).where(inArray(comments.id, ids));
}

/** 같은 사람(IP 해시)이 쓴 댓글을 한꺼번에 스팸 처리 */
export async function markAuthorAsSpam(ipHash: string) {
  if (!ipHash) return;
  await getDb().update(comments).set({ status: 'spam' }).where(and(eq(comments.ipHash, ipHash), eq(comments.isAdmin, false)));
}
