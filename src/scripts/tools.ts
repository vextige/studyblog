// 공부 도구: 뽀모도로 타이머 + 학점 계산기 (내 브라우저에만 저장)

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장이 막힌 브라우저에서는 이번 화면에서만 기억해요.
  }
}

const todayKey = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/* ───────── 공부 타이머 ───────── */

const timer = document.querySelector<HTMLElement>('[data-timer]');
if (timer) {
  const clock = timer.querySelector<HTMLElement>('[data-clock]')!;
  const phase = timer.querySelector<HTMLElement>('[data-phase]')!;
  const progress = timer.querySelector<HTMLElement>('[data-progress]')!;
  const startButton = timer.querySelector<HTMLButtonElement>('[data-start]')!;
  const stamps = timer.querySelector<HTMLElement>('[data-stamps]')!;
  const total = timer.querySelector<HTMLElement>('[data-total]')!;
  const baseTitle = document.title;

  let focusMin = 25;
  let breakMin = 5;
  let mode: 'focus' | 'break' = 'focus';
  let remaining = focusMin * 60;
  let endsAt: number | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined;

  type Log = { day: string; sessions: number[] };
  let log = load<Log>('study-timer', { day: todayKey(), sessions: [] });
  if (log.day !== todayKey()) log = { day: todayKey(), sessions: [] };

  const fmt = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

  function renderLog() {
    stamps.replaceChildren();
    for (let i = 0; i < log.sessions.length; i++) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#stamp-mini');
      svg.appendChild(use);
      stamps.appendChild(svg);
    }
    const minutes = log.sessions.reduce((a, b) => a + b, 0);
    const h = Math.floor(minutes / 60);
    total.textContent = h ? `${h}시간 ${minutes % 60}분` : `${minutes}분`;
  }

  function render() {
    const length = (mode === 'focus' ? focusMin : breakMin) * 60;
    clock.textContent = fmt(remaining);
    progress.style.width = `${((length - remaining) / length) * 100}%`;
    phase.textContent = mode === 'focus' ? '집중 시간' : '쉬는 시간';
    timer!.dataset.mode = mode;
    startButton.textContent = endsAt ? '잠깐 멈춤' : remaining < length ? '이어서' : '시작';
    document.title = endsAt ? `${fmt(remaining)} · ${mode === 'focus' ? '집중' : '휴식'}` : baseTitle;
  }

  /** 끝났을 때 '띵' (소리 파일 없이 브라우저가 직접 만들어요) */
  function ding() {
    try {
      const audio = new AudioContext();
      for (const [i, freq] of [880, 1320].entries()) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + i * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.18 + 0.6);
        osc.connect(gain).connect(audio.destination);
        osc.start(audio.currentTime + i * 0.18);
        osc.stop(audio.currentTime + i * 0.18 + 0.65);
      }
    } catch {
      // 소리를 못 내도 괜찮아요.
    }
  }

  function stop() {
    clearInterval(ticker);
    endsAt = null;
  }

  function tick() {
    if (!endsAt) return;
    remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    if (remaining === 0) {
      stop();
      ding();
      if (mode === 'focus') {
        if (log.day !== todayKey()) log = { day: todayKey(), sessions: [] };
        log.sessions.push(focusMin);
        store('study-timer', log);
        renderLog();
        mode = 'break';
        remaining = breakMin * 60;
      } else {
        mode = 'focus';
        remaining = focusMin * 60;
      }
    }
    render();
  }

  startButton.addEventListener('click', () => {
    if (endsAt) {
      tick();
      stop();
    } else {
      endsAt = Date.now() + remaining * 1000;
      ticker = setInterval(tick, 250);
    }
    render();
  });

  timer.querySelector('[data-reset]')?.addEventListener('click', () => {
    stop();
    mode = 'focus';
    remaining = focusMin * 60;
    render();
  });

  timer.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-preset]');
    if (!button) return;
    const [f, b] = (button.dataset.preset ?? '25,5').split(',').map(Number);
    focusMin = f ?? 25;
    breakMin = b ?? 5;
    for (const el of timer.querySelectorAll('[data-preset]')) el.setAttribute('aria-pressed', String(el === button));
    stop();
    mode = 'focus';
    remaining = focusMin * 60;
    render();
  });

  renderLog();
  render();
}

/* ───────── 학점 계산기 ───────── */

