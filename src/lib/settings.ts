import { z } from 'astro/zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import { DEFAULT_SETTINGS, type SiteSettings } from './settings-defaults';
import { ISO_DAY } from './time';

export { DEFAULT_SETTINGS, type SiteSettings };

export const SETTINGS_KEY = 'site';

/** http(s) 주소만 허용해요. (javascript: 같은 주소로 링크를 만들 수 없게) */
export const httpUrlOrEmpty = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    if (value === '') return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.');

const line = (max: number) => z.string().trim().max(max);

export const settingsSchema = z.object({
  siteTitle: line(60).min(1, '블로그 이름을 적어 주세요.'),
  siteTagline: line(120),
  siteDescription: line(300),
  heroTitle: z.string().max(120),
  heroSubtitle: line(300),
  authorName: line(40).min(1, '이름(닉네임)을 적어 주세요.'),
  authorBio: line(300),
  avatarMediaId: z.string().regex(/^[a-f0-9]{24}$/).nullable(),
  nowStudying: z.array(line(60).min(1)).max(8),
  social: z.object({
    github: httpUrlOrEmpty,
    email: z.union([z.literal(''), z.email('이메일 형식이 아니에요.').max(120)]),
    x: httpUrlOrEmpty,
    instagram: httpUrlOrEmpty,
    youtube: httpUrlOrEmpty,
    website: httpUrlOrEmpty,
  }),
  challenge: z.object({
    enabled: z.boolean(),
    title: line(60),
    startDate: z.string().regex(ISO_DAY, '날짜는 YYYY-MM-DD 형식이에요.'),
    totalDays: z.number().int().min(7).max(1000),
  }),
  comments: z.object({
    enabled: z.boolean(),
    moderation: z.enum(['manual', 'auto']),
  }),
  seo: z.object({ blockAiCrawlers: z.boolean() }),
  footerNote: line(120),
}) satisfies z.ZodType<SiteSettings>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 저장된 값 위에 기본값을 깔아서, 새 설정 항목이 생겨도 깨지지 않게 해요. */
function mergeDefaults<T>(defaults: T, stored: unknown): T {
  if (!isRecord(defaults) || !isRecord(stored)) return (stored === undefined ? defaults : stored) as T;
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(stored)) {
    if (!(key in defaults)) continue;
    out[key] = mergeDefaults((defaults as Record<string, unknown>)[key], value);
  }
  return out as T;
}

/** DB에 저장된 값(JSON)을 검사해서 설정으로 바꿔요. 이상한 값이면 기본값을 써요. */
export function parseSettings(stored: unknown): SiteSettings {
  const merged = mergeDefaults(DEFAULT_SETTINGS, stored);
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function getSettings(): Promise<SiteSettings> {
  const row = await getDb().select().from(schema.settings).where(eq(schema.settings.key, SETTINGS_KEY)).get();
  return parseSettings(row?.value);
}

export async function saveSettings(next: SiteSettings): Promise<void> {
  const value = settingsSchema.parse(next);
  await getDb()
    .insert(schema.settings)
    .values({ key: SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}

/** 화면에 링크로 내보내기 전에 한 번 더 확인 (이중 안전장치) */
export function safeHref(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
