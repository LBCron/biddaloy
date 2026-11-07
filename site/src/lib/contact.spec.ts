import { describe, expect, it } from 'vitest';
import { httpsLink, mapEmbed, whatsappLink } from './contact';

describe('contact links', () => {
  it('httpsLink keeps https and drops everything else', () => {
    expect(httpsLink('https://facebook.com/school')).toBe('https://facebook.com/school');
    expect(httpsLink('http://x.com')).toBeUndefined();
    expect(httpsLink('javascript:alert(1)')).toBeUndefined();
    expect(httpsLink(5)).toBeUndefined();
  });

  it('whatsappLink builds wa.me from a number and refuses other hosts', () => {
    expect(whatsappLink('+880 1711-000000')).toBe('https://wa.me/8801711000000');
    expect(whatsappLink('https://wa.me/8801711000000')).toBe('https://wa.me/8801711000000');
    expect(whatsappLink('https://evil.example/x')).toBeUndefined();
    expect(whatsappLink('call me')).toBeUndefined();
  });

  it('mapEmbed prefers lat/long, falls back to the address, else nothing', () => {
    expect(mapEmbed(23.8, 90.4, 'Dhaka')).toContain('q=23.8%2C90.4');
    expect(mapEmbed(undefined, undefined, 'Nabinagar, Dhaka')).toContain('q=Nabinagar%2C%20Dhaka');
    expect(mapEmbed(999, 90, 'Dhaka')).toContain('q=Dhaka');
    expect(mapEmbed(undefined, undefined, undefined)).toBeUndefined();
  });
});
