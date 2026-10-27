// 관리자 화면 공통: 위험한 버튼은 한 번 더 묻기, 고르면 바로 적용되는 선택 칸

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  const submitter = (event as SubmitEvent).submitter as HTMLElement | null;
  const message = submitter?.dataset.confirm ?? form.dataset.confirm;
  if (message && !confirm(message)) event.preventDefault();
});

document.addEventListener('change', (event) => {
  const el = event.target as HTMLElement;
  if (el.matches('[data-autosubmit]')) (el.closest('form') as HTMLFormElement | null)?.requestSubmit();
});
