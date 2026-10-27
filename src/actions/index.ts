/**
 * 서버 기능(Actions) 모음
 * 브라우저에서 `actions.이름(...)`으로 부르면 여기 있는 코드가 서버에서 실행돼요.
 * 모든 입력은 zod로 형식·길이를 검사하고, admin.* 은 로그인한 관리자만 쓸 수 있어요.
 */
import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import { COMMENT_STATUSES, GOAL_STATUSES, GOAL_TERMS, REACTION_KINDS, TAG_COLORS } from '../db/schema';
import { createSession, revokeOtherSessions, revokeSession } from '../lib/auth/session';
import {
  deletePasskey,
  ensureOwner,
  finishLogin,
  finishRegistration,
  PasskeyError,
  renamePasskey,
  startLogin,
  startRegistration,
} from '../lib/auth/webauthn';
import {
  createComment,
  deleteComments,
  deleteOwnComment,
  markAuthorAsSpam,
  setCommentStatus,
} from '../lib/comments';
import { safeEqual } from '../lib/crypto';
import { toggleReaction } from '../lib/engagement';
import { createGoal, deleteGoal, toggleGoalStep, updateGoal } from '../lib/goals';
import { renderMarkdown } from '../lib/markdown';
import { deleteMedia, mediaUsage } from '../lib/media';
import { deletePage, savePage } from '../lib/pages';
import {
  deletePostForever,
  EditorError,
  emptyTrash,
  getRevision,
  listRevisions,
  savePost,
  setPostStatus,
} from '../lib/post-editor';
import { isPublic } from '../lib/posts';
import { audit, ipHash, rateLimit } from '../lib/security';
import { getSettings, saveSettings, settingsSchema } from '../lib/settings';
import { createTag, deleteTag, reorderTags, updateTag } from '../lib/tags';
import { fromKstInputValue, ISO_DAY } from '../lib/time';

/* ───────── 공통 도우미 ───────── */

function requireAdmin(ctx: ActionAPIContext) {
  const user = ctx.locals.user;
  if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: '로그인이 필요해요. 다시 로그인해 주세요.' });
  return user;
}

/** IP 해시 기준으로 요청 횟수를 제한하고, 그 해시를 돌려줘요. */
async function limitOrThrow(ctx: ActionAPIContext, bucket: string, limit: number, windowSec: number) {
  const hash = await ipHash(ctx.request);
  const result = await rateLimit(bucket, hash, limit, windowSec);
  if (!result.ok) {
    throw new ActionError({
      code: 'TOO_MANY_REQUESTS',
      message: `요청이 너무 많아요. ${Math.ceil(result.retryAfterSec / 60)}분 뒤에 다시 시도해 주세요.`,
    });
  }
  return hash;
}

function editorFailure(error: unknown): never {
  if (error instanceof EditorError) {
    throw new ActionError({ code: error.code, message: error.message });
  }
  throw error;
}

async function verifySetupToken(token: string | undefined): Promise<boolean> {
  const expected = env.ADMIN_SETUP_TOKEN;
  if (!expected || expected.length < 16 || expected === 'change-me') return false;
  return safeEqual(token ?? '', expected);
}

const webauthnResponse = z
  .object({
    id: z.string().min(1).max(1500),
    rawId: z.string().min(1).max(1500),
    type: z.literal('public-key'),
    response: z.record(z.string(), z.unknown()),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional().default({}),
    authenticatorAttachment: z.string().max(40).optional(),
  })
  .loose();

const id = z.coerce.number().int().positive();
const mediaId = z.string().regex(/^[a-f0-9]{24}$/);
const optionalMediaId = z.union([mediaId, z.null()]);

/* ───────── 로그인 ───────── */

