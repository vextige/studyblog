// 글 화면에서만 쓰는 기능: 목차 따라가기, 도장 찍기, 반응 스티커, 링크 복사, 조회수, 댓글
import { actions } from 'astro:actions';
import { toast } from './toast';

const article = document.querySelector<HTMLElement>('[data-post-id]');
const postId = Number(article?.dataset.postId);

/* ───────── 목차: 지금 읽는 제목을 형광펜으로 ───────── */

const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>('[data-toc] a')];
if (tocLinks.length > 0) {
  const byId = new Map(tocLinks.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
  const headings = [...byId.keys()].map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
  const visible = new Set<string>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      // 화면에 보이는 제목 중 가장 위의 것, 없으면 지나온 마지막 제목
      const current =
        headings.find((h) => visible.has(h.id)) ?? [...headings].reverse().find((h) => h.getBoundingClientRect().top < 0);
      for (const a of tocLinks) a.classList.toggle('is-active', current !== undefined && byId.get(current.id) === a);
    },
    { rootMargin: '-64px 0px -60% 0px' },
  );
  for (const h of headings) observer.observe(h);
}

/* ───────── 끝까지 읽으면 '참 잘했어요' 도장 쾅 ───────── */

const stamp = document.querySelector('[data-done-stamp]');
if (stamp) {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      stamp.classList.add('is-stamped');
      observer.disconnect();
    },
    { threshold: 0.6 },
  );
  observer.observe(stamp);
}

/* ───────── 반응 스티커 ───────── */

document.querySelector('[data-reactions]')?.addEventListener('click', async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-reaction]');
  if (!button || button.disabled) return;
  const kind = button.dataset.reaction as 'clap' | 'fire' | 'bulb' | 'heart';
  button.disabled = true;
  const { data, error } = await actions.reactions.toggle({ postId, kind });
  button.disabled = false;
  if (error) {
    toast(error.message || '스티커를 붙이지 못했어요.', 'error');
    return;
  }
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-reaction]')) {
    const k = el.dataset.reaction as keyof typeof data.counts;
    el.setAttribute('aria-pressed', String(data.mine.includes(k)));
    const count = el.querySelector('.count');
    if (count) count.textContent = String(data.counts[k]);
  }
  if (data.mine.includes(kind)) {
    button.classList.remove('pop');
    void button.offsetWidth; // 애니메이션을 처음부터 다시
    button.classList.add('pop');
  }
});

/* ───────── 링크 복사 · 공유 ───────── */

document.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href.split('#')[0]!);
    toast('링크를 복사했어요');
  } catch {
    toast('복사하지 못했어요. 주소창의 주소를 복사해 주세요.', 'error');
  }
});

const shareButton = document.querySelector<HTMLButtonElement>('[data-share]');
if (shareButton && 'share' in navigator) {
  shareButton.hidden = false;
  shareButton.addEventListener('click', () => {
    navigator.share({ title: document.title, url: location.href.split('#')[0] }).catch(() => {});
  });
}

/* ───────── 조회수: 같은 글은 하루에 한 번만 ───────── */

if (postId) {
  const key = `viewed:${postId}`;
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  let seen = false;
  try {
    seen = localStorage.getItem(key) === today;
    localStorage.setItem(key, today);
  } catch {
    // 저장이 막힌 브라우저는 그냥 셉니다.
  }
  if (!seen) {
    fetch('/api/views', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postId }),
      keepalive: true,
    }).catch(() => {});
  }
}

/* ───────── 댓글 ───────── */

const TOKENS_KEY = 'comment-tokens';

function loadTokens(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveToken(id: number, token: string) {
  try {
    const tokens = loadTokens();
    tokens[id] = token;
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // 저장이 막히면 나중에 직접 지울 수 없을 뿐이에요.
  }
}

function forgetToken(id: number) {
  try {
    const tokens = loadTokens();
    delete tokens[id];
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // 무시
  }
}

/** 내가 쓴 댓글에만 '지우기' 버튼을 보여 줘요. */
function revealOwnDeleteButtons() {
  const tokens = loadTokens();
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-delete-own]')) {
    button.hidden = !tokens[button.dataset.deleteOwn ?? ''];
  }
}
revealOwnDeleteButtons();

const form = document.querySelector<HTMLFormElement>('[data-comment-form]');
const list = document.querySelector<HTMLOListElement>('[data-comment-list]');
const countEl = document.querySelector('[data-comment-count]');
const parentInput = form?.querySelector<HTMLInputElement>('[data-parent-input]');
const replying = form?.querySelector<HTMLElement>('[data-replying]');
const statusEl = form?.querySelector<HTMLElement>('[data-comment-status]');
const nameInput = form?.querySelector<HTMLInputElement>('[data-comment-name]');

