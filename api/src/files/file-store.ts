import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** §8: images only, 6 MB limit. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
const EXT: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
const BY_EXT: Record<string, ImageType> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };

/** Detects the image type from the file's first bytes; the client's declared type is not trusted. */
export function sniffImage(data: Buffer): ImageType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp' && /^(heic|heix|mif1|msf1|hevc)$/.test(data.toString('ascii', 8, 12))) return 'image/heic';
  return null;
}

export const extensionFor = (type: ImageType) => EXT[type];
const typeOf = (key: string): ImageType | undefined => BY_EXT[key.split('.').pop() ?? ''];

/** Keys are relative paths like "proofs/<gym>/<uuid>.jpg". */
const VALID_KEY = /^[a-z0-9_-]+(\/[A-Za-z0-9._-]+)+$/;

interface Backend {
  save(key: string, data: Buffer, contentType: ImageType): Promise<void>;
  read(key: string): Promise<Buffer | null>;
}

/** §8 development storage: local disk under UPLOAD_DIR. */
export class LocalDiskBackend implements Backend {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  async save(key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key));
    } catch {
      return null;
    }
  }

  private pathOf(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid file key');
    return path;
  }
}

/** The part of the S3 client this store uses (lets tests pass a fake). */
export interface S3Like {
  send(command: PutObjectCommand | GetObjectCommand): Promise<unknown>;
}

/**
 * §8 production storage: an S3-compatible bucket (AWS S3, Cloudflare R2). Objects are
 * private; members' screenshots are only ever served through the API's signed links (§11).
 */
export class S3Backend implements Backend {
  constructor(
    private readonly client: S3Like,
    private readonly bucket: string,
  ) {}

  async save(key: string, data: Buffer, contentType: ImageType): Promise<void> {
    // IfNoneMatch: never overwrite an existing screenshot (same guarantee as the disk store's 'wx').
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, IfNoneMatch: '*' }));
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      const out = (await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))) as {
        Body?: { transformToByteArray(): Promise<Uint8Array> };
      };
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }
}

export function createS3Client(env: Env): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  });
}

/**
 * Where uploaded screenshots are kept (§8 Files): local disk in development,
 * an S3-compatible bucket when S3_BUCKET is set (required in production).
 */
@Injectable()
export class FileStore {
  private readonly backend: Backend;

  constructor(@Inject(ENV) env: Env) {
    this.backend = env.S3_BUCKET ? new S3Backend(createS3Client(env), env.S3_BUCKET) : new LocalDiskBackend(env.UPLOAD_DIR ?? 'uploads');
  }

  /** Test seam: use a specific backend. */
  static with(backend: Backend): FileStore {
    const store = Object.create(FileStore.prototype) as FileStore;
    (store as unknown as { backend: Backend }).backend = backend;
    return store;
  }

  async save(key: string, data: Buffer): Promise<void> {
    const contentType = typeOf(key);
    if (!contentType || !VALID_KEY.test(key)) throw new Error('Invalid file key');
    await this.backend.save(key, data, contentType);
  }

  async read(key: string): Promise<{ data: Buffer; contentType: ImageType } | null> {
    const contentType = typeOf(key);
    if (!contentType || !VALID_KEY.test(key)) return null;
    const data = await this.backend.read(key);
    return data ? { data, contentType } : null;
  }
}
