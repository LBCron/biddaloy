import { SITE_FEATURED_TEACHERS_MAX, SiteSectionKey } from '@biddaloy/shared';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Lang, SiteManifest } from '../../../lib/types';
import theme from '../index';

const bt = (bn: string, en: string) => ({ bn, en });
const manifest = {
  schoolName: bt('সূর্যমুখী', 'Surjomukhi'),
  contact: {},
} as unknown as SiteManifest;
let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

async function render(
  key: SiteSectionKey,
  props: {
    data?: Record<string, unknown>;
    feed?: Record<string, unknown>[];
    lang?: Lang;
    page?: string;
    manifest?: SiteManifest;
  } = {},
) {
  const Comp = theme.sections[key]!;
  return container.renderToString(Comp, {
    props: { data: {}, feed: [], lang: 'bn', manifest, ...props },
  });
}
const teachers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: bt(`শিক্ষক ${i}`, `Teacher ${i}`),
    designation: bt('সহকারী', 'Assistant'),
  }));

describe('college sections (D25: a cleared text collapses, no placeholder)', () => {
  it('registers a component for every section key Basic renders', () => {
    for (const k of [
      'hero',
      'about',
      'academics',
      'routine',
      'admissions',
      'teachers',
      'notices',
      'events',
      'blog',
      'contact',
    ]) {
      expect(theme.sections[k as SiteSectionKey], k).toBeTruthy();
    }
  });

  it.each(['hero', 'about', 'academics', 'admissions', 'routine'] as const)(
    '%s with nothing filled in renders nothing',
    async (k) => {
      expect((await render(k as SiteSectionKey)).trim()).toBe('');
    },
  );

  it('about and academics render their text, in the language asked', async () => {
    const data = { title: bt('আমাদের কথা', 'About us'), body: bt('বাংলা লেখা', 'English text') };
    expect(await render(SiteSectionKey.ABOUT, { data, lang: 'en' })).toContain('English text');
    expect(await render(SiteSectionKey.ABOUT, { data })).toContain('বাংলা লেখা');
    const html = await render(SiteSectionKey.ACADEMICS, {
      data: { body: bt('এক\n\nদুই\n\nতিন', 'One\n\nTwo\n\nThree') },
      lang: 'en',
    });
    expect(html.match(/class="dept"/g)).toHaveLength(3);
    expect(html).not.toContain('<h2');
  });

  it('academics splits "Name: text" into a department name and its text', async () => {
    const html = await render(SiteSectionKey.ACADEMICS, {
      data: { body: bt('বিজ্ঞান: পদার্থ\n\nশুধু লেখা', 'Science: physics\n\nPlain text') },
      lang: 'en',
    });
    expect(html).toContain('<b class="dept-name">Science</b>');
    expect(html).toContain('physics');
    expect(html.match(/dept-name/g)).toHaveLength(1);
  });

  it('admissions: several paragraphs become numbered steps, one paragraph stays prose', async () => {
    const steps = await render(SiteSectionKey.ADMISSIONS, {
      data: { body: bt('এক\n\nদুই\n\nতিন', 'One\n\nTwo\n\nThree') },
      lang: 'en',
    });
    expect(steps.match(/class="step( now)?"/g)).toHaveLength(3);
    const one = await render(SiteSectionKey.ADMISSIONS, {
      data: { body: bt('এক', 'One') },
      lang: 'en',
    });
    expect(one).not.toContain('class="steps"');
    expect(one).toContain('One');
  });

  it('about with only a title still renders, with no empty body paragraph', async () => {
    const html = await render(SiteSectionKey.ABOUT, { data: { title: bt('ক', 'A') } });
    expect(html).toContain('<h2');
    expect(html).not.toContain('prose-p');
  });
});