const auth = {
  loginOptions: defineAction({
    handler: async (_input, ctx) => {
      await limitOrThrow(ctx, 'login', 30, 900);
      return startLogin(ctx);
    },
  }),

  loginVerify: defineAction({
    input: z.object({ response: webauthnResponse }),
    handler: async ({ response }, ctx) => {
      await limitOrThrow(ctx, 'login-verify', 20, 900);
      try {
        const result = await finishLogin(ctx, response as unknown as AuthenticationResponseJSON);
        // 이미 있던 세션은 지우고 항상 새 세션을 만들어요. (세션 고정 공격 방지)
        if (ctx.locals.user && ctx.locals.session) await revokeSession(ctx.locals.user.id, ctx.locals.session.id);
        await createSession(ctx, result.userId);
        await audit(ctx, 'login.success', result.passkeyName, result.userId);
        return { ok: true };
      } catch (error) {
        await audit(ctx, 'login.failed', error instanceof Error ? error.message : '', null);
        throw new ActionError({
          code: 'UNAUTHORIZED',
          message: error instanceof PasskeyError ? error.message : '로그인하지 못했어요. 다시 시도해 주세요.',
        });
      }
    },
  }),

  registerOptions: defineAction({
    input: z.object({ setupToken: z.string().max(300).optional(), name: z.string().max(40).optional() }),
    handler: async ({ setupToken }, ctx) => {
      const settings = await getSettings();
      if (ctx.locals.user) {
        const user = await getDb().select().from(schema.users).where(eq(schema.users.id, ctx.locals.user.id)).get();
        if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: '다시 로그인해 주세요.' });
        return startRegistration(ctx, user, settings.siteTitle);
      }
      await limitOrThrow(ctx, 'setup', 10, 900);
      if (!(await verifySetupToken(setupToken))) {
        await audit(ctx, 'setup.denied', '', null);
        throw new ActionError({ code: 'FORBIDDEN', message: '설정 토큰이 맞지 않아요.' });
      }
      const owner = await ensureOwner(settings.authorName);
      return startRegistration(ctx, owner, settings.siteTitle);
    },
  }),

  registerVerify: defineAction({
    input: z.object({
      response: webauthnResponse,
      name: z.string().trim().max(40).default(''),
      setupToken: z.string().max(300).optional(),
    }),
    handler: async ({ response, name, setupToken }, ctx) => {
      const loggedIn = ctx.locals.user;
      if (!loggedIn) {
        await limitOrThrow(ctx, 'setup', 10, 900);
        if (!(await verifySetupToken(setupToken))) {
          throw new ActionError({ code: 'FORBIDDEN', message: '설정 토큰이 맞지 않아요.' });
        }
      }
      try {
        const result = await finishRegistration(ctx, response as unknown as RegistrationResponseJSON, name);
        if (loggedIn && result.userId !== loggedIn.id) {
          throw new PasskeyError('다른 계정의 등록 요청이에요.');
        }
        await audit(ctx, 'passkey.added', name || '내 패스키', result.userId);
        if (!loggedIn) await createSession(ctx, result.userId);
        return { ok: true };
      } catch (error) {
        if (error instanceof PasskeyError) throw new ActionError({ code: 'BAD_REQUEST', message: error.message });
        throw error;
      }
    },
  }),
};

/* ───────── 댓글 · 반응 (방문자) ───────── */

