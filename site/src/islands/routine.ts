// Class routine island (D21, D38): pick a section, read `island/routine?classSectionId=`. Plain DOM.
import { loadRows, settle, text, type L } from './common';

interface Slot {
  weekday: number;
  startsAt: string;
  endsAt: string;
  period?: string | null;
  subject?: L;
}

async function load(root: HTMLElement) {
  const lang = root.dataset.lang === 'en' ? 'en' : 'bn';
  const select = root.querySelector<HTMLSelectElement>('select')!;
  const out = root.querySelector<HTMLElement>('.routine-grid')!;

  let inflight: AbortController | undefined;
  async function show() {
    inflight?.abort(); // a quick second pick cancels the first, so an old answer never paints over it
    if (!select.value) {
      // Nothing chosen: clear the grid and drop the loading state the aborted request left on.
      out.replaceChildren();
      return settle(root, out, '');
    }
    const mine = (inflight = new AbortController());
    root.setAttribute('data-loading', '');
    root.setAttribute('aria-busy', 'true');
    const rows = await loadRows<Slot>(
      `/_api/island/routine?classSectionId=${encodeURIComponent(select.value)}`,
      mine.signal,
    );
    if (mine.signal.aborted) return;
    out.replaceChildren();
    if (!rows) return settle(root, out, root.dataset.error ?? '');
    if (rows.length === 0) return settle(root, out, root.dataset.empty ?? '');
    out.className = 'ready routine-grid';
    const days = [...new Set(rows.map((r) => r.weekday))].sort((a, b) => a - b);
    for (const day of days) {
      const h = document.createElement('h4');
      h.textContent = root.dataset[`d${day}`] ?? '';
      const ul = document.createElement('ul');
      for (const r of rows.filter((x) => x.weekday === day)) {
        const li = document.createElement('li');
        li.textContent = `${r.startsAt}–${r.endsAt}  ${text(r.subject, lang)}`;
        ul.append(li);
      }
      out.append(h, ul);
    }
    settle(root, out);
  }

  select.addEventListener('change', () => void show());
  root.removeAttribute('data-loading');
  root.setAttribute('aria-busy', 'false');
}

document.querySelectorAll<HTMLElement>('[data-routine]').forEach((el) => void load(el));