describe('college hero (D26)', () => {
  const data = { headline: bt('শিরোনাম', 'Headline'), images: ['m1'] };
  it('one photo: a static image, no controls', async () => {
    const html = await render(SiteSectionKey.HERO, { data });
    expect(html).toContain('/media/m1');
    expect(html).toContain('data-single');
    expect(html).toContain('class="plate"');
  });
  it('two photos: a carousel', async () => {
    const html = await render(SiteSectionKey.HERO, { data: { ...data, images: ['m1', 'm2'] } });
    expect(html).toContain('data-carousel');
    expect(html).not.toContain('data-single');
  });
  it('no photo: a typographic hero with the theme drawing, no image and no photo frame', async () => {
    const html = await render(SiteSectionKey.HERO, {
      data: { headline: bt('শিরোনাম', 'Headline') },
    });
    expect(html).toContain('class="facade"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('plate');
  });
  it('photos and no text: carousel only, no empty heading', async () => {
    const html = await render(SiteSectionKey.HERO, { data: { images: ['m1'] } });
    expect(html).not.toContain('<h1');
    expect(html).toContain('/media/m1');
  });
});

describe('college teachers (D27)', () => {
  it('home: caps at the featured maximum and links to everyone', async () => {
    const html = await render(SiteSectionKey.TEACHERS, {
      feed: teachers(SITE_FEATURED_TEACHERS_MAX + 4),
      page: 'home',
    });
    expect(html.match(/class="card tcard"/g)).toHaveLength(SITE_FEATURED_TEACHERS_MAX);
    expect(html).toContain('/bn/teachers/');
  });
  it('teachers page: lists every row given, no see-all link', async () => {
    const html = await render(SiteSectionKey.TEACHERS, { feed: teachers(12), page: 'teachers' });
    expect(html.match(/class="card tcard"/g)).toHaveLength(12);
    expect(html).not.toContain('class="seeall"');
  });
  it('no teachers: a calm empty line, not an empty grid', async () => {
    expect(await render(SiteSectionKey.TEACHERS, { page: 'teachers' })).toContain('class="empty"');
  });
});

describe('college system-fed sections', () => {
  it('blog with no posts shows the empty line; with a post it links by slug and has no inline style', async () => {
    expect(await render(SiteSectionKey.BLOG)).toContain('class="empty"');
    const html = await render(SiteSectionKey.BLOG, {
      feed: [{ slug: 'hello', title: bt('নমস্কার', 'Hello'), cover: 'c1' }],
    });
    expect(html).toContain('/bn/blog/hello');
    expect(html).toContain('/media/c1');
    expect(html).not.toContain('style=');
  });
  it('notices and events keep their loading skeletons and the shared island hooks', async () => {
    expect(await render(SiteSectionKey.NOTICES)).toContain('data-notices');
    expect(await render(SiteSectionKey.EVENTS)).toContain('data-events');
  });
  it('routine renders only when the server sent classes to pick from', async () => {
    const data = { sections: [{ id: 's1', label: bt('প্রথম', 'One') }] };
    expect(await render(SiteSectionKey.ROUTINE, { data })).toContain('data-routine');
  });
  it('admissions lists open intakes only when their link is a site path', async () => {
    const feed = [
      { title: 'Open', link: '/bn/admissions/', deadline: '2026-12-15' },
      { title: 'Elsewhere', link: 'https://other.example/' },
    ];
    const html = await render(SiteSectionKey.ADMISSIONS, {
      data: { title: bt('ভর্তি', 'Admissions') },
      feed,
    });
    expect(html).toContain('Open');
    expect(html).not.toContain('Elsewhere');
  });
});

describe('college contact with optional fields missing', () => {
  it('no map, no social links, no address: no iframe, no link row', async () => {
    const html = await render(SiteSectionKey.CONTACT, {
      data: { title: bt('যোগাযোগ', 'Contact') },
    });
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('wa.me');
    expect(html).not.toContain('<dd>');
  });
  it('filled optional fields appear; a non-https facebook link is dropped', async () => {
    const html = await render(SiteSectionKey.CONTACT, {
      data: {
        whatsapp: bt('01712345678', '01712345678'),
        facebook: bt('javascript:alert(1)', 'javascript:alert(1)'),
        address: bt('ঢাকা', 'Dhaka'),
      },
    });
    expect(html).toContain('wa.me');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('ঢাকা');
  });
});

describe('college sections never print an inline style or script (CSP style-src self)', () => {
  it.each(Object.keys(theme.sections))('%s', async (k) => {
    const html = await render(k as SiteSectionKey, {
      data: { title: bt('ক', 'A'), body: bt('খ', 'B'), headline: bt('গ', 'C') },
      feed: teachers(2),
    });
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toContain('is:inline');
  });
});