const comments = {
  create: defineAction({
    accept: 'form',
    input: z.object({
      postId: id,
      parentId: z.coerce.number().int().nonnegative().optional(),
      authorName: z.string().trim().min(1, '이름을 적어 주세요.').max(30, '이름은 30자까지 쓸 수 있어요.'),
      body: z.string().trim().min(2, '내용을 2자 이상 적어 주세요.').max(2000, '댓글은 2000자까지 쓸 수 있어요.'),
      website: z.string().max(300).optional(),
      startedAt: z.coerce.number().optional(),
    }),
    handler: async (input, ctx) => {
      const settings = await getSettings();
      if (!settings.comments.enabled) throw new ActionError({ code: 'FORBIDDEN', message: '지금은 댓글을 받지 않아요.' });
      const isAdmin = Boolean(ctx.locals.user);
      let hash = '';
      if (!isAdmin) {
        hash = await limitOrThrow(ctx, 'comment', 5, 600);
        await limitOrThrow(ctx, 'comment-day', 30, 86_400);
      }
      const pretendOk = { id: 0, status: 'pending' as const, deleteToken: '', createdAt: Date.now(), authorName: input.authorName, body: input.body, isAdmin: false };
      // 자동 프로그램(봇) 걸러내기: 사람에게는 안 보이는 칸을 채웠거나, 화면을 열자마자 보냈으면 조용히 버려요.
      if (input.website) return pretendOk;
      if (input.startedAt && Date.now() - input.startedAt < 2500) return pretendOk;
      if ((input.body.match(/https?:\/\//gi) ?? []).length > 3) {
        throw new ActionError({ code: 'BAD_REQUEST', message: '링크가 너무 많아요. 3개까지만 넣어 주세요.' });
      }
      if (!isAdmin && input.authorName.toLowerCase() === settings.authorName.toLowerCase()) {
        throw new ActionError({ code: 'BAD_REQUEST', message: '그 이름은 블로그 주인만 쓸 수 있어요. 다른 이름을 적어 주세요.' });
      }
      const status = isAdmin || settings.comments.moderation === 'auto' ? 'approved' : 'pending';
      const result = await createComment({
        postId: input.postId,
        parentId: input.parentId || null,
        authorName: input.authorName,
        body: input.body,
        status,
        isAdmin,
        ipHash: hash,
      });
      if ('error' in result) throw new ActionError({ code: 'BAD_REQUEST', message: result.error });
      return {
        id: result.id,
        status: result.status,
        deleteToken: result.deleteToken,
        createdAt: result.createdAt.getTime(),
        authorName: input.authorName,
        body: input.body,
        isAdmin,
      };
    },
  }),

  deleteOwn: defineAction({
    input: z.object({ id, token: z.string().min(10).max(100) }),
    handler: async ({ id: commentId, token }, ctx) => {
      await limitOrThrow(ctx, 'comment-delete', 20, 600);
      const ok = await deleteOwnComment(commentId, token);
      if (!ok) throw new ActionError({ code: 'FORBIDDEN', message: '이 댓글을 지울 수 없어요.' });
      return { ok };
    },
  }),
};

const reactions = {
  toggle: defineAction({
    input: z.object({ postId: id, kind: z.enum(REACTION_KINDS) }),
    handler: async ({ postId, kind }, ctx) => {
      const voter = await limitOrThrow(ctx, 'react', 60, 600);
      const post = await getDb()
        .select({ id: schema.posts.id })
        .from(schema.posts)
        .where(and(eq(schema.posts.id, postId), isPublic()))
        .get();
      if (!post) throw new ActionError({ code: 'NOT_FOUND', message: '글을 찾을 수 없어요.' });
      return toggleReaction(postId, kind, voter);
    },
  }),
};

/* ───────── 관리자 ───────── */

const postInput = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().max(200),
  slug: z.string().max(120),
  contentMd: z.string().max(200_000, '글이 너무 길어요. (20만 자까지)'),
  excerpt: z.string().max(300),
  tagNames: z.array(z.string().max(40)).max(10),
  dayNumber: z.number().int().min(1).max(10000).nullable(),
  /** 공부한 시간(분) */
  studyMinutes: z.number().int().min(0).max(1440).nullable(),
  status: z.enum(['draft', 'published']),
  /** 한국 시간 'YYYY-MM-DDTHH:mm' 또는 null(지금) */
  publishedAt: z.string().max(20).nullable(),
  coverMediaId: optionalMediaId,
  ogMediaId: optionalMediaId,
  featured: z.boolean(),
  allowComments: z.boolean(),
  baseUpdatedAt: z.number().optional(),
});