const gpa = document.querySelector<HTMLElement>('[data-gpa]');
if (gpa) {
  type Row = { name: string; credit: number; grade: string; major: boolean };
  const GRADES: Record<string, Record<string, number>> = {
    '4.5': { 'A+': 4.5, A0: 4.0, 'B+': 3.5, B0: 3.0, 'C+': 2.5, C0: 2.0, 'D+': 1.5, D0: 1.0, F: 0 },
    '4.3': { 'A+': 4.3, A0: 4.0, 'A-': 3.7, 'B+': 3.3, B0: 3.0, 'B-': 2.7, 'C+': 2.3, C0: 2.0, 'C-': 1.7, 'D+': 1.3, D0: 1.0, F: 0 },
  };
  const rowsEl = gpa.querySelector<HTMLElement>('[data-rows]')!;
  // Cloudflare 서버용 타입과 브라우저 타입이 겹쳐서, 선택 칸이라고 직접 알려 줘요.
  const scaleEl = document.getElementById('gpa-scale') as unknown as HTMLSelectElement;
  let state = load<{ scale: string; rows: Row[] }>('gpa-calc', {
    scale: '4.5',
    rows: [
      { name: '', credit: 3, grade: 'A+', major: true },
      { name: '', credit: 3, grade: 'A0', major: false },
      { name: '', credit: 2, grade: 'B+', major: false },
    ],
  });
  scaleEl.value = state.scale in GRADES ? state.scale : '4.5';

  function option(value: string, label = value, selected = false) {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = label;
    el.selected = selected;
    return el;
  }

  function compute() {
    const table = GRADES[state.scale] ?? GRADES['4.5']!;
    let points = 0;
    let graded = 0;
    let credits = 0;
    let majorPoints = 0;
    let majorGraded = 0;
    for (const row of state.rows) {
      credits += row.credit;
      if (row.grade === 'P') continue;
      const score = table[row.grade] ?? 0;
      points += score * row.credit;
      graded += row.credit;
      if (row.major) {
        majorPoints += score * row.credit;
        majorGraded += row.credit;
      }
    }
    gpa!.querySelector('[data-gpa-value]')!.textContent = graded ? (points / graded).toFixed(2) : '0.00';
    gpa!.querySelector('[data-credits]')!.textContent = String(credits);
    gpa!.querySelector('[data-major]')!.textContent = majorGraded ? (majorPoints / majorGraded).toFixed(2) : '-';
    store('gpa-calc', state);
  }

  function render() {
    const grades = Object.keys(GRADES[state.scale] ?? {});
    rowsEl.replaceChildren();
    state.rows.forEach((row, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'gpa-row';
      const name = document.createElement('input');
      name.className = 'input';
      name.placeholder = `과목 ${index + 1}`;
      name.value = row.name;
      name.maxLength = 40;
      name.setAttribute('aria-label', '과목 이름');
      name.addEventListener('input', () => {
        row.name = name.value;
        store('gpa-calc', state);
      });
      const credit = document.createElement('select');
      credit.className = 'select';
      credit.setAttribute('aria-label', '학점');
      for (const c of [1, 2, 3, 4]) credit.appendChild(option(String(c), `${c}학점`, row.credit === c));
      credit.addEventListener('change', () => {
        row.credit = Number(credit.value);
        compute();
      });
      const grade = document.createElement('select');
      grade.className = 'select';
      grade.setAttribute('aria-label', '성적');
      for (const g of [...grades, 'P']) grade.appendChild(option(g, g, row.grade === g));
      if (!grades.includes(row.grade) && row.grade !== 'P') row.grade = grades[0] ?? 'A+';
      grade.addEventListener('change', () => {
        row.grade = grade.value;
        compute();
      });
      const major = document.createElement('label');
      major.className = 'major';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = row.major;
      box.addEventListener('change', () => {
        row.major = box.checked;
        compute();
      });
      major.appendChild(box);
      major.appendChild(document.createTextNode('전공'));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn';
      remove.textContent = '×';
      remove.setAttribute('aria-label', '이 과목 빼기');
      remove.addEventListener('click', () => {
        state.rows.splice(index, 1);
        render();
      });
      wrap.appendChild(name);
      wrap.appendChild(credit);
      wrap.appendChild(grade);
      wrap.appendChild(major);
      wrap.appendChild(remove);
      rowsEl.appendChild(wrap);
    });
    compute();
  }

  gpa.querySelector('[data-add]')?.addEventListener('click', () => {
    if (state.rows.length >= 30) return;
    state.rows.push({ name: '', credit: 3, grade: 'A0', major: false });
    render();
  });
  scaleEl.addEventListener('change', () => {
    state = { ...state, scale: scaleEl.value };
    render();
  });
  render();
}
