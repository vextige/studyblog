/**
 * 데이터베이스 설계 (Cloudflare D1 = SQLite)
 *
 * 시간은 모두 "1970-01-01부터 지난 밀리초(ms)" 정수로 저장해요. 화면에 보여 줄 때만 한국 시간으로 바꿔요.
 * 표(테이블) 사이의 관계는 README의 "DB 설계" 그림을 참고하세요.
 */
import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import type { TocItem } from '../lib/markdown.ts';

const nowMs = sql`(unixepoch() * 1000)`;
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs);
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs);

export const POST_STATUSES = ['draft', 'published', 'trashed'] as const;
export const COMMENT_STATUSES = ['pending', 'approved', 'spam'] as const;
export const REACTION_KINDS = ['clap', 'fire', 'bulb', 'heart'] as const;
export const TAG_COLORS = ['lime', 'pink', 'sky', 'orange', 'violet', 'mint', 'yellow'] as const;
/** 목표 기간: 장기(올해·언젠가) / 이번 달 / 이번 주 */
export const GOAL_TERMS = ['long', 'month', 'week'] as const;
export const GOAL_STATUSES = ['active', 'done', 'paused'] as const;

export type PostStatus = (typeof POST_STATUSES)[number];
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
export type ReactionKind = (typeof REACTION_KINDS)[number];
export type TagColor = (typeof TAG_COLORS)[number];
export type GoalTerm = (typeof GOAL_TERMS)[number];
export type GoalStatus = (typeof GOAL_STATUSES)[number];
/** 목표 안의 작은 단계 하나 (체크리스트 한 줄) */
export type GoalStep = { text: string; done: boolean };

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/* ───────────────────────── 관리자 · 로그인 ───────────────────────── */

/** 블로그 주인(관리자). 지금은 한 명이지만 표로 분리해 두면 나중에 공동 작성자를 늘릴 수 있어요. */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  displayName: text('display_name').notNull(),
  /** 패스키에 저장되는 무작위 사용자 ID (개인정보가 아닌 값) */
  webauthnUserId: text('webauthn_user_id').notNull().unique(),
  createdAt: createdAt(),
});

/** 등록된 패스키(지문·얼굴·Windows Hello 등). 비밀번호 대신 이걸로 로그인해요. */
export const passkeys = sqliteTable(
  'passkeys',
  {
    /** 패스키 고유 ID (base64url) */
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 공개 키만 저장해요. 비밀 키는 내 기기 밖으로 나오지 않아요. */
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    deviceType: text('device_type').notNull(),
    backedUp: integer('backed_up', { mode: 'boolean' }).notNull().default(false),
    name: text('name').notNull(),
    createdAt: createdAt(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
);

/** 로그인 상태. 쿠키에는 무작위 토큰을, DB에는 그 토큰의 SHA-256 해시만 저장해요. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    userAgent: text('user_agent').notNull().default(''),
    country: text('country').notNull().default(''),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

/** 패스키 등록·로그인 때 한 번만 쓰는 도전 값(challenge). 5분 뒤 만료돼요. */
export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    id: text('id').primaryKey(),
    challenge: text('challenge').notNull(),
    purpose: text('purpose', { enum: ['register', 'login'] }).notNull(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [check('auth_challenges_purpose_check', sql`${t.purpose} in ('register', 'login')`)],
);

/* ───────────────────────── 이미지 ───────────────────────── */

/** 업로드한 이미지 정보. id는 파일 내용의 해시라서 같은 파일을 두 번 올려도 하나만 저장돼요. */
export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  alt: text('alt').notNull().default(''),
  createdAt: createdAt(),
});

/** 이미지 파일 본체. 목록 화면에서 무거운 파일 데이터를 읽지 않도록 표를 나눴어요. */
export const mediaBlobs = sqliteTable('media_blobs', {
  mediaId: text('media_id')
    .primaryKey()
    .references(() => media.id, { onDelete: 'cascade' }),
  data: blob('data', { mode: 'buffer' }).notNull(),
});

/* ───────────────────────── 글 ───────────────────────── */

export const posts = sqliteTable(
  'posts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 글 주소. /posts/{slug} */
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    excerpt: text('excerpt').notNull().default(''),
    /** 내가 쓴 마크다운 원본 */
    contentMd: text('content_md').notNull().default(''),
    /** 저장할 때 서버가 안전하게 변환해 둔 HTML (읽을 때마다 변환하지 않아서 빨라요) */
    contentHtml: text('content_html').notNull().default(''),
    /** 검색용 순수 텍스트 */
    contentText: text('content_text').notNull().default(''),
    toc: text('toc', { mode: 'json' }).$type<TocItem[]>().notNull().default(sql`'[]'`),
    readingMinutes: integer('reading_minutes').notNull().default(1),
    status: text('status', { enum: POST_STATUSES }).notNull().default('draft'),
    /** 100일 챌린지의 몇째 날 글인지 (선택) */
    dayNumber: integer('day_number'),
    /** 이 날 공부한 시간(분). 공부 일지용 (선택) */
    studyMinutes: integer('study_minutes'),
    coverMediaId: text('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
    /** SNS 공유 미리보기 이미지 */
    ogMediaId: text('og_media_id').references(() => media.id, { onDelete: 'set null' }),
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
    allowComments: integer('allow_comments', { mode: 'boolean' }).notNull().default(true),
    viewCount: integer('view_count').notNull().default(0),
    /** 발행 시각. 미래 시각이면 "예약 발행"이 돼요. */
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('posts_status_published_idx').on(t.status, t.publishedAt),
    index('posts_day_idx').on(t.dayNumber),
    check('posts_status_check', sql`${t.status} in (${inList(POST_STATUSES)})`),
    check('posts_day_check', sql`${t.dayNumber} is null or ${t.dayNumber} between 1 and 10000`),
    check('posts_study_minutes_check', sql`${t.studyMinutes} is null or ${t.studyMinutes} between 0 and 1440`),
  ],
);

