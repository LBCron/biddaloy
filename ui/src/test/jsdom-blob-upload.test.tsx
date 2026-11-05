import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from './msw/server';

/**
 * Regression for jsdom >= 30.1 + Vitest's jsdom environment: handing a
 * `FormData` that holds a jsdom `File` to `fetch` used to die with
 * `Cannot read properties of undefined (reading '_buffer')` before MSW saw
 * the request (see the block at the end of `jsdom-polyfills.ts`). Every
 * upload test in the SPAs depends on this path.
 */
describe('jsdom File/Blob through fetch', () => {
  it('a FormData with a File reaches the handler as a file part with its type', async () => {
    let raw = '';
    server.use(
      http.post('http://localhost/api/upload', async ({ request }) => {
        // The raw multipart body, not `request.formData()`: parsing it back
        // trips an unrelated undici assertion and no upload test needs it.
        raw = await request.text();
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );

    const body = new FormData();
    body.append('file', new File(['x'], 'rows.csv', { type: 'text/csv' }));
    const response = await fetch('http://localhost/api/upload', { method: 'POST', body });

    expect(response.status).toBe(201);
    // Parity with jsdom 30.0.1, not more: Vitest's own FormData conversion
    // forwards the part (name, filename "blob", type) but not its bytes on any
    // jsdom version, so bytes are asserted through the Blob body below.
    expect(raw).toContain('name="file"');
    expect(raw).toContain('Content-Type: text/csv');
  });

  it('a Blob built from parts, a typed array and another Blob keeps every byte', async () => {
    const part = new Blob(['cd']);
    const blob = new Blob(['ab', part, new Uint8Array([0x65, 0x66])], { type: 'text/plain' });

    expect(await blob.text()).toBe('abcdef');
    expect(await blob.slice(1, 4).text()).toBe('bcd');
    expect(blob.size).toBe(6);
    expect(blob instanceof Blob).toBe(true);
  });

  it('a sliced File posted as a Blob arrives with the sliced bytes only', async () => {
    let received = '';
    server.use(
      http.post('http://localhost/api/slice', async ({ request }) => {
        received = await (await request.blob()).text();
        return HttpResponse.json({ ok: true });
      }),
    );

    const file = new File(['0123456789'], 'n.txt', { type: 'text/plain' });
    await fetch('http://localhost/api/slice', { method: 'POST', body: file.slice(2, 6) });

    expect(received).toBe('2345');
  });
});
