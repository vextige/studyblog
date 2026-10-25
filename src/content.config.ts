import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { TAGS, TOTAL_DAYS } from './consts';

// src/content/posts 폴더의 .md 파일 하나 = 글 하나.
// 글 맨 위 --- 사이에 적는 정보(제목, 날짜 등)의 형식을 여기서 정해요.
// 형식이 틀리면 미리보기·빌드할 때 어느 글의 어느 칸이 틀렸는지 알려줘요.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    day: z.number().int().min(1).max(TOTAL_DAYS),
    tags: z.array(z.enum(TAGS)).min(1),
    description: z.string().optional(),
  }),
});

export const collections = { posts };
