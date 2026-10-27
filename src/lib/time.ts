// 날짜·시간 도우미. DB에는 세계 표준시(UTC)로 저장하고, 보여 줄 때만 한국 시간(KST, UTC+9)으로 바꿔요.
// 한국은 서머타임이 없어서 항상 9시간만 더하면 돼요.

const KST_OFFSET = 9 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const pad = (n: number) => String(n).padStart(2, '0');

function kst(date: Date | number) {
  const d = new Date((typeof date === 'number' ? date : date.getTime()) + KST_OFFSET);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** 한국 날짜 'YYYY-MM-DD' */
export function kstDay(date: Date | number = Date.now()): string {
  const k = kst(date);
  return `${k.year}-${pad(k.month)}-${pad(k.day)}`;
}

/** '2026.10.25' */
export function formatDate(date: Date | number): string {
  const k = kst(date);
  return `${k.year}.${pad(k.month)}.${pad(k.day)}`;
}

/** '2026년 10월 25일 (토)' */
export function formatDateLong(date: Date | number): string {
  const k = kst(date);
  return `${k.year}년 ${k.month}월 ${k.day}일 (${WEEKDAYS[k.weekday]})`;
}

/** '2026.10.25 21:30' */
export function formatDateTime(date: Date | number): string {
  const k = kst(date);
  return `${formatDate(date)} ${pad(k.hour)}:${pad(k.minute)}`;
}

/** '방금 전', '5분 전', '3시간 전', '어제', '4일 전', 그보다 오래되면 날짜 */
export function relativeTime(date: Date | number, now: number = Date.now()): string {
  const t = typeof date === 'number' ? date : date.getTime();
  const diff = now - t;
  if (diff < 0) return formatDateTime(t);
  if (diff < 60_000) return '방금 전';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)}시간 전`;
  const days = daysBetween(kstDay(t), kstDay(now));
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  return formatDate(t);
}

/** 'YYYY-MM-DD' 두 날짜 사이의 날 수 (b - a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/** 'YYYY-MM-DD'에 n일 더하기 */
export function addDays(day: string, n: number): string {
  const d = new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** <input type="datetime-local">에 넣을 한국 시간 'YYYY-MM-DDTHH:mm' */
export function toKstInputValue(date: Date | number): string {
  const k = kst(date);
  return `${kstDay(date)}T${pad(k.hour)}:${pad(k.minute)}`;
}

/** 한국 시간 'YYYY-MM-DDTHH:mm' → Date. 형식이 틀리면 null */
export function fromKstInputValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - KST_OFFSET;
  return Number.isFinite(utc) ? new Date(utc) : null;
}

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
