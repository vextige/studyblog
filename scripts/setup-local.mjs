// 내 컴퓨터에서 처음 한 번 실행하는 준비 스크립트예요.  npm run setup:local
// 1) .dev.vars(비밀 값 파일)를 무작위 값으로 만들고
// 2) 내 컴퓨터용 데이터베이스에 표(테이블)를 만들고
// 3) 예전 글 3개와 소개 페이지를 넣어요.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const devVars = new URL('../.dev.vars', import.meta.url);
const example = new URL('../.dev.vars.example', import.meta.url);

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, CI: 'true' },
  });
  if (result.status !== 0) {
    console.error(`\n✖ 위 명령이 실패했어요. 빨간 오류 메시지를 확인해 주세요.`);
    process.exit(result.status ?? 1);
  }
}

let token;
if (existsSync(devVars)) {
  token = /^ADMIN_SETUP_TOKEN=(.*)$/m.exec(readFileSync(devVars, 'utf8'))?.[1]?.trim();
  console.log('• .dev.vars 파일이 이미 있어서 그대로 써요.');
} else {
  token = randomBytes(18).toString('base64url');
  const content = readFileSync(example, 'utf8')
    .replace(/^ADMIN_SETUP_TOKEN=.*$/m, `ADMIN_SETUP_TOKEN=${token}`)
    .replace(/^HASH_SECRET=.*$/m, `HASH_SECRET=${randomBytes(32).toString('base64url')}`);
  writeFileSync(devVars, content, { mode: 0o600 });
  console.log('✔ .dev.vars 파일을 만들었어요. (GitHub에는 올라가지 않아요)');
}

run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local']);
run('node', ['scripts/build-seed.mjs']);
run('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', 'seed/seed.sql']);

console.log(`
✔ 준비 끝!

  1. npm run dev
  2. 브라우저에서 http://localhost:4321/admin/setup 열기
  3. 설정 토큰에 아래 값을 붙여 넣고 패스키(지문·얼굴·Windows Hello)를 등록하면 글을 쓸 수 있어요.

     설정 토큰: ${token ?? '(.dev.vars 파일의 ADMIN_SETUP_TOKEN 값)'}
`);
