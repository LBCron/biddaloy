/**
 * jsdom implements neither the Pointer Events APIs Radix's Select/Dropdown-
 * Menu/Tooltip use for open/close and scroll-into-view behaviour, nor
 * `ResizeObserver` (Radix's popper positioning watches for size changes).
 * Without these, interacting with those components under jsdom throws
 * (`target.hasPointerCapture is not a function`) rather than testing
 * anything — this is a known jsdom/Radix gap, not a bug in either.
 * No-op stubs are enough: these tests assert on rendered output and
 * `document.activeElement`, never on real pointer-capture or resize
 * behaviour, which needs a real browser (see `ui/README.md`'s testing
 * section) to mean anything anyway.
 *
 * Guarded on `typeof Element` because `ui/vitest.config.ts` applies this
 * same setup file to both the `:node` project (no DOM at all — `Element`
 * doesn't exist) and `:jsdom` project; unconditionally touching
 * `Element.prototype` would throw in the node project.
 */
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/** jsdom (as of v30) does not implement `window.matchMedia` at all — not
 * even a stub that reports `matches: false` — so any code that calls it
 * unconditionally throws under `:jsdom` tests. `ui/src/theme/
 * theme-provider.tsx` guards every call with `typeof matchMedia ===
 * 'function'`, so this stub is not required for that module to load, but
 * without it there would be no way for a test to simulate
 * `prefers-color-scheme: dark` or a live OS preference change at all — the
 * guard would just always take the "not supported" branch.
 *
 * A real `EventTarget` subclass, not a plain object with no-op listener
 * methods, and cached one-per-query rather than a fresh object per call:
 * `theme-provider.tsx` registers its `change` listener once, at module
 * load, against whatever object *that* one call to `matchMedia(query)`
 * returned. A test simulating an OS preference flip
 * (`ui/src/test/system-theme.ts`'s `mockSystemPrefersDark`) has to mutate
 * and dispatch on that exact same object for the listener to fire — a
 * fresh object per call, or per-instance no-op `addEventListener`, would
 * make that impossible. `matches: false` by default matches a light-OS
 * visitor. */
class FakeMediaQueryList extends EventTarget implements MediaQueryList {
  matches = false;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null;
  constructor(readonly media: string) {
    super();
  }
  addListener(listener: (this: MediaQueryList, ev: MediaQueryListEvent) => unknown): void {
    this.addEventListener('change', listener as EventListener);
  }
  removeListener(listener: (this: MediaQueryList, ev: MediaQueryListEvent) => unknown): void {
    this.removeEventListener('change', listener as EventListener);
  }
}

const mediaQueryLists = new Map<string, FakeMediaQueryList>();

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => {
    let mql = mediaQueryLists.get(query);
    if (!mql) {
      mql = new FakeMediaQueryList(query);
      mediaQueryLists.set(query, mql);
    }
    return mql;
  };
}

/**
 * jsdom >= 30.1 keeps a node's implementation in a private `#impl` field,
 * so `Object.getOwnPropertySymbols(new Blob())` is empty. Vitest's jsdom
 * environment (4.x and 5.x) finds the bytes of a `Blob`/`File` through
 * that hidden symbol — `blob[implSymbol]._buffer` — whenever a jsdom
 * `FormData` or `Blob` is handed to `fetch`/`Request`. With the symbol
 * gone, `implSymbol` is `undefined`, the read becomes `blob['undefined']`,
 * and every upload in a test dies with `Cannot read properties of
 * undefined (reading '_buffer')` before MSW sees the request.
 *
 * jsdom exposes no synchronous way to read a Blob, so record the bytes at
 * construction and serve them under that exact `'undefined'` key. Only
 * installed when jsdom hides its implementation, so older jsdom is
 * untouched. Remove once Vitest reads Blob bytes without the hidden
 * symbol (watch the vitest release notes; delete this block and re-run
 * the upload tests in `client-admin`).
 */
if (typeof window !== 'undefined' && typeof Blob !== 'undefined') {
  const BlobBase = Blob;
  const FileBase = File;
  if (Object.getOwnPropertySymbols(new BlobBase()).length === 0) {
    const bytesOf = new WeakMap<object, Uint8Array>();
    const encoder = new TextEncoder();

    const toBytes = (part: unknown): Uint8Array => {
      if (typeof part === 'string') return encoder.encode(part);
      if (part instanceof ArrayBuffer) return new Uint8Array(part.slice(0));
      if (ArrayBuffer.isView(part)) {
        return new Uint8Array(
          part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength),
        );
      }
      if (part instanceof BlobBase) return bytesOf.get(part) ?? new Uint8Array(0);
      return encoder.encode(String(part));
    };
    const concat = (parts: unknown[]): Uint8Array => {
      const chunks = parts.map(toBytes);
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    };

    class RecordingBlob extends BlobBase {
      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        super(parts, options);
        bytesOf.set(this, concat(parts));
      }
      override slice(start?: number, end?: number, type?: string): Blob {
        const sliced = super.slice(start, end, type);
        bytesOf.set(sliced, (bytesOf.get(this) ?? new Uint8Array(0)).slice(start, end));
        return sliced;
      }
    }
    class RecordingFile extends FileBase {
      constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
        super(parts, name, options);
        bytesOf.set(this, concat(parts));
      }
      override slice(start?: number, end?: number, type?: string): Blob {
        const sliced = super.slice(start, end, type);
        bytesOf.set(sliced, (bytesOf.get(this) ?? new Uint8Array(0)).slice(start, end));
        return sliced;
      }
    }

    // `FormData.append/set` store a *copy* of a Blob/File (a fresh wrapper this
    // module never constructed), so copy the recorded bytes onto the stored one.
    const proto = FormData.prototype as unknown as Record<
      'append' | 'set',
      (this: FormData, ...args: unknown[]) => void
    >;
    for (const method of ['append', 'set'] as const) {
      const original = proto[method];
      proto[method] = function patched(this: FormData, ...args: unknown[]) {
        original.apply(this, args);
        const [name, value] = args as [string, unknown];
        const recorded = value instanceof BlobBase ? bytesOf.get(value) : undefined;
        const stored = recorded ? this.getAll(name).at(-1) : undefined;
        if (stored && typeof stored !== 'string') bytesOf.set(stored, recorded as Uint8Array);
      };
    }

    // Vitest reads `blob[undefined]._buffer`, i.e. the property named 'undefined'.
    Object.defineProperty(BlobBase.prototype, 'undefined', {
      configurable: true,
      get(this: Blob) {
        return { _buffer: Buffer.from(bytesOf.get(this) ?? new Uint8Array(0)) };
      },
    });
    globalThis.Blob = RecordingBlob;
    globalThis.File = RecordingFile;
  }
}
