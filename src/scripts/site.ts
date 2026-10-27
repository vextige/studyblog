// 모든 방문자 화면에서 쓰는 작은 기능: 밝은/어두운 화면 바꾸기

const root = document.documentElement;
const THEME_COLORS = { light: '#f4f2ea', dark: '#111114' } as const;

function currentTheme(): 'light' | 'dark' {
  const chosen = root.dataset.theme;
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(next: 'light' | 'dark') {
  root.dataset.theme = next;
  try {
    localStorage.setItem('theme', next);
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 이번 화면에서만 바뀌어요.
  }
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', THEME_COLORS[next]);
}

document.addEventListener('click', (event) => {
  if (!(event.target as Element | null)?.closest('[data-theme-toggle]')) return;
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce) document.startViewTransition(() => applyTheme(next));
  else applyTheme(next);
});
