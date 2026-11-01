import 'reflect-metadata';
import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CommunicationMedium, isValidPort } from '@biddaloy/shared';
import type { ProviderDescriptor } from '@biddaloy/shared';
import { OptionalSetting } from './optional-setting.decorator';
import {
  descriptorsFor,
  isPlainObject,
  ownsBlock,
  present,
  soleDescriptorFor,
} from './messaging-descriptors';

const MEDIUM_KEY = Symbol('messagingMedium');
const METERING = ['OFF', 'PLATFORM'];
type Block = Record<string, unknown>;

const isText = (v: unknown) => typeof v === 'string';

function blockProblem(d: ProviderDescriptor, block: unknown): string | null {
  if (!isPlainObject(block)) return 'company settings must be an object.';
  const known = new Set(d.fields.map((f) => f.key));
  for (const key of Object.keys(block)) {
    if (!known.has(key)) return 'has a field this company does not use.';
  }
  for (const f of d.fields) {
    const v = block[f.key];
    if (v === undefined) continue;
    if (f.kind === 'secret') {
      if (v === null) continue;
      if (v === '') {
        return `${f.key} must not be empty: leave it out to keep the saved value, or send null to clear it.`;
      }
      if (!isText(v)) return `${f.key} must be text.`;
    } else if (v === null) {
      // #3331: null removes a saved optional field; a required one cannot be cleared.
      if (f.required) return `${f.key} is required and cannot be cleared.`;
    } else if (!isText(v) && !(f.kind === 'text' && typeof v === 'number' && Number.isFinite(v))) {
      return `${f.key} must be text.`;
    } else if (f.format === 'port' && v !== '' && !isValidPort(v)) {
      // #3322: blank keeps the provider's default port.
      return `${f.key} must be a whole number from 1 to 65535.`;
    }
  }
  return null;
}

/** First problem with a medium's settings, or null. Messages never echo a submitted key or value. */
export function problemWith(value: unknown, medium: CommunicationMedium): string | null {
  if (!isPlainObject(value)) return 'must be an object.';
  const descriptors = descriptorsFor(medium);
  const sole = soleDescriptorFor(medium);
  const names = descriptors.map((d) => d.name);
  const flat = new Set(sole?.fields.map((f) => f.key) ?? []);

  for (const key of Object.keys(value)) {
    const ok =
      key === 'provider' ||
      (key === 'metering' && medium === CommunicationMedium.SMS) ||
      names.includes(key) ||
      flat.has(key);
    if (!ok) return 'has a setting this channel does not use.';
  }
  const flatSent = sole ? Object.keys(value).filter((k) => flat.has(k) && !names.includes(k)) : [];
  if (sole && flatSent.length > 0 && Object.hasOwn(value, sole.name)) {
    return 'mixes the old flat layout with the per-company block; send one.';
  }
  const { provider, metering } = value;
  if (metering !== undefined && (typeof metering !== 'string' || !METERING.includes(metering))) {
    return 'metering must be OFF or PLATFORM.';
  }
  // #3338: "remove saved details": provider null (or the sole company's block null) with every
  // other sent key null too. The merge deletes them. A `metering` sent alongside is still saved:
  // the caller check (platform-only) lives in SchoolsService.updateSettings, #3346.
  // Review round 2 on #3347: every company block must be sent as null. `{provider: null}` alone
  // would delete only the name and leave a saved block that the resolver can still send on.
  if (provider === null || (sole && value[sole.name] === null)) {
    const allNull = Object.entries(value).every(([k, v]) => k === 'metering' || v === null);
    if (!allNull) return 'removes the saved company, so every other value sent must be null.';
    return names.every((n) => value[n] === null)
      ? null
      : 'removes the saved company, so every company block must be sent as null too.';
  }
  if (provider !== undefined && (typeof provider !== 'string' || !names.includes(provider))) {
    return 'names a company that is not available for this channel.';
  }
  if (provider === undefined && !sole) return 'must say which company to use (provider).';

  for (const d of descriptors) {
    if (Object.hasOwn(value, d.name)) {
      const p = blockProblem(d, value[d.name]);
      if (p) return p;
    }
  }
  const flatBlock: Block | undefined =
    sole && flatSent.length > 0
      ? Object.fromEntries(flatSent.map((k) => [k, value[k]]))
      : undefined;
  if (sole && flatBlock) {
    const p = blockProblem(sole, flatBlock);
    if (p) return p;
  }

  const selected = descriptors.find((d) => d.name === (provider ?? sole?.name));
  const chosen = selected
    ? ((Object.hasOwn(value, selected.name) ? value[selected.name] : flatBlock) as
        Block | undefined)
    : undefined;
  // D11: a PLATFORM-metered school with no gateway of its own sends on the platform's account, so
  // its chosen block may be missing or empty. Once it fills in a field it owns the medium (the
  // resolver never pairs a school's field with the platform key), so that block must be complete.
  // Only the chosen company's own block counts (`ownsBlock`, the resolver's rule too).
  if (selected && metering === 'PLATFORM' && !ownsBlock(selected, chosen)) return null;
  if (!selected || !chosen) return 'must include the settings of the chosen company.';
  // Only the chosen company must be complete: another company's block may be a saved draft.
  for (const f of selected.fields) {
    if (f.required && f.kind !== 'secret' && !present(chosen[f.key])) {
      return `is missing the required field ${f.key}.`;
    }
  }
  return null;
}

@ValidatorConstraint({ name: 'messagingMediumSettings', async: false })
export class MessagingMediumSettingsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return problemWith(value, args.constraints[0] as CommunicationMedium) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const p = problemWith(args.value, args.constraints[0] as CommunicationMedium);
    return `communications.${args.property} ${p ?? 'is invalid.'}`;
  }
}

/** Validates one `communications.<medium>` blob against the registered provider descriptors. */
export function MessagingMediumSettings(medium: CommunicationMedium): PropertyDecorator {
  return (target, key) => {
    applyDecorators(
      OptionalSetting(),
      IsObject(),
      Validate(MessagingMediumSettingsConstraint, [medium]),
      ApiPropertyOptional({
        type: 'object',
        additionalProperties: true,
        description:
          'D6: { provider, <company>: {…}, metering? }; fields from GET …/settings/messaging/providers',
      }),
    )(target, key);
    Reflect.defineMetadata(MEDIUM_KEY, medium, target, key);
  };
}

export function getMessagingMedium(
  target: object,
  key: string | symbol,
): CommunicationMedium | undefined {
  return Reflect.getMetadata(MEDIUM_KEY, target, key) as CommunicationMedium | undefined;
}
