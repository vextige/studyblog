// 목표 보드에서 단계를 누르면 바로 체크하고 저장해요. (관리자만)
import { actions } from 'astro:actions';
import { toast } from './toast';

const STATUS_LABELS: Record<string, string> = { active: '진행 중', done: '달성', paused: '잠시 멈춤' };

document.addEventListener('click', async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-goal-step]');
  const card = button?.closest<HTMLElement>('[data-goal-id]');
  if (!button || !card || button.disabled) return;
  button.disabled = true;
  const { data, error } = await actions.admin.toggleGoalStep({
    id: Number(card.dataset.goalId),
    index: Number(button.dataset.goalStep),
  });
  button.disabled = false;
  if (error) {
    toast(error.message || '저장하지 못했어요.', 'error');
    return;
  }
  const done = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(done));
  button.closest('li')?.classList.toggle('is-done', done);
  card.querySelector<HTMLElement>('.goal-meter')?.style.setProperty('--p', `${data.percent}%`);
  const pct = card.querySelector('[data-goal-pct]');
  if (pct) pct.textContent = `${data.percent}%`;
  const status = card.querySelector('[data-goal-status]');
  if (status) status.textContent = STATUS_LABELS[data.status] ?? '';
  if (card.dataset.status !== data.status) {
    card.dataset.status = data.status;
    if (data.status === 'done') {
      toast('목표 달성! 참 잘했어요 🎉');
      setTimeout(() => location.reload(), 900);
    }
  }
});
