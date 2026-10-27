/**
 * 마크다운 편집기 (CodeMirror 6) + 도구 막대 + 미리보기
 * - 이미지를 붙여 넣거나(Ctrl+V) 끌어다 놓으면 바로 올라가고 ![](주소)가 들어가요.
 * - Ctrl+S: 저장, Ctrl+B: 굵게, Ctrl+Shift+H: 형광펜
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { actions } from 'astro:actions';
import { useEffect, useRef, useState } from 'preact/hooks';
import { uploadImage } from '../../lib/editor-client';
import { toast } from '../../scripts/toast';

type ViewMode = 'write' | 'split' | 'preview';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  placeholder?: string;
  /** 바깥에서 글 내용을 통째로 바꿀 때(템플릿, 옛 버전 되돌리기) 숫자를 올려 주세요. */
  resetKey?: number;
};

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '800', fontSize: '1.35em' },
  { tag: t.heading2, fontWeight: '800', fontSize: '1.2em' },
  { tag: t.heading3, fontWeight: '750', fontSize: '1.08em' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.strong, fontWeight: '750' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--pen)' },
  { tag: t.monospace, color: 'var(--stamp)' },
  { tag: t.quote, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--ink-3)' },
  { tag: t.list, color: 'var(--ink)' },
  { tag: [t.keyword, t.operator], color: 'var(--pen)' },
  { tag: [t.string, t.special(t.string)], color: 'light-dark(#1f7a3d, #8fe0a8)' },
  { tag: t.comment, color: 'var(--ink-3)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.atom], color: 'light-dark(#b2560b, #ffb366)' },
]);

/* ───────── 선택한 글자에 서식 입히기 ───────── */

function wrap(view: EditorView, before: string, after = before, fallback = '') {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to) || fallback;
      const insert = `${before}${text}${after}`;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + before.length, range.from + before.length + text.length),
      };
    }),
  );
  view.focus();
}

/** 선택한 줄들 맨 앞에 붙이기 (이미 붙어 있으면 떼기) */
function prefixLines(view: EditorView, prefix: string) {
  const { state } = view;
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      lines.add(line.number);
      pos = line.to + 1;
    }
  }
  const all = [...lines].map((n) => state.doc.line(n));
  const remove = all.every((line) => line.text.startsWith(prefix));
  view.dispatch({
    changes: all.map((line) =>
      remove ? { from: line.from, to: line.from + prefix.length, insert: '' } : { from: line.from, insert: prefix },
    ),
  });
  view.focus();
}

/** 커서 자리에 블록(여러 줄) 넣기. 앞뒤로 빈 줄을 맞춰 줘요. */
function insertBlock(view: EditorView, block: string, cursorOffset?: number) {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const needsBreakBefore = line.text.trim().length > 0;
  const insert = `${needsBreakBefore ? '\n\n' : ''}${block}\n`;
  const at = needsBreakBefore ? line.to : line.from;
  view.dispatch({
    changes: { from: at, to: needsBreakBefore ? at : range.to, insert },
    selection: { anchor: at + (needsBreakBefore ? 2 : 0) + (cursorOffset ?? block.length) },
    scrollIntoView: true,
  });
  view.focus();
}

