// Stand-in for the by-host API in e2e: the SSR server fetches it server-side, so page.route cannot reach it.
// Host picks the answer: ok.localhost -> fixture, down.localhost -> 500, anything else -> 404.
import { createServer } from 'node:http';

const bt = (bn, en) => ({ bn, en });
const manifest = {
  theme: 'basic',
  palette: 'green',
  typography: {
    bn: { heading: 'hind-siliguri', body: 'hind-siliguri' },
    en: { heading: 'inter', body: 'inter' },
  },
  announcements: {
    style: 'marquee',
    speed: 'NORMAL',
    items: [
      { id: '1', text: bt('ভর্তি চলছে', 'Admission open'), href: '/bn/admissions/', enabled: true },
      { id: '2', text: bt('ফল প্রকাশ', 'Results out'), enabled: true },
      { id: '3', text: bt('বন্ধ আছে', 'Hidden'), enabled: false },
    ],
  },
  nav: [{ page: 'about' }, { page: 'notices' }, { page: 'contact' }],
  schoolName: bt('নবীনগর উচ্চ বিদ্যালয়', 'Nabinagar High School'),
  contact: { phone: '01711000000' },
};
const home = {
  page: 'home',
  sections: [
    {
      key: 'hero',
      enabled: true,
      data: {
        headline: bt('ভালো মানুষ হওয়ার শিক্ষা', 'Education that builds good people'),
        tagline: bt('বাংলা ট্যাগলাইন', ''),
        photos: ['a', 'b'],
      },
    },
    {
      key: 'about',
      enabled: true,
      data: { title: bt('আমাদের কথা', 'About us'), body: bt('বাংলা বিবরণ', '') },
    },
    { key: 'notices', enabled: true, data: { title: bt('নোটিশ বোর্ড', 'Notice board') } },
    { key: 'teachers', enabled: true, data: { title: bt('শিক্ষক', 'Teachers') }, feed: [] },
  ],
};

createServer((req, res) => {
  const m = /\/public\/site\/by-host\/([^/]+)\/(manifest|page\/[a-z]+)/.exec(req.url ?? '');
  const host = decodeURIComponent(m?.[1] ?? '');
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!m || host === 'down.localhost') return send(500, {});
  if (host !== 'ok.localhost') return send(404, { code: 'site.not_found' });
  if (m[2] === 'manifest') return send(200, manifest);
  const page = m[2].slice(5);
  if (page === 'home') return send(200, home);
  const inner = {
    about: [home.sections[1]],
    teachers: [
      {
        key: 'teachers',
        enabled: true,
        data: {},
        feed: [1, 2, 3].map((n) => ({
          id: String(n),
          name: bt(`শিক্ষক ${n}`, `Teacher ${n}`),
          subjects: ['গণিত'],
        })),
      },
    ],
    contact: [
      {
        key: 'contact',
        enabled: true,
        data: { title: bt('যোগাযোগ', 'Contact'), address: bt('ঢাকা', 'Dhaka') },
      },
    ],
  }[page];
  return inner ? send(200, { page, sections: inner }) : send(404, { code: 'site.not_found' });
}).listen(4399, '127.0.0.1');
