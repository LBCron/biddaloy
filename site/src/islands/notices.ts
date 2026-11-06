// Notice list island: the only client JS the site ships (D38). Plain DOM, no framework.
// Fetches through the same-origin `/_api/...` path that nginx proxies to the by-host API (#3620).
const MIN_SKELETON_MS = 300;
const MAX_WAIT_MS = 1200;

type L = string | { bn?: string; en?: string } | undefined;
interface Item {
  id?: string;
  title?: L;
  date?: string;
  publishedAt?: string;
}

const text = (v: L, lang: string) =>
  typeof v === 'string' ? v : (lang === 'en' && v?.en) || v?.bn || '';

async function load(root: HTMLElement) {
  const lang = root.dataset.lang === 'en' ? 'en' : 'bn';
  const list = root.querySelector<HTMLElement>('.notice-list')!;
  const started = Date.now();
  let items: Item[] | undefined;
  try {
    const res = await fetch('/_api/island/notices', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(MAX_WAIT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as Item[] | { items?: Item[] };
      items = Array.isArray(body) ? body : (body.items ?? []);
    }
  } catch {
    /* falls through to the error text */
  }
  await new Promise((r) => setTimeout(r, Math.max(0, MIN_SKELETON_MS - (Date.now() - started))));

  list.replaceChildren();
  if (!items) {
    list.className = 'ready empty';
    list.textContent = root.dataset.error ?? '';
  } else if (items.length === 0) {
    list.className = 'ready empty';
    list.textContent = root.dataset.empty ?? '';
  } else {
    for (const n of items) {
      const a = document.createElement('a');
      a.className = 'notice';
      a.href = `/${lang}/notices/`;
      const d = new Date(n.date ?? n.publishedAt ?? '');
      const date = document.createElement('span');
      date.className = 'date';
      if (!Number.isNaN(d.getTime())) {
        const day = document.createElement('b');
        day.textContent = d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'bn-BD', {
          day: '2-digit',
        });
        const mon = document.createElement('span');
        mon.textContent = d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'bn-BD', {
          month: 'short',
        });
        date.append(day, mon);
      }
      const h = document.createElement('h4');
      h.textContent = text(n.title, lang);
      a.append(date, h);
      list.append(a);
    }
  }
  root.removeAttribute('data-loading');
  root.setAttribute('aria-busy', 'false');
}

document.querySelectorAll<HTMLElement>('[data-notices]').forEach((el) => void load(el));
