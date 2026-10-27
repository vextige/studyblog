// 화면 아래에 잠깐 떴다 사라지는 알림. 예) toast('링크를 복사했어요')

export function toast(message: string, tone: 'ok' | 'error' = 'ok') {
  let stack = document.querySelector<HTMLElement>('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const item = document.createElement('div');
  item.className = 'toast';
  item.dataset.tone = tone;
  item.textContent = message;
  stack.appendChild(item);
  setTimeout(() => item.remove(), tone === 'error' ? 5000 : 2600);
}
