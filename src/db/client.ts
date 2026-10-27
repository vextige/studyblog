import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

function createDb(binding: D1Database) {
  return drizzle(binding, { schema });
}

let cached: { binding: D1Database; db: Database } | undefined;

/** D1 데이터베이스 연결 (요청마다 새로 만들지 않고 재사용해요) */
export function getDb(): Database {
  if (cached?.binding !== env.DB) cached = { binding: env.DB, db: createDb(env.DB) };
  return cached.db;
}

/** Drizzle로 표현하기 어려운 쿼리(BLOB, UPSERT … RETURNING)는 D1을 직접 써요. */
export function getD1(): D1Database {
  return env.DB;
}

export { schema };