// 화면을 연 시각 (너무 빨리 보내는 자동 프로그램을 거르는 데 써요)
const startedAt = form?.querySelector<HTMLInputElement>('[data-started-at]');
if (startedAt) startedAt.value = String(Date.now());

// 지난번에 쓴 이름 기억하기
if (nameInput && !nameInput.readOnly) {
  try {
    nameInput.value ||= localStorage.getItem('comment-name') ?? '';
  } catch {
    // 무시
  }
}

function setStatus(message: string, tone: 'ok' | 'error' | null) {
  if (!statusEl) return;
  statusEl.hidden = !message;
  statusEl.textContent = message;
  statusEl.className = `notice${tone ? ` notice-${tone}` : ''}`;
}

function cancelReply() {
  if (parentInput) parentInput.value = '';
  if (replying) replying.hidden = true;
}

function buildComment(c: { id: number; authorName: string; body: string; isAdmin: boolean }): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'comment';
  li.id = `comment-${c.id}`;
  li.dataset.commentId = String(c.id);
  const head = document.createElement('div');
  head.className = 'comment-head';
  const name = document.createElement('span');
  name.className = 'comment-name';
  name.textContent = c.authorName;
  head.appendChild(name);
  if (c.isAdmin) {
    const badge = document.createElement('span');
    badge.className = 'owner-badge';
    badge.textContent = '글쓴이';
    head.appendChild(badge);
  }
  const time = document.createElement('span');
  time.className = 'comment-time';
  time.textContent = '방금 전';
  head.appendChild(time);
  const body = document.createElement('p');
  body.className = 'comment-body';
  body.textContent = c.body;
  const actionsRow = document.createElement('div');
  actionsRow.className = 'comment-actions';
  const del = document.createElement('button');
  del.className = 'text-btn';
  del.type = 'button';
  del.dataset.deleteOwn = String(c.id);
  del.textContent = '내 댓글 지우기';
  actionsRow.appendChild(del);
  li.appendChild(head);
  li.appendChild(body);
  li.appendChild(actionsRow);
  return li;
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  setStatus('', null);
  const { data, error } = await actions.comments.create(new FormData(form));
  if (submit) submit.disabled = false;
  if (error) {
    setStatus(error.message || '댓글을 남기지 못했어요.', 'error');
    return;
  }
  try {
    if (!nameInput?.readOnly) localStorage.setItem('comment-name', data.authorName);
  } catch {
    // 무시
  }
  if (data.id && data.deleteToken) saveToken(data.id, data.deleteToken);
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea');
  if (textarea) textarea.value = '';

  if (data.status === 'approved' && data.id && list) {
    const li = buildComment(data);
    const parentId = Number(parentInput?.value);
    const parent = parentId ? list.querySelector<HTMLLIElement>(`#comment-${parentId}`) : null;
    if (parent) {
      let replies = parent.querySelector<HTMLOListElement>(':scope > .replies');
      if (!replies) {
        replies = document.createElement('ol');
        replies.className = 'replies';
        parent.appendChild(replies);
      }
      replies.appendChild(li);
    } else {
      list.appendChild(li);
    }
    if (countEl) countEl.textContent = String(Number(countEl.textContent) + 1);
    li.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setStatus('댓글이 등록됐어요. 고마워요!', 'ok');
  } else {
    setStatus('댓글을 받았어요. 글쓴이가 확인하면 공개돼요.', 'ok');
  }
  cancelReply();
  revealOwnDeleteButtons();
});

form?.querySelector('[data-reply-cancel]')?.addEventListener('click', cancelReply);

list?.addEventListener('click', async (event) => {
  const target = event.target as Element;

  const replyButton = target.closest<HTMLButtonElement>('[data-reply]');
  if (replyButton && form && parentInput && replying) {
    parentInput.value = replyButton.dataset.reply ?? '';
    const nameEl = replying.querySelector('[data-replying-name]');
    if (nameEl) nameEl.textContent = replyButton.dataset.replyName ?? '';
    replying.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.querySelector('textarea')?.focus({ preventScroll: true });
    return;
  }

  const deleteButton = target.closest<HTMLButtonElement>('[data-delete-own]');
  if (deleteButton) {
    const id = Number(deleteButton.dataset.deleteOwn);
    const token = loadTokens()[id];
    if (!token || !confirm('이 댓글을 지울까요? 되돌릴 수 없어요.')) return;
    const { error } = await actions.comments.deleteOwn({ id, token });
    if (error) {
      toast(error.message || '지우지 못했어요.', 'error');
      return;
    }
    forgetToken(id);
    const li = document.getElementById(`comment-${id}`);
    const removed = li ? 1 + li.querySelectorAll('.replies .comment').length : 0;
    li?.remove();
    if (countEl) countEl.textContent = String(Math.max(0, Number(countEl.textContent) - removed));
    toast('댓글을 지웠어요');
  }
});
