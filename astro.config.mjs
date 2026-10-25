// @ts-check
import { defineConfig } from 'astro/config';

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  markdown: {
    // 글 속 코드 블록 색상: 밝은 화면 / 어두운 화면용 테마를 따로 지정
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