export default function MarkdownEditor({ value, onChange, onSave, placeholder = '', resetKey = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const [mode, setMode] = useState<ViewMode>('write');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: File[]) {
    const view = viewRef.current;
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!view || images.length === 0) return false;
    for (const file of images) {
      setUploading((n) => n + 1);
      try {
        const alt = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60);
        const uploaded = await uploadImage(file, alt);
        insertBlock(view, `![${alt}](${uploaded.url})`);
      } catch (error) {
        toast(error instanceof Error ? error.message : '이미지를 올리지 못했어요.', 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }
    return true;
  }
  const handleFilesRef = useRef(handleFiles);
  handleFilesRef.current = handleFiles;

  // 편집기 만들기 (처음 한 번, 그리고 내용을 통째로 바꿀 때)
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(highlight),
          highlightSelectionMatches(),
          placeholderExt(placeholder),
          EditorView.contentAttributes.of({ 'aria-label': '본문 (마크다운)', spellcheck: 'false', autocapitalize: 'off' }),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (onSaveRef.current(), true) },
            { key: 'Mod-b', run: (v) => (wrap(v, '**', '**', '굵게'), true) },
            { key: 'Mod-Shift-h', run: (v) => (wrap(v, '==', '==', '형광펜'), true) },
            { key: 'Mod-k', run: (v) => (wrap(v, '[', '](https://)', '링크 글자'), true) },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            paste: (event) => {
              const files = [...(event.clipboardData?.files ?? [])];
              if (files.some((f) => f.type.startsWith('image/'))) {
                event.preventDefault();
                void handleFilesRef.current(files);
                return true;
              }
              return false;
            },
            drop: (event) => {
              const files = [...(event.dataTransfer?.files ?? [])];
              setDragOver(false);
              if (files.some((f) => f.type.startsWith('image/'))) {
                event.preventDefault();
                void handleFilesRef.current(files);
                return true;
              }
              return false;
            },
            dragover: (event) => {
              if (event.dataTransfer?.types.includes('Files')) setDragOver(true);
              return false;
            },
            dragleave: () => (setDragOver(false), false),
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // value는 처음 값만 쓰고, 이후엔 편집기가 직접 관리해요.
  }, [resetKey]);

  // 미리보기: 실제 발행될 HTML을 서버에서 만들어 와요. (입력을 멈추고 0.4초 뒤)
  useEffect(() => {
    if (mode === 'write') return;
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      const { data, error } = await actions.admin.previewMarkdown({ contentMd: value });
      if (cancelled) return;
      setPreviewLoading(false);
      if (error) toast(error.message || '미리보기를 만들지 못했어요.', 'error');
      else setPreviewHtml(data.html);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, mode]);

  const run = (fn: (v: EditorView) => void) => () => {
    const view = viewRef.current;
    if (view) fn(view);
  };

  const tools: { label: string; icon: string; action: () => void; title?: string }[][] = [
    [
      { label: '소제목', icon: 'H2', action: run((v) => prefixLines(v, '## ')) },
      { label: '작은 제목', icon: 'H3', action: run((v) => prefixLines(v, '### ')) },
      { label: '굵게 (Ctrl+B)', icon: 'B', action: run((v) => wrap(v, '**', '**', '굵게')) },
      { label: '형광펜 (Ctrl+Shift+H)', icon: '🖍', action: run((v) => wrap(v, '==', '==', '형광펜')) },
      { label: '코드', icon: '</>', action: run((v) => wrap(v, '`', '`', 'code')) },
      { label: '링크 (Ctrl+K)', icon: '🔗', action: run((v) => wrap(v, '[', '](https://)', '링크 글자')) },
    ],
    [
      { label: '글머리 목록', icon: '•', action: run((v) => prefixLines(v, '- ')) },
      { label: '체크리스트', icon: '☑', action: run((v) => prefixLines(v, '- [ ] ')) },
      { label: '인용', icon: '❝', action: run((v) => prefixLines(v, '> ')) },
      { label: '코드 블록', icon: '{ }', action: run((v) => insertBlock(v, '```js\n\n```', 6)) },
      { label: '팁 상자', icon: '💡', action: run((v) => insertBlock(v, ':::tip 팁\n\n:::', 9)) },
      { label: '정답 숨기기 (접기)', icon: '▸', action: run((v) => insertBlock(v, ':::details 정답 보기\n\n:::', 16)) },
      { label: '표', icon: '▦', action: run((v) => insertBlock(v, '| 항목 | 내용 |\n| --- | --- |\n|  |  |', 31)) },
      { label: '구분선', icon: '—', action: run((v) => insertBlock(v, '---')) },
    ],
  ];

  return (
    <div>
      <div class="editor-toolbar" role="toolbar" aria-label="서식 도구">
        {tools.map((group, i) => (
          <>
            {i > 0 && <span class="sep" aria-hidden="true" />}
            {group.map((tool) => (
              <button class="icon-btn" type="button" title={tool.label} aria-label={tool.label} onClick={tool.action}>
                <span class="tool-glyph" aria-hidden="true">
                  {tool.icon}
                </span>
              </button>
            ))}
          </>
        ))}
        <span class="sep" aria-hidden="true" />
        <button class="btn btn-sm btn-ghost" type="button" onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? '올리는 중…' : '🖼 이미지'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          multiple
          hidden
          onChange={(e) => {
            const input = e.currentTarget;
            void handleFiles([...(input.files ?? [])]).then(() => (input.value = ''));
          }}
        />
        <span class="grow" />
        <span class="seg" role="group" aria-label="보기 방식">
          {(
            [
              ['write', '쓰기'],
              ['split', '나란히'],
              ['preview', '미리보기'],
            ] as const
          ).map(([key, label]) => (
            <button type="button" aria-pressed={mode === key ? 'true' : 'false'} onClick={() => setMode(key)}>
              {label}
            </button>
          ))}
        </span>
      </div>

      <div class={`editor-panes${mode === 'split' ? ' is-split' : ''}`}>
        <div class="cm-host" ref={host} hidden={mode === 'preview'} />
        {mode !== 'write' && (
          <div
            class={`editor-preview prose${previewLoading ? ' is-loading' : ''}`}
            aria-live="polite"
            dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="muted">미리보기를 만드는 중…</p>' }}
          />
        )}
        {dragOver && <div class="drop-hint">여기에 놓으면 이미지가 올라가요</div>}
      </div>
    </div>
  );
}
