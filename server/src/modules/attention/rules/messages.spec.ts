import { render, resolveLocale } from './messages';

const messages = {
  en: {
    title: 'Class {section} starts',
    why: '{count} students in {section}',
    steps: ['Open {section}', 'Mark {count}'],
    action: 'Go to {section}',
  },
  bn: {
    title: '{section} শুরু',
    why: '{count} জন {section}',
    steps: ['{section} খুলুন'],
    action: '{section}',
  },
};

describe('attention messages', () => {
  it('en replaces placeholders in title, why, steps and action', () => {
    const r = render(messages, 'en', { section: '7-B', count: 4 });
    expect(r.title).toBe('Class 7-B starts');
    expect(r.why).toBe('4 students in 7-B');
    expect(r.steps).toEqual(['Open 7-B', 'Mark 4']);
    expect(r.action).toBe('Go to 7-B');
  });

  it('bn converts digits in values', () => {
    const r = render(messages, 'bn', { section: '7-B', count: 4 });
    expect(r.why).toBe('৪ জন ৭-B');
  });

  it('leaves unknown placeholders as-is', () => {
    expect(render(messages, 'en', { section: 'x' }).why).toBe('{count} students in x');
  });

  it('resolveLocale', () => {
    expect(resolveLocale('bn-BD')).toBe('bn');
    expect(resolveLocale('en-BD')).toBe('en');
    // #3136: no stored locale means the bn-BD default.
    expect(resolveLocale(undefined)).toBe('bn');
  });
});
