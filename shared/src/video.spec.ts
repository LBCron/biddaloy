import { describe, expect, it } from 'vitest';
import { parseYoutubeStartSeconds, parseYoutubeVideoId } from './video';

const ID = 'dQw4w9WgXcQ';

describe('parseYoutubeVideoId', () => {
  it.each([
    `<iframe width="560" height="315" src="https://www.youtube.com/embed/${ID}?si=abc" title="YouTube video player" frameborder="0" allowfullscreen></iframe>`,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}&list=PL1`,
    `https://youtu.be/${ID}?t=42`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `  https://youtube.com/embed/${ID}  `,
  ])('accepts %s', (input) => {
    expect(parseYoutubeVideoId(input)).toBe(ID);
  });

  it.each([
    `<iframe src="https://evil.example/embed/${ID}"></iframe>`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://evil.example/?u=https://youtu.be/${ID}`,
    'javascript:alert(1)',
    `<script>alert(1)</script>`,
    `<script>alert(1)</script> https://youtu.be/${ID}`,
    'https://youtu.be/dQw4w9WgXc',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQQ',
    '',
  ])('rejects %s', (input) => {
    expect(parseYoutubeVideoId(input)).toBeNull();
  });
});

describe('parseYoutubeStartSeconds', () => {
  it('reads start= and t= forms', () => {
    expect(parseYoutubeStartSeconds(`https://youtu.be/${ID}?t=42`)).toBe(42);
    expect(parseYoutubeStartSeconds(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)).toBe(90);
    expect(parseYoutubeStartSeconds(`https://www.youtube.com/embed/${ID}?start=15`)).toBe(15);
  });
  it('caps at 86400 and returns null for nothing or junk', () => {
    expect(parseYoutubeStartSeconds(`https://youtu.be/${ID}?t=999999`)).toBe(86400);
    expect(parseYoutubeStartSeconds(`https://youtu.be/${ID}`)).toBeNull();
    expect(parseYoutubeStartSeconds(`https://youtu.be/${ID}?t=abc`)).toBeNull();
    expect(parseYoutubeStartSeconds('')).toBeNull();
  });
});
