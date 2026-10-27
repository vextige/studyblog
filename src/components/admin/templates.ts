// 새 글 템플릿. 빈 글에서 고르면 본문 뼈대와 추천 태그가 들어가요.

export type PostTemplate = { key: string; name: string; hint: string; tags: string[]; body: string };

export const POST_TEMPLATES: PostTemplate[] = [
  {
    key: 'journal',
    name: '📒 공부 일지',
    hint: '오늘 배운 것 / 어려웠던 점 / 내일 할 것',
    tags: ['기록'],
    body: `## 오늘 배운 것
-

## 어려웠던 점
-

## 이렇게 해결했어요
-

## 내일 할 것
- [ ]

:::summary 오늘의 한 줄
==여기에 오늘 배운 것 중 가장 중요한 한 줄==
:::
`,
  },
  {
    key: 'concept',
    name: '💡 개념 쉽게 설명',
    hint: '초등학생도 이해하는 설명 형식',
    tags: ['개념'],
    body: `## 한 줄로 말하면
**OOO은 ==△△△== 이에요.**

## 비유로 이해하기
마치 ○○ 같아요.

## 조금 더 정확하게
| 쉬운 말 | 진짜 이름 | 뜻 |
| --- | --- | --- |
|  |  |  |

## 직접 해보기
\`\`\`js

\`\`\`

## 오늘의 정리
-

:::details 스스로 퀴즈 (정답 보기)
Q.
A.
:::
`,
  },
  {
    key: 'note',
    name: '📚 독서·강의 노트',
    hint: '핵심 3줄 / 내 생각 / 써먹을 곳',
    tags: ['독서'],
    body: `> 📚 **자료**: 책·강의 이름 · 지은이 · 오늘 읽은 범위

## 핵심 3줄
1.
2.
3.

## 내 생각
-

## 마음에 남은 문장
>

## 써먹을 곳
- [ ]
`,
  },
  {
    key: 'retro',
    name: '🔁 주간 회고',
    hint: 'Keep / Problem / Try',
    tags: ['회고'],
    body: `## 이번 주에 한 것
-

## 잘한 점 (Keep)
-

## 아쉬운 점 (Problem)
-

## 다음 주에 해 볼 것 (Try)
- [ ]
`,
  },
];
