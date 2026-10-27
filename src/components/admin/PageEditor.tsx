// 고정 페이지 편집 (소개, 개인정보 처리방침 등)
import { actions } from 'astro:actions';
import { useEffect, useRef, useState } from 'preact/hooks';
import { toast } from '../../scripts/toast';
import MarkdownEditor from './MarkdownEditor';

export type EditorPageData = {
  id: number | null;
  title: string;
  slug: string;
  contentMd: string;
  published: boolean;
  showInNav: boolean;
  navOrder: number;
  updatedAt: number | null;
};

export default function PageEditor({ initial }: { initial: EditorPageData }) {
  const [page, setPage] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const update = <K extends keyof EditorPageData>(key: K, value: EditorPageData[K]) => {
    setPage((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };

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

  async function save() {
    if (saving) return;
    setSaving(true);
    const { data, error } = await actions.admin.savePage({
      id: page.id ?? undefined,
      title: page.title,
      slug: page.slug,
      contentMd: page.contentMd,
      published: page.published,
      showInNav: page.showInNav,
      navOrder: page.navOrder,
      baseUpdatedAt: page.updatedAt ?? undefined,
    });
    setSaving(false);
    if (error) {
      toast(error.message || '저장하지 못했어요.', 'error');
      return;
    }
    if (page.id === null) history.replaceState(null, '', `/admin/pages/${data.id}`);
    setPage((p) => ({ ...p, id: data.id, slug: data.slug, updatedAt: data.updatedAt }));
    setDirty(false);
    toast('저장했어요');
  }
  saveRef.current = save;

  return (
    <>
      <div class="editor-topbar">
        <div class="left">
          <a class="btn btn-sm btn-ghost" href="/admin/pages">
            ← 목록
          </a>
          <span class="pill" data-tone={page.published ? 'published' : 'draft'}>
            {page.published ? '공개' : '비공개'}
          </span>
          <span class={`save-state${dirty ? ' is-dirty' : ''}`}>{saving ? '저장하는 중…' : dirty ? '● 저장 안 됨' : '저장된 상태'}</span>
        </div>
        <div class="right">
          {page.id && page.published && (
            <a class="btn btn-sm btn-ghost" href={`/${page.slug}`} target="_blank" rel="noopener">
              페이지 보기 ↗
            </a>
          )}
          <button class="btn btn-sm btn-primary" type="button" disabled={saving} onClick={() => void save()}>
            저장
          </button>
        </div>
      </div>

      <div class="editor-shell">
        <div class="editor-paper sheet">
          <input
            class="editor-title"
            aria-label="제목"
            value={page.title}
            maxLength={120}
            placeholder="페이지 제목 (예: 소개)"
            onInput={(e) => update('title', e.currentTarget.value)}
          />
          <MarkdownEditor
            value={page.contentMd}
            onChange={(v) => update('contentMd', v)}
            onSave={() => void saveRef.current()}
            placeholder="페이지 내용을 마크다운으로 적어요."
          />
        </div>
        <aside class="editor-side" aria-label="페이지 설정">
          <section class="side-panel sheet">
            <h2>설정</h2>
            <label class="field">
              <span>주소</span>
              <input
                class="input"
                value={page.slug}
                maxLength={120}
                placeholder="예) about"
                onInput={(e) => update('slug', e.currentTarget.value)}
              />
              <small>사이트주소/{page.slug || '자동'}</small>
            </label>
            <label class="switch">
              <input type="checkbox" checked={page.published} onChange={(e) => update('published', e.currentTarget.checked)} />
              공개하기
            </label>
            <label class="switch">
              <input type="checkbox" checked={page.showInNav} onChange={(e) => update('showInNav', e.currentTarget.checked)} />
              위쪽 메뉴에 보이기
            </label>
            <label class="field">
              <span>메뉴 순서 (작을수록 앞)</span>
              <input
                class="input"
                type="number"
                min={0}
                max={100}
                value={page.navOrder}
                onInput={(e) => update('navOrder', Math.max(0, Math.min(100, Math.floor(Number(e.currentTarget.value) || 0))))}
              />
            </label>
          </section>
        </aside>
      </div>
    </>
  );
}
