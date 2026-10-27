/**
 * 마크다운 → HTML 변환기
 *
 * 보안: 글 안에 HTML 태그를 직접 쓰는 기능(html: false)을 꺼 두었어요.
 * <script> 같은 걸 적어도 글자 그대로 보일 뿐 실행되지 않아요.
 * 링크도 javascript: 같은 위험한 주소는 자동으로 막혀요.
 *
 * 추가 문법
 *   ==형광펜==                      → 형광펜 칠하기
 *   - [ ] 할 일 / - [x] 한 일        → 체크리스트
 *   :::tip 제목 … :::               → 상자 (note·메모 / tip·팁 / warn·주의 / summary·정리)
 *   :::details 제목 … :::           → 접었다 펴는 상자 (정답 숨기기 등)
 *   ![설명](https://youtu.be/…)      → 유튜브 영상 넣기
 *   ![설명](이미지주소 "캡션")        → 사진 아래 캡션
 *   ```python title="hello.py"      → 코드 블록 + 파일 이름
 */
import GithubSlugger from 'github-slugger';
import MarkdownItCtor, { type MarkdownIt, type Token } from 'markdown-it';
import container from 'markdown-it-container';
import mark from 'markdown-it-mark';
import { escapeHtml, highlightCode } from './highlight.ts';

export type TocItem = { level: 2 | 3; id: string; text: string };

export type RenderedMarkdown = {
  html: string;
  toc: TocItem[];
  /** 검색용 텍스트 (코드 포함) */
  text: string;
  /** 요약·읽는 시간 계산용 텍스트 (코드 제외) */
  prose: string;
  readingMinutes: number;
  firstImage: string | null;
};

type RenderEnv = { toc: TocItem[]; firstImage: string | null };

const CALLOUTS = {
  note: { label: '메모', icon: '📝' },
  tip: { label: '팁', icon: '💡' },
  warn: { label: '주의', icon: '⚠️' },
  summary: { label: '정리', icon: '✅' },
} as const;
type CalloutKind = keyof typeof CALLOUTS;

const CALLOUT_ALIASES: Record<string, CalloutKind> = {
  note: 'note', info: 'note', 메모: 'note', 참고: 'note',
  tip: 'tip', 팁: 'tip', hint: 'tip',
  warn: 'warn', warning: 'warn', danger: 'warn', caution: 'warn', 주의: 'warn', 경고: 'warn',
  summary: 'summary', check: 'summary', success: 'summary', 정리: 'summary', 요약: 'summary',
};
const DETAILS_NAMES = new Set(['details', 'fold', '접기', '정답']);

const YOUTUBE_RE =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;

export function youtubeId(url: string): string | null {
  return YOUTUBE_RE.exec(url)?.[1] ?? null;
}

