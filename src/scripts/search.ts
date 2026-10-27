// 검색 창: Ctrl+K(맥은 ⌘K) 또는 / 키로 열고, 입력하면 바로 결과를 보여 줘요.

type Result = {
  slug: string;
  title: string;
  snippet: string;
  date: string;
  day: number | null;
  tags: { name: string; color: string }[];
};

const dialog = document.querySelector<HTMLDialogElement>('#search-dialog');

if (dialog) {
  const input = dialog.querySelector<HTMLInputElement>('[data-search-input]')!;
  const list = dialog.querySelector<HTMLUListElement>('[data-search-results]')!;
  const empty = dialog.querySelector<HTMLElement>('[data-search-empty]')!;
  const message = dialog.querySelector<HTMLElement>('[data-search-message]')!;
  const defaultMessage = message.textContent ?? '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let active = -1;

  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  for (const kbd of document.querySelectorAll<HTMLElement>('[data-shortcut]')) kbd.textContent = isMac ? '⌘ K' : 'Ctrl K';

  const open = () => {
    if (dialog.open) return;
    dialog.showModal();
    input.select();
  };

  const isTyping = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

  document.addEventListener('click', (event) => {
    const trigger = (event.target as Element | null)?.closest('[data-search-open]');
    if (trigger) {
      event.preventDefault();
      open();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (dialog.open) dialog.close();
      else open();
    } else if (event.key === '/' && !dialog.open && !isTyping(event.target)) {
      event.preventDefault();
      open();
    }
  });

  // 바깥(어두운 부분)을 누르면 닫혀요.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.querySelector('[data-search-close]')?.addEventListener('click', () => dialog.close());

  const links = () => [...list.querySelectorAll<HTMLAnchorElement>('a')];

  const select = (index: number) => {
    const items = links();
    if (items.length === 0) return;
    active = (index + items.length) % items.length;
    items.forEach((a, i) => a.setAttribute('aria-selected', String(i === active)));
    items[active]?.scrollIntoView({ block: 'nearest' });
  };

  /** 검색어와 같은 부분을 형광펜(<mark>)으로 칠해요. innerHTML을 쓰지 않아서 안전해요. */
  const highlight = (text: string, terms: string[]) => {
    const fragment = document.createDocumentFragment();
    if (terms.length === 0) {
      fragment.appendChild(document.createTextNode(text));
      return fragment;
    }
    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
    for (const part of text.split(pattern)) {
      if (!part) continue;
      if (terms.some((t) => t.toLowerCase() === part.toLowerCase())) {
        const mark = document.createElement('mark');
        mark.textContent = part;
        fragment.appendChild(mark);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    }
    return fragment;
  };

  const render = (results: Result[], query: string) => {
    list.replaceChildren();
    active = -1;
    const terms = query.split(/\s+/).filter(Boolean);
    for (const result of results) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const a = document.createElement('a');
      a.href = `/posts/${encodeURIComponent(result.slug)}`;
      const title = document.createElement('strong');
      title.appendChild(highlight(result.title, terms));
      const snippet = document.createElement('span');
      snippet.className = 'snippet';
      snippet.appendChild(highlight(result.snippet, terms));
      const meta = document.createElement('span');
      meta.className = 'post-meta';
      meta.textContent = [result.day ? `DAY ${String(result.day).padStart(3, '0')}` : '', result.date, ...result.tags.map((t) => `#${t.name}`)]
        .filter(Boolean)
        .join('  ·  ');
      a.appendChild(title);
      a.appendChild(snippet);
      a.appendChild(meta);
      li.appendChild(a);
      list.appendChild(li);
    }
    empty.hidden = results.length > 0;
    if (results.length > 0) select(0);
  };

  const run = async () => {
    const query = input.value.trim();
    controller?.abort();
    if (!query) {
      render([], '');
      message.textContent = defaultMessage;
      return;
    }
    controller = new AbortController();
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      const data = (await response.json()) as { results?: Result[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? '검색하지 못했어요.');
      render(data.results ?? [], query);
      if (!data.results?.length) message.textContent = `"${query}"에 맞는 기록이 아직 없어요.`;
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      render([], query);
      message.textContent = (error as Error).message;
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 160);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      select(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      select(active - 1);
    } else if (event.key === 'Enter' && active >= 0) {
      const target = links()[active];
      if (target) {
        event.preventDefault();
        window.location.href = target.href;
      }
    }
  });
}
