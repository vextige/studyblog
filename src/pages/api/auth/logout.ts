import type { APIRoute } from 'astro';
import { destroyCurrentSession } from '../../../lib/auth/session';
import { audit } from '../../../lib/security';

// 로그아웃은 POST로만 받아요. (링크 하나로 몰래 로그아웃시키는 장난 방지)
export const POST: APIRoute = async (context) => {
  if (context.locals.user) await audit(context, 'logout');
  await destroyCurrentSession(context);
  return context.redirect('/', 303);
};
