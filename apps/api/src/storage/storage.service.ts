import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';

import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface StoredFile {
  /** Opaque pointer to the bytes. Never a URL, never user-controlled. */
  storageKey: string;
  checksum: string;
  sizeBytes: number;
}

/**
 * File storage, abstracted behind one small interface.
 *
 * The local-disk implementation below is for development. Production swaps in
 * an S3 or Azure Blob version — nothing outside this file needs to change,
 * because the rest of the app only ever holds a `storageKey`.
 *
 * WHY THE BYTES ARE NOT IN POSTGRES: storing binaries in the database bloats
 * every backup, every restore, and every migration, for no benefit.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    const configured = this.config.get<string>('storage.uploadDir', './uploads');
    this.root = isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  }

  /**
   * Writes a file and returns its pointer.
   *
   * The key is built from a random UUID, NOT the uploaded filename. That
   * matters: a filename like `../../.env` would otherwise let an upload escape
   * the storage directory. Only the extension is taken from the original, and
   * it is stripped of anything that is not alphanumeric.
   */
  async save(buffer: Buffer, originalFilename: string): Promise<StoredFile> {
    const safeExtension = extname(originalFilename)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '')
      .slice(0, 12);

    const storageKey = `${new Date().getUTCFullYear()}/${randomUUID()}${safeExtension}`;
    const absolute = this.toAbsolute(storageKey);

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);

    return {
      storageKey,
      // Proves the file has not changed since upload — the whole point of
      // storing a signed contract.
      checksum: createHash('sha256').update(buffer).digest('hex'),
      sizeBytes: buffer.length,
    };
  }

  createReadStream(storageKey: string): ReadStream {
    return createReadStream(this.toAbsolute(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await unlink(this.toAbsolute(storageKey));
    } catch (error) {
      // A missing file is not worth failing a request over — the metadata row
      // is the source of truth for whether a document "exists".
      this.logger.warn(`Could not delete ${storageKey}: ${(error as Error).message}`);
    }
  }

  /**
   * Resolves a key to a path and refuses anything that escapes the root.
   *
   * Belt and braces: keys are generated internally so they should always be
   * safe, but this is the last line of defence if a key ever comes from
   * somewhere less trustworthy.
   */
  private toAbsolute(storageKey: string): string {
    const absolute = resolve(join(this.root, storageKey));
    if (absolute !== this.root && !absolute.startsWith(this.root + sep)) {
      throw new InternalServerErrorException('Invalid storage key.');
    }
    return absolute;
  }
}
