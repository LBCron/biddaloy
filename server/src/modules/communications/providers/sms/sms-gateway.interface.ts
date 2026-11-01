import { countSmsSegments } from '@biddaloy/shared';

/**
 * [15.6.1] `countSmsSegments` (`@biddaloy/shared`) is now the single
 * ASCII-vs-Unicode call — it was previously duplicated here as a bare
 * `/[^\x00-\x7F]/` regex, separate from the client's segment counter.
 * `isUnicodeMessage` stays as a thin wrapper so both gateways keep the
 * same call shape they had before; `countSmsSegments` itself is what
 * decides unicode billing (matches the gateways' actual behaviour — see
 * the shared module's doc comment for why that's a deliberate deviation
 * from 3GPP TS 23.038).
 */
export function isUnicodeMessage(message: string): boolean {
  return countSmsSegments(message).encoding === 'UCS_2';
}
