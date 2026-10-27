// 글쓰기 화면(브라우저)에서 쓰는 도우미: 이미지 올리기, 임시 백업

export type UploadedImage = { id: string; url: string; width: number | null; height: number | null };

/** 이미지 파일을 서버에 올려요. 너무 크면 브라우저에서 먼저 줄여요. */
export async function uploadImage(file: File, alt = ''): Promise<UploadedImage> {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 올릴 수 있어요.');
  let blob: Blob = file;
  let width: number | null = null;
  let height: number | null = null;
  try {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    // 1.9MB가 넘거나 너무 큰 사진은 가로 2000px, WebP로 줄여요. (GIF 움짤은 그대로)
    if ((file.size > 1_800_000 || bitmap.width > 2400) && file.type !== 'image/gif') {
      const scale = Math.min(1, 2000 / bitmap.width);
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
      width = canvas.width;
      height = canvas.height;
    }
    bitmap.close();
  } catch {
    // 크기를 못 읽어도 그대로 올려 봐요.
  }
  const params = new URLSearchParams({ alt });
  if (width) params.set('w', String(width));
  if (height) params.set('h', String(height));
  const res = await fetch(`/api/admin/media?${params}`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'image/png' },
    body: blob,
  });
  const body = (await res.json().catch(() => ({}))) as Partial<UploadedImage> & { error?: string };
  if (!res.ok || !body.url || !body.id) throw new Error(body.error ?? '이미지를 올리지 못했어요.');
  return { id: body.id, url: body.url, width: body.width ?? null, height: body.height ?? null };
}

export type MediaItem = { id: string; url: string; alt: string; width: number | null; height: number | null };

export async function listMediaPage(page: number): Promise<{ items: MediaItem[]; pages: number }> {
  const res = await fetch(`/api/admin/media?page=${page}`);
  if (!res.ok) throw new Error('이미지 목록을 불러오지 못했어요.');
  return (await res.json()) as { items: MediaItem[]; pages: number };
}

/* ───────── 브라우저 임시 백업 (저장 버튼을 누르기 전 내용이 날아가지 않게) ───────── */

export type LocalBackup = { title: string; contentMd: string; at: number };

export function readBackup(key: string): LocalBackup | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as LocalBackup | null;
    return value && typeof value.contentMd === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function writeBackup(key: string, backup: LocalBackup) {
  try {
    localStorage.setItem(key, JSON.stringify(backup));
  } catch {
    // 저장 공간이 꽉 찼거나 막혀 있으면 백업만 건너뛰어요.
  }
}

export function clearBackup(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 무시
  }
}
