// 목표 관리: 목표 카드를 만들고, 고치고, 단계를 쪼개고, 지워요.
import { actions } from 'astro:actions';
import { useState } from 'preact/hooks';
import { toast } from '../../scripts/toast';

type Term = 'long' | 'month' | 'week';
type Status = 'active' | 'done' | 'paused';
type Color = 'lime' | 'pink' | 'sky' | 'orange' | 'violet' | 'mint' | 'yellow';

export type GoalRow = {
  id: number;
  title: string;
  note: string;
  term: Term;
  status: Status;
  color: Color;
  dueDate: string | null;
  steps: { text: string; done: boolean }[];
  progress: number;
  percent: number;
};

type Draft = Omit<GoalRow, 'id' | 'percent'> & { id?: number };

const TERMS: { key: Term; label: string }[] = [
  { key: 'week', label: '이번 주' },
  { key: 'month', label: '이번 달' },
  { key: 'long', label: '장기 목표' },
];
const STATUSES: { key: Status; label: string }[] = [
  { key: 'active', label: '진행 중' },
  { key: 'paused', label: '잠시 멈춤' },
  { key: 'done', label: '달성' },
];
const COLORS: Color[] = ['lime', 'yellow', 'pink', 'sky', 'orange', 'violet', 'mint'];

const empty = (term: Term): Draft => ({
  title: '',
  note: '',
  term,
  status: 'active',
  color: 'lime',
  dueDate: null,
  steps: [],
  progress: 0,
});

