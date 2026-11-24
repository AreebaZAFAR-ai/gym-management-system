import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
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

/**
 * Where uploaded screenshots are kept. Local disk (development, §8). Keys are
 * relative paths like "proofs/<gym>/<uuid>.jpg"; files are only ever served
 * through signed links. Production S3-compatible storage is not wired up yet.
 */
@Injectable()
export class FileStore {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.UPLOAD_DIR ?? 'uploads');
  }

  async save(key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }

  async read(key: string): Promise<{ data: Buffer; contentType: ImageType } | null> {
    const contentType = BY_EXT[key.split('.').pop() ?? ''];
    if (!contentType) return null;
    try {
      return { data: await readFile(this.pathOf(key)), contentType };
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
