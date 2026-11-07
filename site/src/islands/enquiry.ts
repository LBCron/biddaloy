// Enquiry form island (D21, D38, Rule 22): the one public write. Turnstile token + POST, then one
// fixed sentence per state (copy comes from `data-m-*`, set from i18n). Server text is never shown.
import { sendEnquiry, type EnquiryState } from '../lib/enquiry';

interface Turnstile {
  render(el: HTMLElement, o: Record<string, unknown>): string;
  reset(id?: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstile(): Promise<Turnstile | undefined> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => resolve(undefined);
    document.head.append(s);
  });
}

async function init(form: HTMLFormElement) {
  const status = form.querySelector<HTMLElement>('[data-status]')!;
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const box = form.querySelector<HTMLElement>('[data-captcha]')!;
  let token = '';
  let widget: string | undefined;

  const show = (state: EnquiryState) => {
    form.dataset.state = state;
    status.textContent =
      state === 'idle' ? '' : (form.dataset[`m${state[0].toUpperCase()}${state.slice(1)}`] ?? '');
    status.className =
      state === 'success' ? 'ok' : state === 'idle' || state === 'submitting' ? '' : 'bad';
    button.disabled = state === 'submitting';
  };

  const ts = await loadTurnstile();
  const key = form.dataset.sitekey ?? '';
  if (ts && key) {
    widget = ts.render(box, {
      sitekey: key,
      callback: (t: string) => (token = t),
      'expired-callback': () => (token = ''),
      'error-callback': () => (token = ''),
    });
  }
  show('idle');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.state === 'submitting') return;
    if (!token) return show('captcha');
    show('submitting');
    const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value.trim();
    const state = await sendEnquiry({
      name: v('name'),
      phone: v('phone'),
      message: v('message'),
      captcha_token: token,
    });
    show(state);
    if (state === 'success') form.reset();
    // A Turnstile token is single use: whatever happened, the next try needs a fresh one.
    token = '';
    if (widget !== undefined) ts?.reset(widget);
  });
}

document.querySelectorAll<HTMLFormElement>('form[data-enquiry]').forEach((f) => void init(f));
