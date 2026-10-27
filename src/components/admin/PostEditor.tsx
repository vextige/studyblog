/**
 * 글쓰기 화면 (새 글 · 고치기)
 * 왼쪽: 제목 + 본문 편집기 / 오른쪽: 발행 설정, 공부 기록, 태그, 대표 이미지, 버전 기록
 */
import { actions } from 'astro:actions';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { clearBackup, readBackup, writeBackup, type LocalBackup } from '../../lib/editor-client';
import { toast } from '../../scripts/toast';
import MarkdownEditor from './MarkdownEditor';
import MediaPicker from './MediaPicker';
import { POST_TEMPLATES } from './templates';

export type EditorPostData = {
  id: number | null;
  title: string;
  slug: string;
  contentMd: string;
  excerpt: string;
  tagNames: string[];
  dayNumber: number | null;
  studyMinutes: number | null;
  status: 'draft' | 'published' | 'trashed';
  /** 한국 시간 'YYYY-MM-DDTHH:mm' */
  publishedAt: string | null;
  coverMediaId: string | null;
  coverUrl: string | null;
  ogMediaId: string | null;
  ogUrl: string | null;
  featured: boolean;
  allowComments: boolean;
  updatedAt: number | null;
};

type Props = {
  initial: EditorPostData;
  tags: { name: string; color: string }[];
};

type Revision = { id: number; title: string; createdAt: number; length: number };

const STUDY_PRESETS = [30, 60, 90, 120];

function kstNowInput(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16);
}

function studyLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
}

