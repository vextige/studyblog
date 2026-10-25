// @ts-check
import { defineConfig } from 'astro/config';

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  // GitHub Pages 주소: https://vextige.github.io/studyblog/
  // 저장소 이름을 바꾸면 base도 같이 바꿔야 해요.
  site: 'https://vextige.github.io',
  base: '/studyblog',
  markdown: {
    // 글 속 코드 블록 색상: 밝은 화면 / 어두운 화면용 테마를 따로 지정
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
