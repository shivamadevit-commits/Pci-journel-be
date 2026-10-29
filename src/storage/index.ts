import fs from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  ping(): Promise<boolean>;
}

class LocalStorage implements StorageDriver {
  private readonly root = path.resolve(env.LOCAL_STORAGE_DIR);

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, { flag: 'wx' });
  }
  get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
  async ping(): Promise<boolean> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.access(this.root);
      return true;
    } catch {
      return false;
    }
  }
}

/** OCI Object Storage through its S3-compatible API (private bucket; objects are only served via authorised API calls). */
class OciStorage implements StorageDriver {
  private readonly bucket = env.OCI_OS_BUCKET!;
  private readonly client = new S3Client({
    region: env.OCI_OS_REGION!,
    endpoint: env.OCI_OS_ENDPOINT ?? `https://${env.OCI_OS_NAMESPACE}.compat.objectstorage.${env.OCI_OS_REGION}.oraclecloud.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: env.OCI_OS_ACCESS_KEY_ID!, secretAccessKey: env.OCI_OS_SECRET_ACCESS_KEY! },
    // OCI's S3 compatibility layer does not support the newer default checksum behaviour.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

export const storage: StorageDriver = env.STORAGE_DRIVER === 'oci' ? new OciStorage() : new LocalStorage();
