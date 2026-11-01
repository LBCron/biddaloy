/**
 * [Epic 42 / #2520] The "what each field means" table of a guide page, built
 * from one i18n namespace so the words are written once (D19).
 *
 * KEY CONVENTION (in `ui/src/i18n/locales/<lang>/<ns>.json`):
 *   help.<fieldKey>          what to enter. `help.<fieldKey>` explains the
 *                            label at `fields.<fieldKey>` or, when that is absent,
 *                            at `<fieldKey>`.
 *   helpRequired.<fieldKey>  optional. The text of the "Required?" column
 *                            ("Yes", "No - the app asks if any are left").
 *                            Missing means "No".
 *
 * A page that shares a namespace lists only its own fields: `fields:<ns>:<key>,<key>`.
 *
 * A namespace with no `help` block is not managed yet: `buildFieldTable`
 * returns null and the page keeps its hand-written table.
 */
type Json = { [k: string]: unknown };
export type GuideLang = 'bn' | 'en';

const HEADERS: Record<GuideLang, [string, string, string]> = {
  bn: ['ঘর', 'কী লিখবেন', 'বাধ্যতামূলক?'],
  en: ['Field', 'What to enter', 'Required?'],
};
const NO: Record<GuideLang, string> = { bn: 'না', en: 'No' };

// Backslash first, so a `\|` in the source stays a literal backslash followed by an escaped pipe.
const cell = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function buildFieldTable(
  ns: Json,
  lang: GuideLang,
  nsName = '?',
  only?: string[],
): string | null {
  const help = ns.help;
  if (!help || typeof help !== 'object') return null;
  const required = (ns.helpRequired ?? {}) as Json;
  const fields = (ns.fields ?? {}) as Json;
  const rows = Object.entries(help as Json)
    // A nested object (`help.messaging.<company>.<field>`) is looked up by key at run time,
    // not a field row.
    .filter(([, text]) => typeof text !== 'object' || text === null)
    .filter(([key]) => !only || only.includes(key))
    .map(([key, text]) => {
      const label = str(fields[key]) ?? str(ns[key]);
      const body = str(text);
      if (label === undefined || body === undefined)
        throw new Error(
          `${nsName}.json (${lang}): help.${key} needs a string and a label at "${key}" or "fields.${key}"`,
        );
      return `| ${cell(label)} | ${cell(body)} | ${cell(str(required[key]) ?? NO[lang])} |`;
    });
  const [a, b, c] = HEADERS[lang];
  return [`| ${a} | ${b} | ${c} |`, '| --- | --- | --- |', ...rows].join('\n');
}
