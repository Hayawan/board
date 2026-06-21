import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Story 1.1 — board / item / asset tables (schema-as-data foundation).
//
// Design notes (see docs/bmad/stories/1-1-sqlite-drizzle-schema.md):
// - `id` columns are caller-supplied TEXT primary keys (NOT autoincrement) so 1.2
//   can seed stable "inspiration"/"library" ids and 1.5 can preserve original ids.
// - `created_at`/`updated_at`/`captured_at` accept an explicit value on insert and
//   fall back to unixepoch() when omitted (AC 3).
// - `board.descriptor` and `item.fields` are JSON (text mode:'json') so they
//   round-trip as structured objects (AC 4).
// - `search_blob` is a plain text column here; the FTS5 virtual table is Story 1.4.
// - Per-field columns are intentionally avoided — one `item.fields` JSON bag for all
//   boards (AD9, schema-as-data). Do NOT add inspiration_item / library_item tables.

export const boards = sqliteTable('board', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  view: text('view').notNull(),
  descriptor: text('descriptor', { mode: 'json' }),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
});

export const items = sqliteTable(
  'item',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    source: text('source'),
    title: text('title'),
    status: text('status').notNull().default('pending'),
    errorReason: text('error_reason'),
    favorite: integer('favorite').notNull().default(0),
    notes: text('notes'),
    fields: text('fields', { mode: 'json' }),
    searchBlob: text('search_blob'),
    analysisProvider: text('analysis_provider'),
    analysisModel: text('analysis_model'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    // The four system-column indexes (AC 5 / NFR-2). json_extract/tags index
    // promotion is deferred (PRD Open Question #1) — do not add it here.
    index('idx_item_board_id').on(t.boardId),
    index('idx_item_status').on(t.status),
    index('idx_item_favorite').on(t.favorite),
    index('idx_item_created_at').on(t.createdAt),
  ],
);

export const assets = sqliteTable('asset', {
  id: text('id').primaryKey(),
  itemId: text('item_id')
    .notNull()
    .references(() => items.id),
  kind: text('kind').notNull(),
  path: text('path').notNull(),
  width: integer('width'),
  height: integer('height'),
  hash: text('hash'),
  capturedAt: integer('captured_at').notNull().default(sql`(unixepoch())`),
});

export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
