import { ApiProperty } from '@nestjs/swagger';
import { DocumentsSettingsDto, RegionSettingsDto } from './tenant-settings.dto';

/**
 * Swagger-only shapes for `GET`/`PATCH /schools/:id/settings` — the
 * generated schema previously declared these responses as
 * `Record<string, never>` (an empty object placeholder), because nothing
 * annotated the controller with a concrete response type. These classes
 * exist purely to describe the shape `SchoolsService.getMaskedSettings`
 * actually returns (`settings-mask.util.ts`'s `MaskedSecret` in place of
 * every `@Secret()` field) — the controller still returns the plain
 * object that function produces, not an instance of these classes; there
 * is no `ClassSerializerInterceptor` in this app, so nothing here affects
 * runtime behavior, only the generated `ui/src/api/schema.d.ts` types.
 *
 * `region` and `documents` are untouched here and reuse `RegionSettingsDto` /
 * `DocumentsSettingsDto` directly — they carry no secrets, so their read and
 * write shapes are identical.
 */
export class MaskedSecretResponseDto {
  @ApiProperty()
  configured: boolean;

  @ApiProperty({ required: false })
  hint?: string;
}

export class MaskedCommunicationsSettingsResponseDto {
  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: true,
    description: 'D6 shape; each schema secret is a MaskedSecretResponseDto',
  })
  sms?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: true,
    description: 'D6 shape; each schema secret is a MaskedSecretResponseDto',
  })
  whatsapp?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: true,
    description: 'D6 shape; each schema secret is a MaskedSecretResponseDto',
  })
  email?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: true,
    description: 'D6 shape; each schema secret is a MaskedSecretResponseDto',
  })
  messenger?: Record<string, unknown>;
}

class LocalizedLabelResponseDto {
  @ApiProperty() en: string;
  @ApiProperty() bn: string;
}

export class ProviderConfigFieldResponseDto {
  @ApiProperty() key: string;
  @ApiProperty({ type: LocalizedLabelResponseDto }) label: LocalizedLabelResponseDto;
  @ApiProperty({ enum: ['text', 'url', 'secret'] }) kind: 'text' | 'url' | 'secret';
  @ApiProperty() required: boolean;
  @ApiProperty({ required: false }) advanced?: boolean;
  @ApiProperty({ required: false }) destination?: boolean;
  @ApiProperty({ required: false }) owned?: boolean;
  @ApiProperty({ required: false }) sendOnly?: boolean;
  @ApiProperty({ required: false, enum: ['port'] }) format?: 'port';
}

export class ProviderDescriptorResponseDto {
  @ApiProperty() medium: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: LocalizedLabelResponseDto }) label: LocalizedLabelResponseDto;
  @ApiProperty({ type: [String] }) capabilities: string[];
  @ApiProperty({ type: [ProviderConfigFieldResponseDto] }) fields: ProviderConfigFieldResponseDto[];
  @ApiProperty() supportsTestMessage: boolean;
}

export class MessagingMediumProvidersResponseDto {
  @ApiProperty({ type: [ProviderDescriptorResponseDto] })
  providers: ProviderDescriptorResponseDto[];
  @ApiProperty({
    description:
      "Presence only: the selected company's required fields are saved on this school. It ignores the platform-wide fallback (env keys), so false does not mean a send will fail.",
  })
  configured: boolean;
  @ApiProperty({ type: String, nullable: true }) selected: string | null;
}

export class MessagingProvidersResponseDto {
  @ApiProperty({ type: MessagingMediumProvidersResponseDto, required: false })
  SMS?: MessagingMediumProvidersResponseDto;
  @ApiProperty({ type: MessagingMediumProvidersResponseDto, required: false })
  WHATSAPP?: MessagingMediumProvidersResponseDto;
  @ApiProperty({ type: MessagingMediumProvidersResponseDto, required: false })
  EMAIL?: MessagingMediumProvidersResponseDto;
  @ApiProperty({ type: MessagingMediumProvidersResponseDto, required: false })
  MESSENGER?: MessagingMediumProvidersResponseDto;
}

export class TenantSettingsResponseDto {
  @ApiProperty()
  version: number;

  @ApiProperty({ type: RegionSettingsDto, required: false })
  region?: RegionSettingsDto;

  @ApiProperty({ type: MaskedCommunicationsSettingsResponseDto, required: false })
  communications?: MaskedCommunicationsSettingsResponseDto;

  @ApiProperty({ type: DocumentsSettingsDto, required: false })
  documents?: DocumentsSettingsDto;
}
