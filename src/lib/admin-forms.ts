/**
 * 관리자 화면의 <form> 처리 도우미
 *
 * 버튼을 누르면 → 서버 기능(Action)이 실행되고 → 같은 화면으로 다시 이동(redirect)해요.
 * 이렇게 하면 새로고침해도 같은 요청이 두 번 보내지지 않아요. (POST → Redirect → GET)
 * 결과 메시지는 30초짜리 쿠키(flash)에 잠깐 담아 두었다가 다음 화면에서 한 번만 보여 줘요.
 */
import type { AstroCookies, AstroGlobal } from 'astro';
import { isInputError, type ActionError } from 'astro:actions';
import { isHttps } from './runtime';

export type Flash = { tone: 'ok' | 'error'; message: string };

const FLASH_COOKIE = 'sb_flash';

export function setFlash(cookies: AstroCookies, url: URL, flash: Flash) {
  cookies.set(FLASH_COOKIE, JSON.stringify(flash), {
    path: '/admin',
    httpOnly: true,
    secure: isHttps(url),
    sameSite: 'lax',
    maxAge: 30,
  });
}

export function takeFlash(cookies: AstroCookies): Flash | null {
  const raw = cookies.get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  cookies.delete(FLASH_COOKIE, { path: '/admin' });
  try {
    const value = JSON.parse(raw) as Partial<Flash>;
    if ((value.tone === 'ok' || value.tone === 'error') && typeof value.message === 'string') {
      return { tone: value.tone, message: value.message.slice(0, 300) };
    }
  } catch {
    // 망가진 쿠키는 무시해요.
  }
  return null;
}

/** 사람이 읽을 수 있는 오류 문장 (입력 검사 오류면 첫 번째 칸의 메시지) */
export function actionErrorMessage(error: ActionError | undefined): string {
  if (!error) return '';
  if (isInputError(error)) {
    const first = Object.values(error.fields).flat()[0];
    if (typeof first === 'string' && first) return first;
    return '입력한 내용을 다시 확인해 주세요.';
  }
  return error.message || '처리하지 못했어요. 다시 시도해 주세요.';
}

/** 지금 주소(필터·페이지 번호)를 그대로 두고 `_action`만 붙인 form action 주소 */
export function formAction(url: URL, action: { toString(): string }): string {
  const params = new URLSearchParams(url.search);
  params.delete('_action');
  for (const [key, value] of new URLSearchParams(String(action))) params.set(key, value);
  return `${url.pathname}?${params}`;
}

type FormActionEntry = readonly [action: Parameters<AstroGlobal['getActionResult']>[0], okMessage: string];

/**
 * 이 화면에서 쓰는 form action들의 결과를 확인해요.
 * - 성공: 메시지를 담고 같은 화면으로 redirect (Response를 돌려줘요)
 * - 실패: 오류 메시지를 담은 Flash를 돌려줘요 (화면에 바로 보여 주기)
 * - 아무 action도 없었으면: 이전 화면이 남긴 메시지(있으면)
 */
export function handleFormActions(Astro: AstroGlobal, entries: readonly FormActionEntry[]): Response | Flash | null {
  for (const [action, okMessage] of entries) {
    const result = Astro.getActionResult(action);
    if (!result) continue;
    if (result.error) return { tone: 'error', message: actionErrorMessage(result.error) };
    setFlash(Astro.cookies, Astro.url, { tone: 'ok', message: okMessage });
    const next = new URL(Astro.url);
    next.searchParams.delete('_action');
    return Astro.redirect(`${next.pathname}${next.search}`, 303);
  }
  return takeFlash(Astro.cookies);
}
