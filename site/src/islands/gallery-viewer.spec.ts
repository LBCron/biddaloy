// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initGalleryViewer, keyStep, nextPhoto } from './gallery-viewer';

describe('pure parts', () => {
  it('keys: arrows move, others do not', () => {
    expect([
      keyStep('ArrowLeft'),
      keyStep('ArrowRight'),
      keyStep('Tab'),
      keyStep('Escape'),
    ]).toEqual([-1, 1, 0, 0]);
  });
  it('nextPhoto wraps at both ends', () => {
    expect(nextPhoto(2, 1, 3)).toBe(0);
    expect(nextPhoto(0, -1, 3)).toBe(2);
  });
});

describe('initGalleryViewer', () => {
  beforeEach(() => {
    // jsdom has no modal <dialog>
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
    document.body.innerHTML = `<ul data-gv-album>
      <li><button data-gv-open data-cap="<i>one</i>"><img src="/media/a" alt="one"></button></li>
      <li><button data-gv-open><img src="/media/b" alt="two"></button></li></ul>
      <dialog data-gv><button class="gv-close"></button><img class="gv-img"><p class="gv-cap" hidden></p>
      <button class="gv-prev"></button><button class="gv-next"></button></dialog>`;
    initGalleryViewer();
  });
  const tiles = () => document.querySelectorAll<HTMLElement>('[data-gv-open]');
  const dlg = () => document.querySelector<HTMLDialogElement>('dialog')!;
  const shownSrc = () => document.querySelector('.gv-img')!.getAttribute('src');

  it('opens on the clicked tile; caption is text, never markup', () => {
    tiles()[0].click();
    expect(dlg().hasAttribute('open')).toBe(true);
    expect(shownSrc()).toBe('/media/a');
    expect(document.querySelector('.gv-cap')!.textContent).toBe('<i>one</i>');
    expect(document.querySelector('.gv-cap i')).toBeNull();
  });
  it('arrow keys and next move; a photo with no caption hides the caption', () => {
    tiles()[0].click();
    dlg().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(shownSrc()).toBe('/media/b');
    expect((document.querySelector('.gv-cap') as HTMLElement).hidden).toBe(true);
    document.querySelector<HTMLElement>('.gv-next')!.click();
    expect(shownSrc()).toBe('/media/a');
  });
  it('close returns focus to the tile', () => {
    const focus = vi.spyOn(tiles()[1], 'focus');
    tiles()[1].click();
    document.querySelector<HTMLElement>('.gv-close')!.click();
    expect(focus).toHaveBeenCalled();
  });
});