function firstWord(info: string): string {
  return info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

function restOfInfo(info: string): string {
  return info.trim().replace(/^\S+\s*/, '').trim();
}

function inlineText(token: Token | undefined): string {
  if (!token) return '';
  if (!token.children) return token.content;
  return token.children
    .map((child) => (child.type === 'text' || child.type === 'code_inline' ? child.content : ''))
    .join('')
    .trim();
}

function parseCodeTitle(rest: string): string {
  const quoted = /(?:title|file|filename)=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(rest);
  if (quoted) return (quoted[1] ?? quoted[2] ?? quoted[3] ?? '').trim();
  return rest.trim();
}

/** 속성 값을 글자로 (markdown-it은 숫자로 줄 때도 있어요) */
function attr(token: Token, name: string): string | null {
  const value = token.attrGet(name);
  return value === null ? null : String(value);
}

function createRenderer(): MarkdownIt {
  const md = new MarkdownItCtor({ html: false, linkify: true, breaks: true, typographer: false });
  // "test.py" 같은 글자를 링크로 잘못 바꾸지 않도록, http(s):// 또는 www. 로 시작할 때만 링크로 만들어요.
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
  md.use(mark);

  md.use(container, 'callout', {
    validate: (params: string) => firstWord(params) in CALLOUT_ALIASES,
    render(tokens: Token[], idx: number) {
      const token = tokens[idx]!;
      if (token.nesting !== 1) return '</aside>\n';
      const kind = CALLOUT_ALIASES[firstWord(token.info)] ?? 'note';
      const { label, icon } = CALLOUTS[kind];
      const title = restOfInfo(token.info) || label;
      return `<aside class="callout callout-${kind}"><p class="callout-title"><span aria-hidden="true">${icon}</span> ${escapeHtml(title)}</p>\n`;
    },
  });

  md.use(container, 'details', {
    validate: (params: string) => DETAILS_NAMES.has(firstWord(params)),
    render(tokens: Token[], idx: number) {
      const token = tokens[idx]!;
      if (token.nesting !== 1) return '</div></details>\n';
      const title = restOfInfo(token.info) || '펼쳐 보기';
      return `<details class="fold"><summary>${escapeHtml(title)}</summary><div class="fold-body">\n`;
    },
  });

  // 제목: 글 제목이 h1이라 본문의 # 은 h2로 낮추고, 목차(TOC)용 id를 붙여요.
  md.core.ruler.push('headings', (state) => {
    const env = state.env as RenderEnv;
    const slugger = new GithubSlugger();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]!;
      if (open.type !== 'heading_open') continue;
      const close = tokens[i + 2];
      const level = Math.min(Math.max(Number(open.tag.slice(1)), 2), 4);
      open.tag = `h${level}`;
      if (close?.type === 'heading_close') close.tag = `h${level}`;
      const text = inlineText(tokens[i + 1]);
      const id = slugger.slug(text) || `section-${i}`;
      open.attrSet('id', id);
      open.meta = { ...open.meta, anchor: id };
      if (level === 2 || level === 3) env.toc.push({ level, id, text });
    }
  });

  // 체크리스트: "- [ ] 할 일"
  md.core.ruler.push('task_lists', (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i]!;
      if (inline.type !== 'inline' || tokens[i - 1]!.type !== 'paragraph_open') continue;
      const item = tokens[i - 2]!;
      if (item.type !== 'list_item_open') continue;
      const first = inline.children?.[0];
      if (!first || first.type !== 'text') continue;
      const match = /^\[([ xX])\](?:\s|$)/.exec(first.content);
      if (!match) continue;
      first.content = first.content.slice(match[0].length);
      const checkbox = new state.Token('html_inline', '', 0);
      const checked = match[1] !== ' ';
      checkbox.content = `<input type="checkbox" class="task-check" disabled${checked ? ' checked' : ''} aria-label="${checked ? '완료' : '미완료'}"> `;
      inline.children!.unshift(checkbox);
      item.attrJoin('class', checked ? 'task-item is-done' : 'task-item');
    }
  });

  // 문단에 이미지 하나만 있으면 <figure>로 바꿔서 캡션을 달 수 있게 해요.
  md.core.ruler.push('figures', (state) => {
    const tokens = state.tokens;
    for (let i = 1; i < tokens.length - 1; i++) {
      const inline = tokens[i]!;
      const open = tokens[i - 1]!;
      const close = tokens[i + 1]!;
      if (inline.type !== 'inline' || open.type !== 'paragraph_open' || close.type !== 'paragraph_close') continue;
      if (open.hidden) continue;
      const kids = (inline.children ?? []).filter(
        (c) => c.type !== 'softbreak' && !(c.type === 'text' && c.content.trim() === ''),
      );
      const image = kids[0];
      if (kids.length !== 1 || !image || image.type !== 'image') continue;
      open.tag = 'figure';
      close.tag = 'figure';
      open.attrJoin('class', youtubeId(attr(image, 'src') ?? '') ? 'figure figure-embed' : 'figure');
      image.meta = { ...image.meta, figure: true };
    }
  });

  const rules = md.renderer.rules;

  rules.heading_close = (tokens, idx, options, _env, self) => {
    const anchor = tokens[idx - 2]?.meta?.anchor;
    const link =
      typeof anchor === 'string'
        ? `<a class="heading-anchor" href="#${escapeHtml(anchor)}" aria-label="이 제목으로 바로가기">#</a>`
        : '';
    return link + self.renderToken(tokens, idx, options);
  };

  rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const renderEnv = env as RenderEnv;
    const src = attr(token, 'src') ?? '';
    const alt = self.renderInlineAsText(token.children ?? [], options, env);
    const title = attr(token, 'title') ?? '';
    const videoId = youtubeId(src);
    if (videoId) {
      const label = alt || 'YouTube 동영상';
      return (
        `<span class="embed embed-youtube"><iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="${escapeHtml(label)}" ` +
        `loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ` +
        `allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></span>`
      );
    }
    renderEnv.firstImage ??= src;
    const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`;
    if (token.meta?.figure && title) return `${img}<figcaption>${escapeHtml(title)}</figcaption>`;
    return title ? img.replace('>', ` title="${escapeHtml(title)}">`) : img;
  };

  rules.link_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx]!;
    const href = attr(token, 'href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return self.renderToken(tokens, idx, options);
  };

  rules.table_open = () => '<div class="table-wrap"><table>\n';
  rules.table_close = () => '</table></div>\n';

  rules.fence = (tokens, idx) => {
    const token = tokens[idx]!;
    const info = md.utils.unescapeAll(token.info ?? '').trim();
    const [rawLang = ''] = info.split(/\s+/, 1);
    const title = parseCodeTitle(info.slice(rawLang.length));
    return renderCode(token.content, rawLang, title);
  };
  rules.code_block = (tokens, idx) => renderCode(tokens[idx]!.content, '', '');

  return md;
}

function renderCode(code: string, rawLang: string, title: string): string {
  const { lang, label, html } = highlightCode(code.replace(/\n$/, ''), rawLang);
  const caption = title ? `<figcaption class="code-title">${escapeHtml(title)}</figcaption>` : '';
  const langClass = lang ? ` language-${lang}` : '';
  return `<figure class="code" data-lang="${escapeHtml(label)}">${caption}<pre><code class="hljs${langClass}">${html}</code></pre></figure>\n`;
}

function collectText(tokens: Token[], includeCode: boolean): string {
  const parts: string[] = [];
  const walk = (list: Token[]) => {
    for (const t of list) {
      if (t.type === 'text' || t.type === 'code_inline') parts.push(t.content);
      else if (t.type === 'softbreak' || t.type === 'hardbreak') parts.push(' ');
      else if ((t.type === 'fence' || t.type === 'code_block') && includeCode) parts.push(`\n${t.content}\n`);
      else if (t.type === 'container_callout_open' || t.type === 'container_details_open') parts.push(`${restOfInfo(t.info)}\n`);
      if (t.children) walk(t.children);
      if (t.block && t.nesting === -1) parts.push('\n');
    }
  };
  walk(tokens);
  return parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

let renderer: MarkdownIt | undefined;

export function renderMarkdown(source: string): RenderedMarkdown {
  renderer ??= createRenderer();
  const env: RenderEnv = { toc: [], firstImage: null };
  const tokens = renderer.parse(source.normalize('NFC'), env);
  const html = renderer.renderer.render(tokens, renderer.options, env);
  const prose = collectText(tokens, false);
  const text = collectText(tokens, true);
  const codeLines = tokens
    .filter((t) => t.type === 'fence' || t.type === 'code_block')
    .reduce((sum, t) => sum + t.content.split('\n').length, 0);
  // 한국어는 1분에 약 500자, 코드는 1분에 약 30줄 읽는다고 계산해요.
  const chars = prose.replace(/\s/g, '').length;
  const readingMinutes = Math.max(1, Math.round(chars / 500 + codeLines / 30));
  return { html, toc: env.toc, text, prose, readingMinutes, firstImage: env.firstImage };
}

/** 본문에서 목록용 한두 줄 요약 만들기 */
export function makeExcerpt(prose: string, max = 140): string {
  const flat = prose.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** 홈 화면 큰 제목처럼 한 줄짜리 문구에 ==형광펜== 과 줄바꿈만 허용해요. */
export function renderHighlightLine(source: string): string {
  return escapeHtml(source)
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(/\r?\n/g, '<br>');
}
