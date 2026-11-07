/** `https://` links only: a value that is not a plain https URL never becomes an href. */
export function httpsLink(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** WhatsApp number or link -> `https://wa.me/<digits>`; anything with no digits -> nothing. */
export function whatsappLink(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const direct = httpsLink(v);
  if (direct)
    return /^https:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//.test(direct)
      ? direct
      : undefined;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : undefined;
}

/**
 * Keyless map embed (V12): a lat/long pair wins, else the address text. No API key, no script.
 */
export function mapEmbed(
  lat: unknown,
  lng: unknown,
  address: string | undefined,
): string | undefined {
  const n = (x: unknown) =>
    typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN;
  const la = n(lat);
  const lo = n(lng);
  const q =
    Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180
      ? `${la},${lo}`
      : address;
  return q ? `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed` : undefined;
}

/** A link or number field: the admin screens store bilingual text, older data a plain string. Both read as one string. */
export function plainValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  const t = v as { bn?: unknown; en?: unknown } | null;
  const s = [t?.bn, t?.en].find((x) => typeof x === 'string' && x.trim() !== '');
  return typeof s === 'string' ? s : undefined;
}