/** 글 주소(slug)를 바꿨을 때 옛 주소로 들어온 사람을 새 주소로 보내 주는 표 */
export const postRedirects = sqliteTable('post_redirects', {
  oldSlug: text('old_slug').primaryKey(),
  postId: integer('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
});

/** 저장할 때마다 남기는 글의 이전 버전 (글마다 최근 30개까지) */
export const postRevisions = sqliteTable(
  'post_revisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    contentMd: text('content_md').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('post_revisions_post_idx').on(t.postId, t.createdAt)],
);

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull().unique(),
    description: text('description').notNull().default(''),
    color: text('color', { enum: TAG_COLORS }).notNull().default('lime'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [check('tags_color_check', sql`${t.color} in (${inList(TAG_COLORS)})`)],
);

/** 글 ↔ 태그 (한 글에 여러 태그, 한 태그에 여러 글) */
export const postTags = sqliteTable(
  'post_tags',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] }), index('post_tags_tag_idx').on(t.tagId)],
);

/** 소개, 개인정보 처리방침처럼 글 목록에 안 나오는 고정 페이지 */
export const pages = sqliteTable('pages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  contentMd: text('content_md').notNull().default(''),
  contentHtml: text('content_html').notNull().default(''),
  published: integer('published', { mode: 'boolean' }).notNull().default(true),
  showInNav: integer('show_in_nav', { mode: 'boolean' }).notNull().default(false),
  navOrder: integer('nav_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ───────────────────────── 목표 · 계획 ───────────────────────── */

/** 목표 보드에 붙이는 목표 카드. 단계(steps)를 체크하면 진행률이 자동으로 올라가요. */
export const goals = sqliteTable(
  'goals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    /** 왜 이 목표를 세웠는지, 어떻게 할지 짧은 메모 */
    note: text('note').notNull().default(''),
    term: text('term', { enum: GOAL_TERMS }).notNull().default('month'),
    status: text('status', { enum: GOAL_STATUSES }).notNull().default('active'),
    color: text('color', { enum: TAG_COLORS }).notNull().default('lime'),
    /** 마감일 한국 날짜 'YYYY-MM-DD' (선택) */
    dueDate: text('due_date'),
    steps: text('steps', { mode: 'json' }).$type<GoalStep[]>().notNull().default(sql`'[]'`),
    /** 단계가 없을 때 직접 정하는 진행률 0~100 */
    progress: integer('progress').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    doneAt: integer('done_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('goals_term_idx').on(t.term, t.sortOrder),
    check('goals_term_check', sql`${t.term} in (${inList(GOAL_TERMS)})`),
    check('goals_status_check', sql`${t.status} in (${inList(GOAL_STATUSES)})`),
    check('goals_color_check', sql`${t.color} in (${inList(TAG_COLORS)})`),
    check('goals_progress_check', sql`${t.progress} between 0 and 100`),
  ],
);

/* ───────────────────────── 방문자 참여 ───────────────────────── */

export const comments = sqliteTable(
  'comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /** 답글이면 원래 댓글 ID */
    parentId: integer('parent_id').references((): AnySQLiteColumn => comments.id, { onDelete: 'cascade' }),
    authorName: text('author_name').notNull(),
    body: text('body').notNull(),
    /** pending(승인 대기) → approved(공개) / spam */
    status: text('status', { enum: COMMENT_STATUSES }).notNull().default('pending'),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    /** 댓글 쓴 사람이 나중에 직접 지울 때 쓰는 토큰의 해시 */
    deleteTokenHash: text('delete_token_hash'),
    /** IP를 비밀 키로 해시한 값 (도배 방지용, 원래 IP로 되돌릴 수 없어요) */
    ipHash: text('ip_hash').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    index('comments_post_idx').on(t.postId, t.status, t.createdAt),
    index('comments_status_idx').on(t.status, t.createdAt),
    check('comments_status_check', sql`${t.status} in (${inList(COMMENT_STATUSES)})`),
  ],
);

/** 글에 붙이는 반응 스티커(👏🔥💡💛). 같은 사람이 같은 스티커를 두 번 누를 수 없어요. */
export const reactions = sqliteTable(
  'reactions',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: REACTION_KINDS }).notNull(),
    voterHash: text('voter_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.kind, t.voterHash] }),
    check('reactions_kind_check', sql`${t.kind} in (${inList(REACTION_KINDS)})`),
  ],
);

/** 글별 하루 조회수 (관리자 통계 그래프용). day는 한국 날짜 'YYYY-MM-DD' */
export const postViewsDaily = sqliteTable(
  'post_views_daily',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    views: integer('views').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.day] }), index('post_views_daily_day_idx').on(t.day)],
);

/* ───────────────────────── 설정 · 보안 ───────────────────────── */

/** 블로그 이름, 소개 문구 같은 설정 (key 하나에 JSON 값 하나) */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: updatedAt(),
});

/** 짧은 시간에 너무 많은 요청(로그인 시도, 댓글 도배 등)을 막는 카운터 */
export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    resetAt: integer('reset_at').notNull(),
  },
  (t) => [index('rate_limits_reset_idx').on(t.resetAt)],
);

/** 로그인, 패스키 추가·삭제, 설정 변경 같은 중요한 일을 기록하는 보안 로그 */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    detail: text('detail').notNull().default(''),
    ipHash: text('ip_hash').notNull().default(''),
    country: text('country').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt)],
);
