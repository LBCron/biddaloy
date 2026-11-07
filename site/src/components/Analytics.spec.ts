import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import Analytics from './Analytics.astro';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});
const render = (analytics: unknown, locals: Record<string, unknown> = {}) =>
  container.renderToString(Analytics, { props: { manifest: { analytics } }, locals: locals as never });
const good = { websiteId: 'a1b2-c3', scriptUrl: 'https://stats.example.org/script.js' };

describe('Analytics', () => {
  it('draws one deferred tag with the website id and do-not-track, no inline script', async () => {
    const html = await render(good);
    expect(html).toContain('src="https://stats.example.org/script.js"');
    expect(html).toContain('data-website-id="a1b2-c3"');
    expect(html).toContain('data-do-not-track="true"');
    expect(html).toMatch(/<script[^>]*\bdefer\b/);
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it('draws nothing without an analytics block', async () => {
    expect((await render(undefined)).trim()).toBe('');
  });

  it('draws nothing for a preview request', async () => {
    expect((await render(good, { preview: true })).trim()).toBe('');
    expect((await render(good, { previewToken: 't' })).trim()).toBe('');
  });

  it('refuses a script URL that is not https or can break out of the attribute', async () => {
    for (const scriptUrl of [
      'http://x.test/s.js',
      'javascript:alert(1)',
      'https://x.test/"onload=1',
    ]) {
      expect((await render({ ...good, scriptUrl })).trim()).toBe('');
    }
  });

  it('refuses a website id with odd characters', async () => {
    expect((await render({ ...good, websiteId: '"><script>' })).trim()).toBe('');
  });
});
