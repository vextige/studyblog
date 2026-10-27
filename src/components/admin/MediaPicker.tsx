// 이미지 고르기 창: 올려 둔 이미지 중에서 고르거나, 새로 올려서 바로 골라요.
import { useEffect, useRef, useState } from 'preact/hooks';
import { listMediaPage, uploadImage, type MediaItem } from '../../lib/editor-client';
import { toast } from '../../scripts/toast';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  onPick: (item: { id: string; url: string }) => void;
};

export default function MediaPicker({ open, title, onClose, onPick }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listMediaPage(page)
      .then((res) => {
        setItems(res.items);
        setPages(res.pages);
      })
      .catch((error: unknown) => toast(error instanceof Error ? error.message : '불러오지 못했어요.', 'error'));
  }, [open, page]);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await uploadImage(file, file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60));
      onPick(uploaded);
    } catch (error) {
      toast(error instanceof Error ? error.message : '올리지 못했어요.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog class="picker" ref={dialog} onClose={onClose} aria-label={title}>
      <div class="picker-head">
        <strong>{title}</strong>
        <button class="btn btn-sm btn-ghost" type="button" onClick={onClose}>
          닫기
        </button>
      </div>
      <div class="picker-body">
        <label class="dropzone">
          <span>{busy ? '올리는 중…' : '여기를 눌러 새 이미지 올리기 (PNG · JPG · WebP · GIF, 큰 사진은 자동으로 줄여요)'}</span>
          <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => void upload(e.currentTarget.files)} />
        </label>
        {items.length > 0 ? (
          <div class="picker-grid">
            {items.map((item) => (
              <button type="button" onClick={() => onPick(item)} title={item.alt || '이미지 고르기'}>
                <img src={item.url} alt={item.alt} loading="lazy" />
              </button>
            ))}
          </div>
        ) : (
          <p class="muted small">아직 올린 이미지가 없어요.</p>
        )}
        {pages > 1 && (
          <div class="btn-row">
            <button class="btn btn-sm" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              이전
            </button>
            <span class="mono small muted">
              {page} / {pages}
            </span>
            <button class="btn btn-sm" type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              다음
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
