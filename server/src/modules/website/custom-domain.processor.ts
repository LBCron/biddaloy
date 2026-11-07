import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { isDemoMode } from '../demo/demo-mode';
import { CustomDomainService } from './custom-domain.service';

export const CUSTOM_DOMAIN_QUEUE = 'site-custom-domain';
const JOB_ID = 'site-custom-domain-poll';

/** Every 10 min: ask Cloudflare about each PENDING_* custom hostname (D35). Off when custom domains are off. */
@Injectable()
@Processor(CUSTOM_DOMAIN_QUEUE)
export class CustomDomainProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CustomDomainProcessor.name);

  constructor(
    @InjectQueue(CUSTOM_DOMAIN_QUEUE) private readonly queue: Queue,
    private readonly domains: CustomDomainService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (isDemoMode() || !this.domains.isEnabled()) {
      await this.queue.removeJobScheduler(JOB_ID);
      return;
    }
    // One attempt per tick: the next tick (10 min) is the retry, so there is no retry storm on a Cloudflare outage.
    await this.queue.upsertJobScheduler(
      JOB_ID,
      { every: 10 * 60 * 1000 },
      { opts: { removeOnComplete: true, removeOnFail: 100, attempts: 1 } },
    );
  }

  async process(): Promise<void> {
    const n = await this.domains.pollPending();
    if (n) this.logger.log(`custom domain poll checked ${n} hostname(s)`);
  }
}
