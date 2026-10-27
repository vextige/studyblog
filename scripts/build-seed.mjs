// 예전 블로그 글(seed/legacy/*.md)을 새 데이터베이스에 넣는 SQL 파일(seed/seed.sql)로 바꿔요.
// 이미 같은 주소(slug)의 글이 있으면 건드리지 않아서, 여러 번 실행해도 안전해요.
//   node scripts/build-seed.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { makeExcerpt, renderMarkdown } from '../src/lib/markdown.ts';

const legacyDir = new URL('../seed/legacy/', import.meta.url);
const output = new URL('../seed/seed.sql', import.meta.url);

/** 글 맨 위 --- 사이의 정보(frontmatter)를 읽어요. (이 블로그에서 쓰던 간단한 형식만) */
function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return { data: {}, body: source };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    const value = raw.trim();
    if (value.startsWith('[') || /^".*"$/.test(value)) data[key] = JSON.parse(value);
    else if (/^\d+$/.test(value)) data[key] = Number(value);
    else data[key] = value;
  }
  return { data, body: match[2] };
}

const sql = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
};

/** 예전 글의 HTML 표시(<mark>, 주석)를 새 블로그 문법으로 바꿔요. */
function upgradeMarkdown(body) {
  return body
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .replace(/<mark>([\s\S]*?)<\/mark>/g, '==$1==')
    .replace(/^# .+\n+/m, '')
    .trim();
}

const TAGS = [
  { name: '기록', color: 'lime', description: '그날 공부한 내용을 남기는 일지' },
  { name: '개념', color: 'sky', description: '배운 개념을 초등학생도 이해하게 풀어 쓴 글' },
  { name: '독서', color: 'orange', description: '책·강의를 보고 "핵심 3줄 / 내 생각"으로 정리한 노트' },
];

const lines = ['-- node scripts/build-seed.mjs 로 만든 파일이에요. 직접 고치지 마세요.', ''];

TAGS.forEach((tag, i) => {
  lines.push(
    `INSERT OR IGNORE INTO tags (slug, name, description, color, sort_order) VALUES (${sql(tag.name)}, ${sql(tag.name)}, ${sql(tag.description)}, ${sql(tag.color)}, ${i + 1});`,
  );
});
lines.push('');

const files = readdirSync(legacyDir).filter((f) => /^day-.*\.md$/.test(f)).sort();
for (const file of files) {
  const { data, body } = parseFrontmatter(readFileSync(new URL(file, legacyDir), 'utf8'));
  const slug = file.replace(/\.md$/, '');
  const markdown = upgradeMarkdown(body);
  const rendered = renderMarkdown(markdown);
  // 예전 글은 그날 밤 9시(한국 시간)에 쓴 걸로 넣어요.
  const at = Date.parse(`${data.date}T21:00:00+09:00`);
  if (!Number.isFinite(at)) throw new Error(`${file}: date 형식이 이상해요 (${data.date})`);
  lines.push(
    `INSERT OR IGNORE INTO posts (slug, title, excerpt, content_md, content_html, content_text, toc, reading_minutes, status, day_number, published_at, created_at, updated_at) VALUES (${[
      sql(slug),
      sql(data.title),
      sql(data.description || makeExcerpt(rendered.prose)),
      sql(markdown),
      sql(rendered.html),
      sql(rendered.text),
      sql(JSON.stringify(rendered.toc)),
      rendered.readingMinutes,
      sql('published'),
      typeof data.day === 'number' ? data.day : 'NULL',
      at,
      at,
      at,
    ].join(', ')});`,
  );
  for (const tag of data.tags ?? []) {
    lines.push(
      `INSERT OR IGNORE INTO post_tags (post_id, tag_id) SELECT p.id, t.id FROM posts p, tags t WHERE p.slug = ${sql(slug)} AND t.name = ${sql(tag)};`,
    );
  }
  lines.push(
    `INSERT INTO post_revisions (post_id, title, content_md, created_at) SELECT p.id, p.title, p.content_md, p.created_at FROM posts p WHERE p.slug = ${sql(slug)} AND NOT EXISTS (SELECT 1 FROM post_revisions r WHERE r.post_id = p.id);`,
  );
  lines.push('');
}

// 소개 페이지
const about = parseFrontmatter(readFileSync(new URL('about.md', legacyDir), 'utf8'));
const aboutMd = upgradeMarkdown(about.body);
lines.push(
  `INSERT OR IGNORE INTO pages (slug, title, content_md, content_html, published, show_in_nav, nav_order) VALUES (${sql('about')}, ${sql(about.data.title || '소개')}, ${sql(aboutMd)}, ${sql(renderMarkdown(aboutMd).html)}, 1, 1, 1);`,
);
lines.push('');

writeFileSync(output, lines.join('\n'));
console.log(`✔ seed/seed.sql 만들었어요. (글 ${files.length}개, 태그 ${TAGS.length}개, 소개 페이지 1개)`);
