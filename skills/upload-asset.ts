import { z } from 'zod';

import { uploadAssetForItem } from '../capture/manual-upload.js';
import { config } from '../config.js';
import { defineSkill } from './types.js';

// Story 6.4 — item-scoped manual asset upload, exposed as a skill (board-mode-agnostic;
// NOT routed through the ingest_mode dispatcher). The graceful path for any item whose
// auto-capture failed: upload a base64 image data URL → stored under screenshotsDir as
// a proper `asset` row.
export const uploadAssetSkill = defineSkill(
  'upload-asset',
  z.object({ itemId: z.string().min(1), dataUrl: z.string().min(1) }),
  z.object({ itemId: z.string(), path: z.string() }),
  async (input, ctx) => {
    const path = await uploadAssetForItem(ctx.db, {
      itemId: input.itemId,
      dataUrl: input.dataUrl,
      screenshotsDir: config.screenshotsDir,
    });
    return { itemId: input.itemId, path };
  },
);
