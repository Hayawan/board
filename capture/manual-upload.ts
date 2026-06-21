import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { eq } from 'drizzle-orm';

import { items, type NewAsset } from '../db/schema.js';
import { writeItem } from '../db/queue.js';
import type { DbHandle } from '../db/index.js';

// Story 6.4 — manual asset upload: the graceful escape hatch (FR-5) when auto-capture
// fails (paywalls, bot-walls, dead sites). It is an ITEM-SCOPED, board-mode-agnostic
// asset-write — NOT routed through the ingest_mode dispatcher (a url-screenshot board
// whose capture failed can still receive an upload). The uploaded image is stored as
// a proper `asset` row (item 0..n asset), same table + `/screenshots/` serving as a
// captured screenshot. Ports the prototype's base64-dataURL decode.

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // matches the 20MB body limit (server.ts)

/** Decode + validate a base64 image data URL. Throws (no write) on non-image/oversized. */
export function decodeImageDataUrl(
  dataUrl: string,
  maxBytes: number = MAX_UPLOAD_BYTES,
): { buffer: Buffer; ext: string; mime: string } {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) {
    throw new Error('Upload must be a base64 image data URL (data:image/...;base64,...)');
  }
  const mime = m[1];
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length === 0) {
    throw new Error('Upload is empty or not valid base64');
  }
  if (buffer.length > maxBytes) {
    throw new Error(`Upload exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit`);
  }
  const subtype = mime.slice('image/'.length).toLowerCase();
  const ext = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/g, '') || 'png';
  return { buffer, ext, mime };
}

/**
 * Store an uploaded image for an existing item: decode+validate, write the file under
 * `screenshotsDir` (Story 2.2), and create the linked `asset` row via the typed
 * item-write helper (which replaces the item's assets — one image per item, no
 * duplicate on re-upload). Returns the stored relative path. Throws (no write) on a
 * non-image/oversized upload or an unknown item.
 */
export async function uploadAssetForItem(
  handle: DbHandle,
  args: { itemId: string; dataUrl: string; screenshotsDir: string; maxBytes?: number },
): Promise<string> {
  const { buffer, ext } = decodeImageDataUrl(args.dataUrl, args.maxBytes ?? MAX_UPLOAD_BYTES);

  const item = handle.db.select().from(items).where(eq(items.id, args.itemId)).get();
  if (!item) {
    throw new Error(`Cannot upload: unknown item "${args.itemId}"`);
  }

  const filename = `${args.itemId}.${ext}`;
  const abs = join(args.screenshotsDir, filename);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buffer);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const path = `screenshots/${filename}`; // relative form (Story 2.2)

  const asset: NewAsset = { id: `${args.itemId}-upload`, itemId: args.itemId, kind: 'screenshot', path, hash };
  await writeItem(handle, { ...item, id: args.itemId, boardId: item.boardId }, [asset]);

  return path;
}