export default function GoalManager({ goals }: { goals: GoalRow[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function save(event: Event) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    const { error } = await actions.admin.saveGoal({
      ...draft,
      steps: draft.steps.filter((s) => s.text.trim()),
    });
    setSaving(false);
    if (error) {
      toast(error.message || '저장하지 못했어요.', 'error');
      return;
    }
    toast('목표를 저장했어요');
    location.reload();
  }

  async function remove(goal: GoalRow) {
    if (!confirm(`"${goal.title}" 목표를 지울까요? 되돌릴 수 없어요.`)) return;
    const form = new FormData();
    form.set('id', String(goal.id));
    const { error } = await actions.admin.deleteGoal(form);
    if (error) toast(error.message, 'error');
    else location.reload();
  }

  return (
    <>
      <div class="panel-grid">
        {TERMS.map((term) => {
          const list = goals.filter((g) => g.term === term.key);
          return (
            <section class="panel sheet">
              <div class="panel-head">
                <h2>
                  {term.label} <span class="mono small muted">{list.length}</span>
                </h2>
                <button class="btn btn-sm" type="button" onClick={() => setDraft(empty(term.key))}>
                  + 목표 추가
                </button>
              </div>
              {list.length === 0 ? (
                <p class="muted small">아직 목표가 없어요.</p>
              ) : (
                <ul class="admin-list">
                  {list.map((g) => (
                    <li class="admin-row">
                      <div>
                        <div class="admin-row-title">
                          <span class="pill" data-tone={g.status === 'done' ? 'published' : g.status === 'paused' ? undefined : 'scheduled'}>
                            {STATUSES.find((s) => s.key === g.status)?.label}
                          </span>
                          <span class="hl" data-color={g.color}>
                            {g.title}
                          </span>
                        </div>
                        <div class="admin-row-meta">
                          <span>진행 {g.percent}%</span>
                          {g.steps.length > 0 && (
                            <span>
                              단계 {g.steps.filter((s) => s.done).length}/{g.steps.length}
                            </span>
                          )}
                          {g.dueDate && <span>마감 {g.dueDate}</span>}
                        </div>
                      </div>
                      <div class="row-actions">
                        <button
                          class="btn btn-sm"
                          type="button"
                          onClick={() => setDraft({ ...g, steps: g.steps.map((s) => ({ ...s })) })}
                        >
                          고치기
                        </button>
                        <button class="btn btn-sm btn-danger" type="button" onClick={() => void remove(g)}>
                          지우기
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {draft && (
        <section class="panel sheet" style={{ marginTop: '18px' }} id="goal-form">
          <div class="panel-head">
            <h2>{draft.id ? '목표 고치기' : '새 목표'}</h2>
            <button class="btn btn-sm btn-ghost" type="button" onClick={() => setDraft(null)}>
              닫기
            </button>
          </div>
          <form class="form-grid" onSubmit={save}>
            <label class="field">
              <span>목표</span>
              <input
                class="input"
                required
                maxLength={80}
                value={draft.title}
                placeholder="예) 정보처리기능사 필기 합격"
                autoFocus={!draft.id}
                onInput={(e) => set('title', e.currentTarget.value)}
              />
            </label>
            <label class="field">
              <span>메모 (왜, 어떻게)</span>
              <textarea
                class="textarea"
                maxLength={500}
                value={draft.note}
                placeholder="예) 하루 기출 20문제씩, 주말엔 오답 정리"
                onInput={(e) => set('note', e.currentTarget.value)}
              />
            </label>
            <div class="form-grid cols-2">
              <label class="field">
                <span>기간</span>
                <select class="select" value={draft.term} onChange={(e) => set('term', e.currentTarget.value as Term)}>
                  {TERMS.map((t) => (
                    <option value={t.key}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>상태</span>
                <select class="select" value={draft.status} onChange={(e) => set('status', e.currentTarget.value as Status)}>
                  {STATUSES.map((s) => (
                    <option value={s.key}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>마감일 (선택)</span>
                <input
                  class="input"
                  type="date"
                  value={draft.dueDate ?? ''}
                  onInput={(e) => set('dueDate', e.currentTarget.value || null)}
                />
              </label>
              <div class="field">
                <span>형광펜 색</span>
                <div class="color-picks" role="radiogroup" aria-label="형광펜 색">
                  {COLORS.map((c) => (
                    <label data-color={c}>
                      <input type="radio" name="goal-color" checked={draft.color === c} onChange={() => set('color', c)} />
                      <span />
                      <b class="sr-only">{c}</b>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div class="field">
              <span>단계 (잘게 쪼개면 체크할 때마다 진행률이 올라가요)</span>
              <div class="goal-edit-steps">
                {draft.steps.map((step, i) => (
                  <div class="goal-edit-step">
                    <input
                      type="checkbox"
                      checked={step.done}
                      aria-label="끝냄"
                      onChange={(e) => {
                        const steps = [...draft.steps];
                        steps[i] = { ...step, done: e.currentTarget.checked };
                        set('steps', steps);
                      }}
                    />
                    <input
                      class="input"
                      maxLength={120}
                      value={step.text}
                      placeholder={`${i + 1}단계`}
                      onInput={(e) => {
                        const steps = [...draft.steps];
                        steps[i] = { ...step, text: e.currentTarget.value };
                        set('steps', steps);
                      }}
                    />
                    <button
                      class="btn btn-sm btn-ghost"
                      type="button"
                      aria-label="이 단계 빼기"
                      onClick={() =>
                        set(
                          'steps',
                          draft.steps.filter((_, j) => j !== i),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {draft.steps.length < 20 && (
                <div>
                  <button class="btn btn-sm" type="button" onClick={() => set('steps', [...draft.steps, { text: '', done: false }])}>
                    + 단계 추가
                  </button>
                </div>
              )}
            </div>

            {draft.steps.length === 0 && (
              <label class="field">
                <span>진행률 (단계가 없을 때 직접 정해요)</span>
                <div class="range-row">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={draft.progress}
                    onInput={(e) => set('progress', Number(e.currentTarget.value))}
                  />
                  <span class="mono">{draft.progress}%</span>
                </div>
              </label>
            )}

            <div class="form-actions">
              <button class="btn btn-primary" type="submit" disabled={saving}>
                {saving ? '저장하는 중…' : '저장'}
              </button>
              <button class="btn btn-ghost" type="button" onClick={() => setDraft(null)}>
                취소
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
