// 검색용 파일(search.json)을 빌드할 때 만들어요.
// 모든 글의 제목·요약·태그·본문을 모아 두면, 글 목록 페이지의 검색창이 이 파일 하나만 읽어서 찾아요.
import type { APIRoute } from 'astro';
import { getPosts } from '../lib/blog';

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const index = posts.map((post) => ({
    id: post.id,
    text: [post.data.title, post.data.description, post.data.tags.join(' '), post.body]
      .filter(Boolean)
      .join('\n')
      .toLowerCase(),
  }));
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
