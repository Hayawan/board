import { randomUUID } from 'node:crypto';

import { suggestionOverrides, type SuggestionOverride } from './schema.js';
import type { DbHandle } from './index.js';

// Story 14.3 — capture an assignment CHOICE as a future-suggestion-quality signal.
// Additive only: writes to the `suggestion_override` table, never touches item/board.

export interface AssignmentChoice {
  itemId: string;
  /** the AI-suggested board, or null when no suggestion was shown (manual picker). */
  suggestedBoardId: string | null;
  /** the board the user actually assigned to. */
  chosenBoardId: string;
}

/**
 * Record a TRUE override only: a suggestion existed AND the user chose a different
 * board. A confirm (chosen === suggested) and a manual pick (no suggestion) record
 * nothing — they're not override signal.
 */
export function recordAssignmentChoice(handle: DbHandle, choice: AssignmentChoice): { recorded: boolean } {
  if (!choice.suggestedBoardId || choice.suggestedBoardId === choice.chosenBoardId) {
    return { recorded: false };
  }
  handle.db
    .insert(suggestionOverrides)
    .values({
      id: randomUUID(),
      itemId: choice.itemId,
      suggestedBoardId: choice.suggestedBoardId,
      chosenBoardId: choice.chosenBoardId,
    })
    .run();
  return { recorded: true };
}

/** All recorded overrides (for future suggestion tuning / tests). */
export function listOverrides(handle: DbHandle): SuggestionOverride[] {
  return handle.db.select().from(suggestionOverrides).all();
}
