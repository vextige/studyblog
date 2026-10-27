// 블로그 설정: 이름, 소개 문구, 글쓴이, 지금 공부 중, SNS, 100일 챌린지, 댓글, 검색 엔진
import { actions } from 'astro:actions';
import { useState } from 'preact/hooks';
import type { SiteSettings } from '../../lib/settings-defaults';
import { toast } from '../../scripts/toast';
import MediaPicker from './MediaPicker';

type Props = { initial: SiteSettings; avatarUrl: string | null };

const SOCIALS: { key: keyof SiteSettings['social']; label: string; placeholder: string }[] = [
  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/아이디' },
  { key: 'email', label: '이메일', placeholder: 'me@example.com' },
  { key: 'website', label: '웹사이트', placeholder: 'https://' },
  { key: 'x', label: 'X (트위터)', placeholder: 'https://x.com/아이디' },
  { key: 'instagram', label: '인스타그램', placeholder: 'https://instagram.com/아이디' },
  { key: 'youtube', label: '유튜브', placeholder: 'https://youtube.com/@채널' },
];

export default function SettingsForm({ initial, avatarUrl }: Props) {
  const [s, setS] = useState<SiteSettings>(initial);
  const [avatar, setAvatar] = useState(avatarUrl);
  const [studyDraft, setStudyDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);

  const set = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const setIn = <K extends 'social' | 'challenge' | 'comments' | 'seo'>(group: K, patch: Partial<SiteSettings[K]>) =>
    setS((prev) => ({ ...prev, [group]: { ...prev[group], ...patch } }));

  async function save(event: Event) {
    event.preventDefault();
    setSaving(true);
    const { error } = await actions.admin.saveSettings(s);
    setSaving(false);
    if (error) toast(error.message || '저장하지 못했어요. 빨간 칸을 확인해 주세요.', 'error');
    else toast('설정을 저장했어요');
  }

  function addStudy() {
    const item = studyDraft.trim().slice(0, 60);
    if (!item || s.nowStudying.includes(item) || s.nowStudying.length >= 8) return;
    set('nowStudying', [...s.nowStudying, item]);
    setStudyDraft('');
  }

  return (
    <form onSubmit={save}>
      <div class="panel-grid">
        <section class="panel sheet">
          <div class="panel-head">
            <h2>블로그</h2>
          </div>
          <div class="form-grid">
            <label class="field">
              <span>블로그 이름</span>
              <input class="input" required maxLength={60} value={s.siteTitle} onInput={(e) => set('siteTitle', e.currentTarget.value)} />
            </label>
            <label class="field">
              <span>한 줄 소개</span>
              <input class="input" maxLength={120} value={s.siteTagline} onInput={(e) => set('siteTagline', e.currentTarget.value)} />
            </label>
            <label class="field">
              <span>검색 엔진용 설명</span>
              <textarea class="textarea" maxLength={300} value={s.siteDescription} onInput={(e) => set('siteDescription', e.currentTarget.value)} />
            </label>
            <label class="field">
              <span>홈 화면 큰 문구</span>
              <textarea class="textarea" maxLength={120} value={s.heroTitle} onInput={(e) => set('heroTitle', e.currentTarget.value)} />
              <small>==이렇게== 감싸면 형광펜, 엔터는 줄바꿈이에요.</small>
            </label>
            <label class="field">
              <span>홈 화면 작은 문구</span>
              <textarea class="textarea" maxLength={300} value={s.heroSubtitle} onInput={(e) => set('heroSubtitle', e.currentTarget.value)} />
            </label>
            <label class="field">
              <span>바닥글 한마디</span>
              <input class="input" maxLength={120} value={s.footerNote} onInput={(e) => set('footerNote', e.currentTarget.value)} />
            </label>
          </div>
        </section>

        <section class="panel sheet">
          <div class="panel-head">
            <h2>글쓴이</h2>
            <p>실명·학교·연락처는 넣지 않아도 돼요.</p>
          </div>
          <div class="form-grid">
            <div class="field">
              <span>프로필 사진</span>
              <div class="btn-row">
                {avatar && <img src={avatar} alt="" width={56} height={56} class="avatar-preview" />}
                <button class="btn btn-sm" type="button" onClick={() => setPicker(true)}>
                  {avatar ? '바꾸기' : '고르기'}
                </button>
                {avatar && (
                  <button
                    class="btn btn-sm btn-ghost"
                    type="button"
                    onClick={() => {
                      set('avatarMediaId', null);
                      setAvatar(null);
                    }}
                  >
                    빼기
                  </button>
                )}
              </div>
            </div>
            <label class="field">
              <span>이름 (닉네임)</span>
              <input class="input" required maxLength={40} value={s.authorName} onInput={(e) => set('authorName', e.currentTarget.value)} />
            </label>
            <label class="field">
              <span>짧은 소개</span>
              <textarea class="textarea" maxLength={300} value={s.authorBio} onInput={(e) => set('authorBio', e.currentTarget.value)} />
            </label>
            <div class="field">
              <span>지금 공부 중 (최대 8개)</span>
              <div class="tag-input">
                {s.nowStudying.map((item) => (
                  <span class="tag" data-color="sky">
                    {item}
                    <button
                      type="button"
                      aria-label={`${item} 빼기`}
                      onClick={() =>
                        set(
                          'nowStudying',
                          s.nowStudying.filter((x) => x !== item),
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  value={studyDraft}
                  placeholder="입력 후 Enter"
                  aria-label="공부 중인 것 추가"
                  onInput={(e) => setStudyDraft(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addStudy();
                    }
                  }}
                  onBlur={addStudy}
                />
              </div>
            </div>
            <div class="form-grid cols-2">
              {SOCIALS.map((social) => (
                <label class="field">
                  <span>{social.label}</span>
                  <input
                    class="input"
                    type="text"
                    inputMode={social.key === 'email' ? 'email' : 'url'}
                    maxLength={300}
                    value={s.social[social.key]}
                    placeholder={social.placeholder}
                    onInput={(e) => setIn('social', { [social.key]: e.currentTarget.value.trim() })}
                  />
                </label>
              ))}
            </div>
          </div>
        </section>

        <section class="panel sheet">
          <div class="panel-head">
            <h2>100일 챌린지 · 도장판</h2>
          </div>
          <div class="form-grid">
            <label class="switch">
              <input type="checkbox" checked={s.challenge.enabled} onChange={(e) => setIn('challenge', { enabled: e.currentTarget.checked })} />
              홈 화면에 도장판 보이기
            </label>
            <label class="field">
              <span>챌린지 이름</span>
              <input class="input" maxLength={60} value={s.challenge.title} onInput={(e) => setIn('challenge', { title: e.currentTarget.value })} />
            </label>
            <div class="form-grid cols-2">
              <label class="field">
                <span>시작한 날 (DAY 1)</span>
                <input class="input" type="date" required value={s.challenge.startDate} onInput={(e) => setIn('challenge', { startDate: e.currentTarget.value })} />
              </label>
              <label class="field">
                <span>목표 일수</span>
                <input
                  class="input"
                  type="number"
                  min={7}
                  max={1000}
                  value={s.challenge.totalDays}
                  onInput={(e) => setIn('challenge', { totalDays: Math.max(7, Math.min(1000, Math.floor(Number(e.currentTarget.value) || 100))) })}
                />
              </label>
            </div>
          </div>
        </section>

        <section class="panel sheet">
          <div class="panel-head">
            <h2>댓글 · 검색 엔진</h2>
          </div>
          <div class="form-grid">
            <label class="switch">
              <input type="checkbox" checked={s.comments.enabled} onChange={(e) => setIn('comments', { enabled: e.currentTarget.checked })} />
              댓글 받기
            </label>
            <label class="field">
              <span>새 댓글은</span>
              <select
                class="select"
                value={s.comments.moderation}
                onChange={(e) => setIn('comments', { moderation: e.currentTarget.value as 'manual' | 'auto' })}
              >
                <option value="manual">내가 승인한 뒤 공개 (추천)</option>
                <option value="auto">바로 공개</option>
              </select>
            </label>
            <label class="switch">
              <input type="checkbox" checked={s.seo.blockAiCrawlers} onChange={(e) => setIn('seo', { blockAiCrawlers: e.currentTarget.checked })} />
              AI 학습용 수집 봇 막기 (robots.txt)
            </label>
          </div>
        </section>
      </div>

      <div class="form-actions settings-save">
        <button class="btn btn-primary" type="submit" disabled={saving}>
          {saving ? '저장하는 중…' : '설정 저장'}
        </button>
      </div>

      <MediaPicker
        open={picker}
        title="프로필 사진 고르기"
        onClose={() => setPicker(false)}
        onPick={(item) => {
          set('avatarMediaId', item.id);
          setAvatar(item.url);
          setPicker(false);
        }}
      />
    </form>
  );
}