const goalInput = z.object({
  title: z.string().trim().min(1, '목표를 적어 주세요.').max(80, '목표는 80자까지 쓸 수 있어요.'),
  note: z.string().max(500).default(''),
  term: z.enum(GOAL_TERMS),
  status: z.enum(GOAL_STATUSES),
  color: z.enum(TAG_COLORS),
  dueDate: z.union([z.string().regex(ISO_DAY, '날짜는 YYYY-MM-DD 형식이에요.'), z.null()]),
  steps: z.array(z.object({ text: z.string().max(120), done: z.boolean() })).max(20, '단계는 20개까지 넣을 수 있어요.'),
  progress: z.number().int().min(0).max(100),
});

const admin = {
  savePost: defineAction({
    input: postInput,
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const publishedAt = input.publishedAt ? fromKstInputValue(input.publishedAt) : null;
      if (input.publishedAt && !publishedAt) throw new ActionError({ code: 'BAD_REQUEST', message: '발행 시각 형식이 올바르지 않아요.' });
      const before = input.id
        ? await getDb().select({ status: schema.posts.status }).from(schema.posts).where(eq(schema.posts.id, input.id)).get()
        : undefined;
      const result = await savePost({ ...input, publishedAt }).catch(editorFailure);
      if (input.status === 'published' && before?.status !== 'published') await audit(ctx, 'post.published', result.slug);
      return { ...result, publishedAt: result.publishedAt?.getTime() ?? null };
    },
  }),

  /** 글쓰기 화면의 미리보기: 실제 발행될 HTML과 똑같이 변환해요. */
  previewMarkdown: defineAction({
    input: z.object({ contentMd: z.string().max(200_000) }),
    handler: async ({ contentMd }, ctx) => {
      requireAdmin(ctx);
      const rendered = renderMarkdown(contentMd);
      return { html: rendered.html, readingMinutes: rendered.readingMinutes };
    },
  }),

  setPostStatus: defineAction({
    accept: 'form',
    input: z.object({ id, status: z.enum(['draft', 'trashed', 'published']) }),
    handler: async ({ id: postId, status }, ctx) => {
      requireAdmin(ctx);
      await setPostStatus(postId, status).catch(editorFailure);
      if (status === 'trashed') await audit(ctx, 'post.trashed', String(postId));
      return { ok: true };
    },
  }),

  deletePost: defineAction({
    accept: 'form',
    input: z.object({ id }),
    handler: async ({ id: postId }, ctx) => {
      requireAdmin(ctx);
      await deletePostForever(postId);
      await audit(ctx, 'post.deleted', String(postId));
      return { ok: true };
    },
  }),

  emptyTrash: defineAction({
    accept: 'form',
    handler: async (_input, ctx) => {
      requireAdmin(ctx);
      await emptyTrash(0);
      await audit(ctx, 'post.trash_emptied');
      return { ok: true };
    },
  }),

  listRevisions: defineAction({
    input: z.object({ postId: id }),
    handler: async ({ postId }, ctx) => {
      requireAdmin(ctx);
      const list = await listRevisions(postId);
      return list.map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));
    },
  }),

  getRevision: defineAction({
    input: z.object({ postId: id, revisionId: id }),
    handler: async ({ postId, revisionId }, ctx) => {
      requireAdmin(ctx);
      const rev = await getRevision(postId, revisionId);
      if (!rev) throw new ActionError({ code: 'NOT_FOUND', message: '버전을 찾을 수 없어요.' });
      return { title: rev.title, contentMd: rev.contentMd, createdAt: rev.createdAt.getTime() };
    },
  }),

  savePage: defineAction({
    input: z.object({
      id: z.number().int().positive().optional(),
      title: z.string().max(120),
      slug: z.string().max(120),
      contentMd: z.string().max(200_000),
      published: z.boolean(),
      showInNav: z.boolean(),
      navOrder: z.number().int().min(0).max(100),
      baseUpdatedAt: z.number().optional(),
    }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      return savePage(input).catch(editorFailure);
    },
  }),

  deletePage: defineAction({
    accept: 'form',
    input: z.object({ id }),
    handler: async ({ id: pageId }, ctx) => {
      requireAdmin(ctx);
      await deletePage(pageId);
      await audit(ctx, 'page.deleted', String(pageId));
      return { ok: true };
    },
  }),

  createTag: defineAction({
    accept: 'form',
    input: z.object({
      name: z.string().trim().min(1, '태그 이름을 적어 주세요.').max(30),
      description: z.string().max(200).default(''),
      color: z.enum(TAG_COLORS),
    }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      try {
        return await createTag(input);
      } catch {
        throw new ActionError({ code: 'CONFLICT', message: '같은 이름의 태그가 이미 있어요.' });
      }
    },
  }),

  updateTag: defineAction({
    accept: 'form',
    input: z.object({
      id,
      name: z.string().trim().min(1, '태그 이름을 적어 주세요.').max(30),
      slug: z.string().max(80).default(''),
      description: z.string().max(200).default(''),
      color: z.enum(TAG_COLORS),
    }),
    handler: async ({ id: tagId, ...input }, ctx) => {
      requireAdmin(ctx);
      try {
        await updateTag(tagId, input);
      } catch {
        throw new ActionError({ code: 'CONFLICT', message: '같은 이름의 태그가 이미 있어요.' });
      }
      return { ok: true };
    },
  }),

  deleteTag: defineAction({
    accept: 'form',
    input: z.object({ id }),
    handler: async ({ id: tagId }, ctx) => {
      requireAdmin(ctx);
      await deleteTag(tagId);
      return { ok: true };
    },
  }),

  reorderTags: defineAction({
    input: z.object({ ids: z.array(z.number().int().positive()).max(200) }),
    handler: async ({ ids }, ctx) => {
      requireAdmin(ctx);
      await reorderTags(ids);
      return { ok: true };
    },
  }),

  moderateComment: defineAction({
    accept: 'form',
    input: z.object({ id, status: z.enum(COMMENT_STATUSES) }),
    handler: async ({ id: commentId, status }, ctx) => {
      requireAdmin(ctx);
      await setCommentStatus([commentId], status);
      return { ok: true };
    },
  }),

  approveAllPending: defineAction({
    accept: 'form',
    input: z.object({ ids: z.array(id).max(100) }),
    handler: async ({ ids }, ctx) => {
      requireAdmin(ctx);
      await setCommentStatus(ids, 'approved');
      return { ok: true };
    },
  }),

  deleteComment: defineAction({
    accept: 'form',
    input: z.object({ id }),
    handler: async ({ id: commentId }, ctx) => {
      requireAdmin(ctx);
      await deleteComments([commentId]);
      return { ok: true };
    },
  }),

  spamAuthor: defineAction({
    accept: 'form',
    input: z.object({ ipHash: z.string().regex(/^[a-f0-9]{32}$/) }),
    handler: async ({ ipHash: hash }, ctx) => {
      requireAdmin(ctx);
      await markAuthorAsSpam(hash);
      await audit(ctx, 'comments.author_spam', hash.slice(0, 8));
      return { ok: true };
    },
  }),

  replyComment: defineAction({
    accept: 'form',
    input: z.object({
      postId: id,
      parentId: id,
      body: z.string().trim().min(1, '답글 내용을 적어 주세요.').max(2000),
    }),
    handler: async (input, ctx) => {
      const user = requireAdmin(ctx);
      const settings = await getSettings();
      const post = await getDb()
        .select({ id: schema.posts.id })
        .from(schema.posts)
        .where(eq(schema.posts.id, input.postId))
        .get();
      if (!post) throw new ActionError({ code: 'NOT_FOUND', message: '글을 찾을 수 없어요.' });
      // 답글을 달면 원래 댓글도 함께 공개해요.
      await setCommentStatus([input.parentId], 'approved');
      const result = await createComment({
        postId: input.postId,
        parentId: input.parentId,
        authorName: settings.authorName || user.displayName,
        body: input.body,
        status: 'approved',
        isAdmin: true,
        ipHash: '',
      });
      if ('error' in result) throw new ActionError({ code: 'BAD_REQUEST', message: result.error });
      return { ok: true };
    },
  }),

  updateMediaAlt: defineAction({
    accept: 'form',
    input: z.object({ id: mediaId, alt: z.string().max(200).default('') }),
    handler: async ({ id: mid, alt }, ctx) => {
      requireAdmin(ctx);
      await getDb().update(schema.media).set({ alt: alt.trim() }).where(eq(schema.media.id, mid));
      return { ok: true };
    },
  }),

  deleteMedia: defineAction({
    accept: 'form',
    input: z.object({ id: mediaId, force: z.coerce.boolean().default(false) }),
    handler: async ({ id: mid, force }, ctx) => {
      requireAdmin(ctx);
      const used = await mediaUsage(mid);
      if (used > 0 && !force) {
        throw new ActionError({ code: 'CONFLICT', message: `이 이미지는 글·페이지 ${used}곳에서 쓰고 있어요. 그래도 지우려면 "강제 삭제"를 눌러 주세요.` });
      }
      await deleteMedia(mid);
      await audit(ctx, 'media.deleted', mid);
      return { ok: true };
    },
  }),

  saveGoal: defineAction({
    input: goalInput.extend({ id: z.number().int().positive().optional() }),
    handler: async ({ id: goalId, ...input }, ctx) => {
      requireAdmin(ctx);
      if (goalId) {
        const ok = await updateGoal(goalId, input);
        if (!ok) throw new ActionError({ code: 'NOT_FOUND', message: '목표를 찾을 수 없어요.' });
        return { id: goalId };
      }
      return createGoal(input);
    },
  }),

  toggleGoalStep: defineAction({
    input: z.object({ id, index: z.number().int().min(0).max(19) }),
    handler: async ({ id: goalId, index }, ctx) => {
      requireAdmin(ctx);
      const goal = await toggleGoalStep(goalId, index);
      if (!goal) throw new ActionError({ code: 'NOT_FOUND', message: '목표를 찾을 수 없어요.' });
      return { percent: goal.percent, status: goal.status, doneSteps: goal.doneSteps };
    },
  }),

  deleteGoal: defineAction({
    accept: 'form',
    input: z.object({ id }),
    handler: async ({ id: goalId }, ctx) => {
      requireAdmin(ctx);
      await deleteGoal(goalId);
      return { ok: true };
    },
  }),

  saveSettings: defineAction({
    input: settingsSchema,
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      await saveSettings(input);
      await audit(ctx, 'settings.updated');
      return { ok: true };
    },
  }),

  renamePasskey: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().min(1).max(1500), name: z.string().trim().min(1).max(40) }),
    handler: async ({ id: pid, name }, ctx) => {
      const user = requireAdmin(ctx);
      await renamePasskey(user.id, pid, name);
      await audit(ctx, 'passkey.renamed', name);
      return { ok: true };
    },
  }),

  deletePasskey: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().min(1).max(1500) }),
    handler: async ({ id: pid }, ctx) => {
      const user = requireAdmin(ctx);
      const ok = await deletePasskey(user.id, pid);
      if (!ok) throw new ActionError({ code: 'BAD_REQUEST', message: '마지막 패스키는 지울 수 없어요. 새 패스키를 먼저 추가해 주세요.' });
      await audit(ctx, 'passkey.removed', pid.slice(0, 12));
      return { ok: true };
    },
  }),

  revokeSession: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }),
    handler: async ({ id: sid }, ctx) => {
      const user = requireAdmin(ctx);
      await revokeSession(user.id, sid);
      await audit(ctx, 'session.revoked', sid.slice(0, 8));
      return { ok: true };
    },
  }),

  revokeOtherSessions: defineAction({
    accept: 'form',
    handler: async (_input, ctx) => {
      const user = requireAdmin(ctx);
      if (ctx.locals.session) await revokeOtherSessions(user.id, ctx.locals.session.id);
      await audit(ctx, 'session.revoked_others');
      return { ok: true };
    },
  }),
};

export const server = { auth, comments, reactions, admin };
