// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { embedUrl, initVideoEmbeds } from './video-embed';

describe('embedUrl', () => {
  it('builds the nocookie embed from a clean id', () => {
    expect(embedUrl('dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1',
    );
    expect(embedUrl('dQw4w9WgXcQ', '90')).toContain('&start=90');
  });
  it.each(['javascript:alert(1)', 'dQw4w9WgXc', 'dQw4w9WgXcQQ', 'dQw4w9WgXcQ?x=1', '', undefined])(
    'rejects %j',
    (id) => expect(embedUrl(id)).toBeNull(),
  );
  it('drops a start that is not a whole number of seconds in range', () => {
    for (const s of ['-3', '0', '1.5', 'abc', '86401', undefined]) {
      expect(embedUrl('dQw4w9WgXcQ', s)).not.toContain('start=');
    }
  });
});

describe('initVideoEmbeds', () => {
  const html = (id: string) =>
    `<div data-video-embed data-id="${id}" data-start="5" data-title="T"><button data-video-play>go</button></div>`;
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('adds no iframe until the click, then exactly one sandboxed iframe', () => {
    document.body.innerHTML = html('dQw4w9WgXcQ');
    initVideoEmbeds(document.body);
    expect(document.querySelector('iframe')).toBeNull();
    document.querySelector<HTMLElement>('[data-video-play]')!.click();
    const f = document.querySelectorAll('iframe');
    expect(f).toHaveLength(1);
    expect(f[0].src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(f[0].getAttribute('sandbox')).toContain('allow-scripts');
    expect(f[0].title).toBe('T');
  });
  it('a tampered id in the markup builds nothing', () => {
    document.body.innerHTML = html("x'onload='alert(1)");
    initVideoEmbeds(document.body);
    document.querySelector<HTMLElement>('[data-video-play]')!.click();
    expect(document.querySelector('iframe')).toBeNull();
  });
});
