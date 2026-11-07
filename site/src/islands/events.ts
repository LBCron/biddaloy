// Upcoming-days island (D21, D38): the next 10 events/holidays from `island/events`. Plain DOM.
import { loadRows, settle, text, type L } from './common';

interface Item {
  id?: string;
  title?: L;
  date?: string;
}

async function load(root: HTMLElement) {
  const lang = root.dataset.lang === 'en' ? 'en' : 'bn';
  const loc = lang === 'en' ? 'en-GB' : 'bn-BD';
  const list = root.querySelector<HTMLElement>('.event-list')!;
  const items = await loadRows<Item>('/_api/island/events');
  list.replaceChildren();
  if (!items) return settle(root, list, root.dataset.error ?? '');
  if (items.length === 0) return settle(root, list, root.dataset.empty ?? '');
  for (const e of items) {
    const card = document.createElement('div');
    card.className = 'card ev';
    const d = new Date(`${e.date ?? ''}T00:00:00+06:00`);
    if (!Number.isNaN(d.getTime())) {
      const date = document.createElement('span');
      date.className = 'date';
      const day = document.createElement('b');
      day.textContent = d.toLocaleDateString(loc, { day: '2-digit', timeZone: 'Asia/Dhaka' });
      const mon = document.createElement('span');
      mon.textContent = d.toLocaleDateString(loc, { month: 'short', timeZone: 'Asia/Dhaka' });
      date.append(day, mon);
      card.append(date);
    }
    const name = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = text(e.title, lang);
    name.append(b);
    card.append(name);
    list.append(card);
  }
  settle(root, list);
}

document.querySelectorAll<HTMLElement>('[data-events]').forEach((el) => void load(el));