export default function PostEditor({ initial, tags }: Props) {
  const [id, setId] = useState(initial.id);
  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [contentMd, setContentMd] = useState(initial.contentMd);
  const [excerpt, setExcerpt] = useState(initial.excerpt);
  const [tagNames, setTagNames] = useState(initial.tagNames);
  const [tagDraft, setTagDraft] = useState('');
  const [dayNumber, setDayNumber] = useState(initial.dayNumber);
  const [studyMinutes, setStudyMinutes] = useState(initial.studyMinutes);
  const [status, setStatus] = useState(initial.status);
  const [publishedAt, setPublishedAt] = useState(initial.publishedAt ?? '');
  const [cover, setCover] = useState({ id: initial.coverMediaId, url: initial.coverUrl });
  const [og, setOg] = useState({ id: initial.ogMediaId, url: initial.ogUrl });
  const [featured, setFeatured] = useState(initial.featured);
  const [allowComments, setAllowComments] = useState(initial.allowComments);
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [picker, setPicker] = useState<null | 'cover' | 'og'>(null);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [backup, setBackup] = useState<LocalBackup | null>(null);

  const backupKey = `post-draft:${id ?? 'new'}`;
  const touch = () => setDirty(true);

  // 브라우저에 남아 있는 저장 안 된 글이 있으면 알려 줘요.
  useEffect(() => {
    const saved = readBackup(backupKey);
    if (saved && saved.contentMd !== initial.contentMd && saved.at > (initial.updatedAt ?? 0)) setBackup(saved);
    // 처음 한 번만
  }, []);

  // 쓰는 동안 1초마다 브라우저에 임시 백업
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => writeBackup(backupKey, { title, contentMd, at: Date.now() }), 1000);
    return () => clearTimeout(timer);
  }, [title, contentMd, dirty, backupKey]);

  // 저장 안 하고 나가려고 하면 한 번 물어봐요.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Ctrl+S(맥은 ⌘S)는 제목 칸 등 어디에 있든 저장. (본문 편집기 안에서는 편집기가 먼저 처리해요)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      void saveRef.current();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const isScheduled = publishedAt !== '' && publishedAt > kstNowInput();
  const isLive = status === 'published' && !isScheduled;
  const saveRef = useRef<(next?: 'draft' | 'published') => Promise<void>>(async () => {});

  async function save(next?: 'draft' | 'published') {
    if (saving) return;
    const nextStatus = next ?? (status === 'published' ? 'published' : 'draft');
    if (!title.trim()) {
      toast('제목을 먼저 적어 주세요.', 'error');
      document.querySelector<HTMLInputElement>('.editor-title')?.focus();
      return;
    }
    setSaving(true);
    const { data, error } = await actions.admin.savePost({
      id: id ?? undefined,
      title,
      slug,
      contentMd,
      excerpt,
      tagNames,
      dayNumber,
      studyMinutes,
      status: nextStatus,
      publishedAt: publishedAt || null,
      coverMediaId: cover.id,
      ogMediaId: og.id,
      featured,
      allowComments,
      baseUpdatedAt: updatedAt ?? undefined,
    });
    setSaving(false);
    if (error) {
      toast(error.message || '저장하지 못했어요.', 'error');
      return;
    }
    const wasNew = id === null;
    clearBackup(backupKey);
    setId(data.id);
    setSlug(data.slug);
    setStatus(data.status);
    setUpdatedAt(data.updatedAt);
    if (data.publishedAt && !publishedAt) setPublishedAt(new Date(data.publishedAt + 9 * 3_600_000).toISOString().slice(0, 16));
    setDirty(false);
    setSavedAt(Date.now());
    if (wasNew) history.replaceState(null, '', `/admin/posts/${data.id}`);
    if (next === 'published' && status !== 'published') toast(isScheduled ? '예약 발행했어요! ⏰' : '발행했어요! 참 잘했어요 🎉');
    else if (next === 'draft' && status === 'published') toast('발행을 취소하고 임시저장으로 돌렸어요.');
    else toast('저장했어요');
  }
  saveRef.current = save;

  function addTag(raw: string) {
    const name = raw.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!name || tagNames.includes(name) || tagNames.length >= 10) return;
    setTagNames([...tagNames, name]);
    touch();
  }

  const suggestions = useMemo(() => {
    const q = tagDraft.trim().replace(/^#/, '');
    return tags.filter((t) => !tagNames.includes(t.name) && (!q || t.name.includes(q))).slice(0, 8);
  }, [tags, tagNames, tagDraft]);

  function applyTemplate(key: string) {
    const template = POST_TEMPLATES.find((t) => t.key === key);
    if (!template) return;
    setContentMd(template.body);
    setResetKey((k) => k + 1);
    setTagNames([...new Set([...tagNames, ...template.tags])]);
    touch();
  }

  async function loadRevisions() {
    if (!id) return;
    const { data, error } = await actions.admin.listRevisions({ postId: id });
    if (error) toast(error.message, 'error');
    else setRevisions(data);
  }

  async function restoreRevision(revisionId: number) {
    if (!id || !confirm('이 버전의 제목과 본문을 불러올까요? "저장"을 눌러야 실제로 바뀌어요.')) return;
    const { data, error } = await actions.admin.getRevision({ postId: id, revisionId });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    setTitle(data.title);
    setContentMd(data.contentMd);
    setResetKey((k) => k + 1);
    touch();
    toast('옛 버전을 불러왔어요. 확인하고 저장해 주세요.');
  }

  function restoreBackup() {
    if (!backup) return;
    setTitle(backup.title);
    setContentMd(backup.contentMd);
    setResetKey((k) => k + 1);
    setBackup(null);
    touch();
  }

  const publicUrl = id && status === 'published' ? `/posts/${encodeURIComponent(slug)}` : null;
  const saveState = saving ? '저장하는 중…' : dirty ? '● 저장 안 됨' : savedAt ? '저장됨 ✓' : id ? '저장된 상태' : '새 글';

  return (
    <>
      <div class="editor-topbar">
        <div class="left">
          <a class="btn btn-sm btn-ghost" href="/admin/posts">
            ← 목록
          </a>
          <span class={`pill`} data-tone={status === 'published' ? (isScheduled ? 'scheduled' : 'published') : 'draft'}>
            {status === 'published' ? (isScheduled ? '예약됨' : '발행됨') : '임시저장'}
          </span>
          <span class={`save-state${dirty ? ' is-dirty' : ''}`} aria-live="polite">
            {saveState}
          </span>
        </div>
        <div class="right">
          {publicUrl && isLive && (
            <a class="btn btn-sm btn-ghost" href={publicUrl} target="_blank" rel="noopener">
              글 보기 ↗
            </a>
          )}
          {status === 'published' ? (
            <>
              <button class="btn btn-sm btn-ghost" type="button" disabled={saving} onClick={() => void save('draft')}>
                발행 취소
              </button>
              <button class="btn btn-sm btn-primary" type="button" disabled={saving} onClick={() => void save('published')}>
                업데이트
              </button>
            </>
          ) : (
            <>
              <button class="btn btn-sm" type="button" disabled={saving} onClick={() => void save('draft')}>
                임시저장
              </button>
              <button class="btn btn-sm btn-primary" type="button" disabled={saving} onClick={() => void save('published')}>
                {isScheduled ? '예약 발행' : '발행하기'}
              </button>
            </>
          )}
        </div>
      </div>

      {backup && (
        <p class="notice" style={{ marginBottom: '16px' }}>
          <span>
            이 브라우저에 저장 안 된 글이 남아 있어요. ({new Date(backup.at).toLocaleString('ko-KR')})
            <span class="btn-row" style={{ marginTop: '8px' }}>
              <button class="btn btn-sm btn-pen" type="button" onClick={restoreBackup}>
                불러오기
              </button>
              <button
                class="btn btn-sm btn-ghost"
                type="button"
                onClick={() => {
                  clearBackup(backupKey);
                  setBackup(null);
                }}
              >
                버리기
              </button>
            </span>
          </span>
        </p>
      )}

      <div class="editor-shell">
        <div class="editor-paper sheet">
          <label class="sr-only" for="post-title">
            제목
          </label>
          <input
            id="post-title"
            class="editor-title"
            value={title}
            maxLength={200}
            placeholder="오늘의 기록 제목"
            onInput={(e) => {
              setTitle(e.currentTarget.value);
              touch();
            }}
          />

          {!id && contentMd.trim() === '' && (
            <div class="template-picks" aria-label="템플릿 고르기">
              {POST_TEMPLATES.map((t) => (
                <button type="button" onClick={() => applyTemplate(t.key)}>
                  <b>{t.name}</b>
                  <span>{t.hint}</span>
                </button>
              ))}
            </div>
          )}

          <MarkdownEditor
            value={contentMd}
            resetKey={resetKey}
            onChange={(v) => {
              setContentMd(v);
              touch();
            }}
            onSave={() => void saveRef.current()}
            placeholder="여기에 오늘 공부한 내용을 적어요. ## 소제목, **굵게**, ==형광펜==, - [ ] 할 일 … 이미지는 붙여 넣으면 바로 올라가요."
          />
        </div>

        <aside class="editor-side" aria-label="글 설정">
          <section class="side-panel sheet">
            <h2>발행</h2>
            <label class="field">
              <span>발행 시각 (한국 시간)</span>
              <input
                class="input"
                type="datetime-local"
                value={publishedAt}
                onInput={(e) => {
                  setPublishedAt(e.currentTarget.value);
                  touch();
                }}
              />
              <small>비워 두면 발행 버튼을 누른 순간. 미래 시각이면 그때 자동으로 공개돼요.</small>
            </label>
            <label class="field">
              <span>글 주소</span>
              <input
                class="input"
                value={slug}
                maxLength={120}
                placeholder="비워 두면 제목으로 자동"
                onInput={(e) => {
                  setSlug(e.currentTarget.value);
                  touch();
                }}
              />
              <small>/posts/{slug || '자동'}</small>
            </label>
          </section>

          <section class="side-panel sheet">
            <h2>공부 기록</h2>
            <div class="two-col">
              <label class="field">
                <span>Day 번호</span>
                <input
                  class="input"
                  type="number"
                  min={1}
                  max={10000}
                  value={dayNumber ?? ''}
                  placeholder="없음"
                  onInput={(e) => {
                    const n = Number(e.currentTarget.value);
                    setDayNumber(e.currentTarget.value && n >= 1 ? Math.floor(n) : null);
                    touch();
                  }}
                />
              </label>
              <label class="field">
                <span>공부 시간(분)</span>
                <input
                  class="input"
                  type="number"
                  min={0}
                  max={1440}
                  step={5}
                  value={studyMinutes ?? ''}
                  placeholder="예) 60"
                  onInput={(e) => {
                    const n = Number(e.currentTarget.value);
                    setStudyMinutes(e.currentTarget.value && n >= 0 ? Math.min(1440, Math.floor(n)) : null);
                    touch();
                  }}
                />
              </label>
            </div>
            <div class="tag-suggest" aria-label="공부 시간 빠르게 고르기">
              {STUDY_PRESETS.map((m) => (
                <button
                  type="button"
                  onClick={() => {
                    setStudyMinutes(m);
                    touch();
                  }}
                >
                  {studyLabel(m)}
                </button>
              ))}
            </div>
          </section>

          <section class="side-panel sheet">
            <h2>태그</h2>
            <div class="tag-input">
              {tagNames.map((name) => (
                <span class="tag" data-color={tags.find((t) => t.name === name)?.color ?? 'lime'}>
                  {name}
                  <button
                    type="button"
                    aria-label={`${name} 태그 빼기`}
                    onClick={() => {
                      setTagNames(tagNames.filter((n) => n !== name));
                      touch();
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={tagDraft}
                placeholder={tagNames.length ? '' : '태그 입력 후 Enter'}
                aria-label="태그 추가"
                onInput={(e) => setTagDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag(tagDraft);
                    setTagDraft('');
                  } else if (e.key === 'Backspace' && !tagDraft && tagNames.length) {
                    setTagNames(tagNames.slice(0, -1));
                    touch();
                  }
                }}
                onBlur={() => {
                  if (tagDraft.trim()) {
                    addTag(tagDraft);
                    setTagDraft('');
                  }
                }}
              />
            </div>
            {suggestions.length > 0 && (
              <div class="tag-suggest">
                {suggestions.map((t) => (
                  <button type="button" onClick={() => addTag(t.name)}>
                    + {t.name}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section class="side-panel sheet">
            <h2>요약 · 대표 이미지</h2>
            <label class="field">
              <span>한두 줄 요약</span>
              <textarea
                class="textarea"
                maxLength={300}
                value={excerpt}
                placeholder="비워 두면 본문 앞부분으로 자동"
                onInput={(e) => {
                  setExcerpt(e.currentTarget.value);
                  touch();
                }}
              />
            </label>
            <div class="cover-box">
              {cover.url && <img src={cover.url} alt="대표 이미지 미리보기" />}
              <div class="btn-row">
                <button class="btn btn-sm" type="button" onClick={() => setPicker('cover')}>
                  {cover.id ? '대표 이미지 바꾸기' : '대표 이미지 고르기'}
                </button>
                {cover.id && (
                  <button
                    class="btn btn-sm btn-ghost"
                    type="button"
                    onClick={() => {
                      setCover({ id: null, url: null });
                      touch();
                    }}
                  >
                    빼기
                  </button>
                )}
              </div>
            </div>
            <details class="details-box">
              <summary>더 보기</summary>
              <div class="form-grid">
                <div class="cover-box">
                  <span class="field-label">SNS 공유 이미지 (없으면 대표 이미지)</span>
                  {og.url && <img src={og.url} alt="공유 이미지 미리보기" />}
                  <div class="btn-row">
                    <button class="btn btn-sm" type="button" onClick={() => setPicker('og')}>
                      고르기
                    </button>
                    {og.id && (
                      <button
                        class="btn btn-sm btn-ghost"
                        type="button"
                        onClick={() => {
                          setOg({ id: null, url: null });
                          touch();
                        }}
                      >
                        빼기
                      </button>
                    )}
                  </div>
                </div>
                <label class="switch">
                  <input
                    type="checkbox"
                    checked={featured}
                    onChange={(e) => {
                      setFeatured(e.currentTarget.checked);
                      touch();
                    }}
                  />
                  홈 화면에 추천 기록으로 고정
                </label>
                <label class="switch">
                  <input
                    type="checkbox"
                    checked={allowComments}
                    onChange={(e) => {
                      setAllowComments(e.currentTarget.checked);
                      touch();
                    }}
                  />
                  댓글 받기
                </label>
              </div>
            </details>
          </section>

          {id && (
            <section class="side-panel sheet">
              <h2>버전 기록</h2>
              {revisions === null ? (
                <button class="btn btn-sm" type="button" onClick={() => void loadRevisions()}>
                  저장할 때마다 남은 옛 버전 보기
                </button>
              ) : revisions.length === 0 ? (
                <p class="muted small">아직 남은 버전이 없어요.</p>
              ) : (
                <ul class="revision-list">
                  {revisions.map((r) => (
                    <li>
                      <button type="button" onClick={() => void restoreRevision(r.id)} title={r.title}>
                        <span>{new Date(r.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                        <span>{r.length.toLocaleString()}자</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>

      <MediaPicker
        open={picker !== null}
        title={picker === 'og' ? 'SNS 공유 이미지 고르기' : '대표 이미지 고르기'}
        onClose={() => setPicker(null)}
        onPick={(item) => {
          if (picker === 'og') setOg({ id: item.id, url: item.url });
          else setCover({ id: item.id, url: item.url });
          setPicker(null);
          touch();
        }}
      />
    </>
  );
}
