import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommunicationStatus } from '@biddaloy/shared';

export class TestMessageOutcomeDto {
  @ApiProperty({ format: 'uuid', description: 'The CommunicationLog row (`metadata.test`).' })
  logId: string;

  @ApiProperty({ enum: CommunicationStatus, enumName: 'CommunicationStatus' })
  status: CommunicationStatus;
}

/** Swagger-only shape for `POST /schools/:id/settings/test`'s 200 response
 * — mirrors `ConnectionTestResult` (`providers/shared/connection-test.types.ts`).
 * The generated schema previously declared this as `Record<string, never>`;
 * nothing constructs an instance of this class, `ProviderConnectionTestController`
 * still returns the plain `ConnectionTestResult` object `ConnectionTestService`
 * produces. */
export class ConnectionTestResultDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;

  @ApiPropertyOptional({
    description: 'Present only when `sendTo` was given and the connection test passed.',
    type: () => TestMessageOutcomeDto,
  })
  testMessage?: TestMessageOutcomeDto;
}
