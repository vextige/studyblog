// 100일 챌린지 계산 (도장판, D+N, 연속 기록). DB를 쓰지 않는 순수 함수라서 테스트하기 쉬워요.
import { addDays, daysBetween, kstDay } from './time';

export type ChallengeDay = { day: number; slug: string; title: string };

export type ChallengeState = {
  totalDays: number;
  /** 시작일부터 오늘이 며칠째인지 (D+1 = 시작한 날) */
  dPlus: number;
  /** 지금까지 쓴 가장 큰 Day 번호 */
  currentDay: number;
  stamped: number;
  percent: number;
  cells: { day: number; post: ChallengeDay | null; isToday: boolean; isFuture: boolean }[];
  streak: { current: number; best: number; writtenToday: boolean };
};

export function computeStreak(
  dates: Date[],
  today = kstDay(),
): { current: number; best: number; writtenToday: boolean } {
  const days = [...new Set(dates.map((d) => kstDay(d)))].sort();
  if (days.length === 0) return { current: 0, best: 0, writtenToday: false };
  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = addDays(days[i - 1]!, 1) === days[i] ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const set = new Set(days);
  const writtenToday = set.has(today);
  let current = 0;
  let cursor = writtenToday ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, best, writtenToday };
}

export function computeChallenge(
  config: { startDate: string; totalDays: number },
  days: ChallengeDay[],
  publishedDates: Date[],
  today = kstDay(),
): ChallengeState {
  const totalDays = config.totalDays;
  const dPlus = Math.max(0, daysBetween(config.startDate, today) + 1);
  const byDay = new Map<number, ChallengeDay>();
  for (const d of days) if (d.day >= 1 && d.day <= totalDays && !byDay.has(d.day)) byDay.set(d.day, d);
  const currentDay = days.reduce((max, d) => Math.max(max, d.day), 0);
  const todayCell = Math.min(Math.max(dPlus, 1), totalDays);
  const cells = Array.from({ length: totalDays }, (_, i) => {
    const day = i + 1;
    return { day, post: byDay.get(day) ?? null, isToday: day === todayCell && dPlus <= totalDays, isFuture: day > dPlus };
  });
  return {
    totalDays,
    dPlus,
    currentDay,
    stamped: byDay.size,
    percent: Math.min(100, Math.round((byDay.size / totalDays) * 100)),
    cells,
    streak: computeStreak(publishedDates, today),
  };
}
