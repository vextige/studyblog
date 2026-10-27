// 화면에 숫자·날짜를 보기 좋게 쓰는 도우미
import { kstDay } from './time';

const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('ko-KR');

/** 1234 → '1.2천', 12 → '12' */
export function compactNumber(n: number): string {
  return n < 1000 ? String(n) : compact.format(n);
}

/** 1234 → '1,234' */
export function formatNumber(n: number): string {
  return plain.format(n);
}

/** 80 → '1시간 20분', 45 → '45분' */
export function formatStudyTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/** 7 → '007' */
export function dayLabel(day: number): string {
  return String(day).padStart(3, '0');
}

/** 글 목록을 '2026년 10월'처럼 달별로 묶어요. (이미 최신순으로 정렬된 목록) */
export function groupByMonth<T extends { publishedAt: Date }>(items: T[]): { key: string; label: string; items: T[] }[] {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const key = kstDay(item.publishedAt).slice(0, 7);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      const [year, month] = key.split('-');
      group = { key, label: `${year}년 ${Number(month)}월`, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
