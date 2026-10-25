import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

// 모든 글을 Day 번호가 큰 순서(최근 글 먼저)로 가져와요.
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('posts');
  return posts.sort(
    (a, b) => b.data.day - a.data.day || b.data.date.valueOf() - a.data.date.valueOf(),
  );
}

// GitHub Pages에서는 사이트가 /저장소이름/ 아래에 올라가요.
// 링크를 만들 때 항상 이 함수를 써야 주소가 깨지지 않아요. 예) url('posts/') → /저장소이름/posts/
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export function url(path = ''): string {
  return `${BASE}/${path.replace(/^\//, '')}`;
}

// 2026-10-25 → 2026.10.25
export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}
