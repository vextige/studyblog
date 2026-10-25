// 사이트 전체에서 쓰는 설정값을 모아둔 파일이에요.

// ✏️ 직접 수정: 블로그 이름과 한 줄 소개
export const SITE_TITLE = '100일 공부 기록';
export const SITE_DESCRIPTION = '하루 1시간, 100일 동안 공부한 내용을 쌓아가는 블로그';

export const TOTAL_DAYS = 100;

// 글에 붙일 수 있는 태그. 여기 없는 태그를 쓰면 빌드할 때 오류로 알려줘요.
export const TAGS = ['기록', '개념', '독서'] as const;
export type Tag = (typeof TAGS)[number];

export const TAG_DESCRIPTIONS: Record<Tag, string> = {
  기록: '그날 공부한 내용을 남기는 일지',
  개념: '배운 개념을 초등학생도 이해하게 풀어 쓴 글',
  독서: '책·강의를 보고 핵심만 정리한 노트',
};
