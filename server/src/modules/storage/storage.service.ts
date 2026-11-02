import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function assertOwnKey(key: string, tenantId: string): void {
  if (!key.startsWith(`tenants/${tenantId}/`) || key.includes('..')) throw new NotFoundException();
}

export interface StoredObject {
  body: Readable;
  contentType: string | undefined;
}

/** Required S3 configuration env vars — checked eagerly so a missing one
 * fails module construction (boot time) rather than surfacing as an opaque
 * SDK error on the first request that happens to touch storage. */
const REQUIRED_ENV_VARS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

export function buildStorageConfig(env: NodeJS.ProcessEnv): StorageConfig {
  for (const name of REQUIRED_ENV_VARS) {
    if (!env[name]) {
      throw new Error(`StorageModule: missing required environment variable ${name}`);
    }
  }

  const endpoint = env.S3_ENDPOINT as string;
  // S3_ENDPOINT carries static credentials on every request — reject
  // plaintext http:// by default. S3_ALLOW_INSECURE_HTTP=true is the
  // explicit opt-in for an approved local/dev endpoint (e.g. the bundled
  // docker-compose SeaweedFS, which sets it — see docker-compose.yml).
  if (endpoint.startsWith('http://') && env.S3_ALLOW_INSECURE_HTTP !== 'true') {
    throw new Error(
      'StorageModule: S3_ENDPOINT uses http:// — set S3_ALLOW_INSECURE_HTTP=true only for an approved local/dev endpoint, or use https://',
    );
  }

  return {
    endpoint,
    region: env.S3_REGION as string,
    bucket: env.S3_BUCKET as string,
    accessKeyId: env.S3_ACCESS_KEY_ID as string,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  };
}

/**
 * Thin wrapper over `S3Client` for tenant object storage. Keys must be
 * built with `tenantObjectKey` (`./storage-key.ts`) — this service does not
 * validate or namespace keys itself, it just moves bytes for whatever key
 * it's given. Bucket paths and presigned URLs are out of scope here; the
 * consumer that serves an object back to a browser is a separate concern
 * (see [15.5.4]).
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Uploads a stream whose size is already known (a temp file's `stat().size`), so a large
   * export never has to sit in memory the way `put`'s Buffer does.
   */
  async putStream(
    key: string,
    body: Readable,
    contentLength: number,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: contentLength,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      body: result.Body as Readable,
      contentType: result.ContentType,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Tenant-facing variants (DATA-02): a stored key can come from a restored workbook,
   * so refuse anything outside `tenants/<tenantId>/` before touching the bucket.
   * 404 without saying why. `get`/`delete` stay for platform callers.
   */
  async getForTenant(key: string, tenantId: string): Promise<StoredObject> {
    assertOwnKey(key, tenantId);
    return this.get(key);
  }

  async deleteForTenant(key: string, tenantId: string): Promise<void> {
    assertOwnKey(key, tenantId);
    return this.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      const name = (error as { name?: string })?.name;
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (name === 'NotFound' || statusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}
