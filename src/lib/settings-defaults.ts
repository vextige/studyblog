// 블로그 설정의 기본값. 관리자 화면 → 설정에서 모두 바꿀 수 있어요.

export type SocialLinks = {
  github: string;
  email: string;
  x: string;
  instagram: string;
  youtube: string;
  website: string;
};

export type SiteSettings = {
  siteTitle: string;
  siteTagline: string;
  siteDescription: string;
  /** 홈 화면 큰 문구. ==형광펜== 과 줄바꿈을 쓸 수 있어요. */
  heroTitle: string;
  heroSubtitle: string;
  authorName: string;
  authorBio: string;
  avatarMediaId: string | null;
  nowStudying: string[];
  social: SocialLinks;
  challenge: { enabled: boolean; title: string; startDate: string; totalDays: number };
  comments: { enabled: boolean; moderation: 'manual' | 'auto' };
  seo: { blockAiCrawlers: boolean };
  footerNote: string;
};

export const DEFAULT_SETTINGS: SiteSettings = {
  siteTitle: '100일 공부 기록',
  siteTagline: '하루 한 칸씩 채우는 공부 노트',
  siteDescription: '하루 1시간, 100일 동안 공부한 내용을 차곡차곡 쌓아 가는 블로그',
  heroTitle: '하루 한 칸,\n오늘도 ==밑줄== 긋는 중.',
  heroSubtitle: '하루 1시간 공부하고, 배운 것을 글 하나로 남겨요. 잘 쓰는 것보다 매일 쓰는 게 목표예요.',
  authorName: '공부하는 사람',
  authorBio: '하루 1시간씩 꾸준히 공부하고 기록하는 중이에요.',
  avatarMediaId: null,
  nowStudying: ['웹 개발 기초', 'Git과 GitHub', 'AI 활용'],
  social: { github: '', email: '', x: '', instagram: '', youtube: '', website: '' },
  challenge: { enabled: true, title: '100일 공부 챌린지', startDate: '2026-10-23', totalDays: 100 },
  comments: { enabled: true, moderation: 'manual' },
  seo: { blockAiCrawlers: false },
  footerNote: '오늘도 한 칸 ✍️',
};
