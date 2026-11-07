/** Every state the enquiry form can be in. Each one has one fixed sentence in `i18n` (`enquiry.<state>`). */
export type EnquiryState =
  | 'idle'
  | 'submitting'
  | 'success'
  | 'captcha' // the Turnstile check is missing or failed: tick it again
  | 'invalid' // the server refused a field (400)
  | 'closed' // the site is off / not found (404)
  | 'rate' // too many tries (429)
  | 'error'; // anything else, including no network

export interface EnquiryBody {
  name: string;
  phone: string;
  message: string;
  captcha_token: string;
}

/**
 * Posts to the enquiry route through the same-origin `/_api/` proxy and maps the answer to a
 * state. The server's own text is never read or shown (Rule 23): only the status and the
 * machine code `details.code` pick the fixed sentence.
 */
export async function sendEnquiry(
  body: EnquiryBody,
  fetchImpl: typeof fetch = fetch,
): Promise<Exclude<EnquiryState, 'idle' | 'submitting'>> {
  try {
    const res = await fetchImpl('/_api/island/enquiry', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 201) return 'success';
    if (res.status === 400) {
      const j = (await res.json().catch(() => null)) as { details?: { code?: string } } | null;
      return j?.details?.code === 'CAPTCHA_FAILED' ? 'captcha' : 'invalid';
    }
    if (res.status === 404) return 'closed';
    if (res.status === 429) return 'rate';
    return 'error';
  } catch {
    return 'error';
  }
}
