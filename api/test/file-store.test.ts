import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { FileStore, LocalDiskBackend, S3Backend, type S3Like } from '../src/files/file-store';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/** In-memory stand-in for an S3-compatible bucket (no network). */
function fakeBucket() {
  const objects = new Map<string, { body: Buffer; type?: string }>();
  const calls: unknown[] = [];
  const client: S3Like = {
    async send(command) {
      calls.push(command);
      if (command instanceof PutObjectCommand) {
        const { Key, Body, ContentType, IfNoneMatch } = command.input;
        if (IfNoneMatch === '*' && objects.has(Key!)) throw Object.assign(new Error('exists'), { name: 'PreconditionFailed' });
        objects.set(Key!, { body: Body as Buffer, type: ContentType });
        return {};
      }
      const found = objects.get((command as GetObjectCommand).input.Key!);
      if (!found) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { Body: { transformToByteArray: async () => new Uint8Array(found.body) } };
    },
  };
  return { client, objects, calls };
}

describe('§8 file storage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-files-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('S3-compatible bucket: private objects with the image type, never overwritten, missing keys read as null', async () => {
    const bucket = fakeBucket();
    const store = FileStore.with(new S3Backend(bucket.client, 'gym-proofs'));
    await store.save('proofs/ironhouse/a1.png', PNG);
    expect(bucket.objects.get('proofs/ironhouse/a1.png')).toMatchObject({ type: 'image/png' });
    expect((bucket.calls[0] as PutObjectCommand).input).toMatchObject({ Bucket: 'gym-proofs', IfNoneMatch: '*' });
    expect((bucket.calls[0] as PutObjectCommand).input).not.toHaveProperty('ACL');
    await expect(store.save('proofs/ironhouse/a1.png', PNG)).rejects.toThrow();
    expect(await store.read('proofs/ironhouse/a1.png')).toEqual({ data: PNG, contentType: 'image/png' });
    expect(await store.read('proofs/ironhouse/none.png')).toBeNull();
  });

  it('local disk (development): same behaviour', async () => {
    const store = FileStore.with(new LocalDiskBackend(dir));
    await store.save('proofs/ironhouse/b1.png', PNG);
    await expect(store.save('proofs/ironhouse/b1.png', PNG)).rejects.toThrow();
    expect(await store.read('proofs/ironhouse/b1.png')).toEqual({ data: PNG, contentType: 'image/png' });
  });

  it('refuses keys that are not image paths or try to leave the store', async () => {
    const store = FileStore.with(new S3Backend(fakeBucket().client, 'b'));
    await expect(store.save('../etc/passwd.png', PNG)).rejects.toThrow('Invalid file key');
    await expect(store.save('proofs/x/file.exe', PNG)).rejects.toThrow('Invalid file key');
    expect(await store.read('proofs/../../x.png')).toBeNull();
  });
});
