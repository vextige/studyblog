/**
 * 목표 · 계획 (목표 보드)
 * 장기 목표 / 이번 달 / 이번 주 세 칸에 목표 카드를 붙여요.
 * 카드 안의 단계(steps)를 체크하면 진행률이 자동으로 계산돼요. 단계가 없으면 직접 정한 진행률을 써요.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import type { GoalStatus, GoalStep, GoalTerm, TagColor } from '../db/schema';
import { daysBetween, kstDay } from './time';

const { goals } = schema;

export const GOAL_TERM_LABELS: Record<GoalTerm, { title: string; hint: string }> = {
  long: { title: '장기 목표', hint: '올해 안에, 혹은 언젠가 꼭' },
  month: { title: '이번 달', hint: '한 달 동안 끝낼 것' },
  week: { title: '이번 주', hint: '이번 주에 할 일' },
};

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: '진행 중',
  done: '달성',
  paused: '잠시 멈춤',
};

export type Goal = typeof goals.$inferSelect;
export type GoalView = Goal & {
  /** 0~100 */
  percent: number;
  doneSteps: number;
  /** 마감까지 남은 날 (지났으면 음수, 마감일 없으면 null) */
  daysLeft: number | null;
};

export function goalPercent(goal: Pick<Goal, 'steps' | 'progress' | 'status'>): number {
  if (goal.status === 'done') return 100;
  if (goal.steps.length > 0) return Math.round((goal.steps.filter((s) => s.done).length / goal.steps.length) * 100);
  return Math.min(100, Math.max(0, goal.progress));
}

function toView(goal: Goal, today = kstDay()): GoalView {
  return {
    ...goal,
    percent: goalPercent(goal),
    doneSteps: goal.steps.filter((s) => s.done).length,
    daysLeft: goal.dueDate ? daysBetween(today, goal.dueDate) : null,
  };
}

/** 'D-3', 'D-DAY', 'D+2' */
export function dDayLabel(daysLeft: number): string {
  if (daysLeft === 0) return 'D-DAY';
  return daysLeft > 0 ? `D-${daysLeft}` : `D+${-daysLeft}`;
}

export async function listGoals(): Promise<GoalView[]> {
  const rows = await getDb().select().from(goals).orderBy(asc(goals.sortOrder), asc(goals.id)).all();
  const today = kstDay();
  return rows.map((g) => toView(g, today));
}

/** 목표를 기간별 칸으로 나눠요. 달성한 목표는 칸 아래쪽으로 내려가요. */
export function groupGoals(list: GoalView[]): Record<GoalTerm, GoalView[]> {
  const out: Record<GoalTerm, GoalView[]> = { long: [], month: [], week: [] };
  const rank = (g: GoalView) => (g.status === 'active' ? 0 : g.status === 'paused' ? 1 : 2);
  for (const g of list) out[g.term].push(g);
  for (const term of Object.keys(out) as GoalTerm[]) out[term].sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder);
  return out;
}

export async function getGoal(id: number) {
  return getDb().select().from(goals).where(eq(goals.id, id)).get();
}

export type GoalInput = {
  title: string;
  note: string;
  term: GoalTerm;
  status: GoalStatus;
  color: TagColor;
  dueDate: string | null;
  steps: GoalStep[];
  progress: number;
};

function cleanSteps(steps: GoalStep[]): GoalStep[] {
  return steps
    .map((s) => ({ text: s.text.replace(/\s+/g, ' ').trim().slice(0, 120), done: Boolean(s.done) }))
    .filter((s) => s.text)
    .slice(0, 20);
}

export async function createGoal(input: GoalInput) {
  const db = getDb();
  const max = await db.select({ n: sql<number>`coalesce(max(${goals.sortOrder}), 0)` }).from(goals).get();
  return db
    .insert(goals)
    .values({
      ...input,
      title: input.title.trim(),
      note: input.note.trim(),
      steps: cleanSteps(input.steps),
      sortOrder: (max?.n ?? 0) + 1,
      doneAt: input.status === 'done' ? new Date() : null,
    })
    .returning({ id: goals.id })
    .get();
}

export async function updateGoal(id: number, input: GoalInput) {
  const db = getDb();
  const before = await db.select({ status: goals.status, doneAt: goals.doneAt }).from(goals).where(eq(goals.id, id)).get();
  if (!before) return false;
  const doneAt = input.status === 'done' ? (before.doneAt ?? new Date()) : null;
  await db
    .update(goals)
    .set({
      ...input,
      title: input.title.trim(),
      note: input.note.trim(),
      steps: cleanSteps(input.steps),
      doneAt,
      updatedAt: new Date(),
    })
    .where(eq(goals.id, id));
  return true;
}

/** 단계 하나를 체크/해제해요. 모든 단계를 끝내면 목표도 '달성'이 돼요. */
export async function toggleGoalStep(id: number, index: number) {
  const db = getDb();
  const goal = await db.select().from(goals).where(eq(goals.id, id)).get();
  if (!goal || index < 0 || index >= goal.steps.length) return null;
  const steps = goal.steps.map((s, i) => (i === index ? { ...s, done: !s.done } : s));
  const allDone = steps.every((s) => s.done);
  const status: GoalStatus = allDone ? 'done' : goal.status === 'done' ? 'active' : goal.status;
  await db
    .update(goals)
    .set({ steps, status, doneAt: status === 'done' ? (goal.doneAt ?? new Date()) : null, updatedAt: new Date() })
    .where(eq(goals.id, id));
  return toView({ ...goal, steps, status });
}

export async function deleteGoal(id: number) {
  await getDb().delete(goals).where(eq(goals.id, id));
}

/** 홈 화면용: 진행 중인 목표 몇 개 */
export async function activeGoalsPreview(limit = 3): Promise<GoalView[]> {
  const rows = await getDb()
    .select()
    .from(goals)
    .where(eq(goals.status, 'active'))
    .orderBy(sql`CASE ${goals.term} WHEN 'week' THEN 0 WHEN 'month' THEN 1 ELSE 2 END`, asc(goals.sortOrder))
    .limit(limit)
    .all();
  const today = kstDay();
  return rows.map((g) => toView(g, today));
}
