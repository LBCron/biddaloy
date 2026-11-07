// A YouTube id is exactly 11 of these; the server checked it, this is the second guard (D56, D57).
const ID = /^[A-Za-z0-9_-]{11}$/;
const START_MAX = 86400;

/** The privacy-enhanced embed URL, or null when the id is not a clean YouTube id. */
export function embedUrl(id: unknown, start?: unknown): string | null {
  if (typeof id !== 'string' || !ID.test(id)) return null;
  const q = new URLSearchParams({ rel: '0', autoplay: '1' });
  const s = Number(start);
  if (Number.isInteger(s) && s > 0 && s <= START_MAX) q.set('start', String(s));
  return `https://www.youtube-nocookie.com/embed/${id}?${q}`;
}

/**
 * Click-to-play: until the visitor presses the play button the page holds no iframe and makes no
 * request to YouTube. The press swaps the poster for one sandboxed iframe and moves focus to it.
 */
export function initVideoEmbeds(root: ParentNode = document): void {
  root.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-video-play]');
    const box = btn?.closest<HTMLElement>('[data-video-embed]');
    if (!btn || !box || box.querySelector('iframe')) return;
    const url = embedUrl(box.dataset.id, box.dataset.start);
    if (!url) return;
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.title = box.dataset.title || '';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    frame.className = 've-frame';
    btn.replaceWith(frame);
    frame.focus();
  });
}
