// 패스키로 로그인 · 처음 설정(패스키 등록). 비밀번호 대신 지문·얼굴·Windows Hello를 써요.
import { actions } from 'astro:actions';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

const status = document.querySelector<HTMLElement>('[data-auth-status]');

function show(message: string, tone: 'ok' | 'error' = 'error') {
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
  status.className = `notice notice-${tone}`;
}

/** 패스키 창을 닫았을 때처럼 흔한 오류는 쉬운 말로 바꿔요. */
function friendly(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return '패스키 확인이 취소됐거나 시간이 지났어요. 다시 눌러 주세요.';
  if (name === 'InvalidStateError') return '이 기기에는 이미 패스키가 등록돼 있어요.';
  if (name === 'SecurityError') return '이 주소에서는 패스키를 쓸 수 없어요. (https 또는 localhost에서만 돼요)';
  return error instanceof Error ? error.message : '알 수 없는 오류가 났어요.';
}

/** 로그인 뒤 돌아갈 곳. 관리자 화면 안쪽 주소만 허락해요. (다른 사이트로 보내는 장난 방지) */
function nextPath(): string {
  const next = new URLSearchParams(location.search).get('next') ?? '';
  return next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
}

if (!browserSupportsWebAuthn()) {
  show('이 브라우저는 패스키를 지원하지 않아요. 최신 Chrome, Edge, Safari, 삼성 인터넷을 써 주세요.');
}

const loginButton = document.querySelector<HTMLButtonElement>('[data-login]');
loginButton?.addEventListener('click', async () => {
  loginButton.disabled = true;
  try {
    const options = await actions.auth.loginOptions();
    if (options.error) throw new Error(options.error.message);
    const response = await startAuthentication({ optionsJSON: options.data });
    const verified = await actions.auth.loginVerify({ response: response as never });
    if (verified.error) throw new Error(verified.error.message);
    show('로그인했어요! 책상으로 이동할게요.', 'ok');
    location.assign(nextPath());
  } catch (error) {
    show(friendly(error));
    loginButton.disabled = false;
  }
});

const setupForm = document.querySelector<HTMLFormElement>('[data-setup]');
setupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = setupForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) button.disabled = true;
  const data = new FormData(setupForm);
  const setupToken = String(data.get('setupToken') ?? '').trim() || undefined;
  const name = String(data.get('name') ?? '').trim();
  try {
    const options = await actions.auth.registerOptions({ setupToken, name });
    if (options.error) throw new Error(options.error.message);
    const response = await startRegistration({ optionsJSON: options.data });
    const verified = await actions.auth.registerVerify({ response: response as never, name, setupToken });
    if (verified.error) throw new Error(verified.error.message);
    show('패스키를 등록했어요! 이제 지문·얼굴로 로그인할 수 있어요.', 'ok');
    location.assign(setupForm.dataset.done ?? '/admin');
  } catch (error) {
    show(friendly(error));
    if (button) button.disabled = false;
  }
});
