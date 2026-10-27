import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` → src/db/schema.ts를 읽어 migrations/ 폴더에 SQL 파일을 만들어요.
// 만들어진 SQL은 wrangler가 D1에 적용해요. (npm run db:migrate:local / db:migrate:remote)
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
