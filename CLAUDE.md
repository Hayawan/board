# board

## Scripts

- `scripts/inspect-bookmarks.mjs` — read-only inspector for `bookmarks.json`. Iterates the bookmarks array and prints chosen properties (dot-notation supported) as TSV, one bookmark per line. Use it before reaching for `Read` on the whole 370KB file.

  ```bash
  node scripts/inspect-bookmarks.mjs title meta.category
  node scripts/inspect-bookmarks.mjs meta.category | sort | uniq -c | sort -rn
  ```

  Read the JSDoc at the top of the file for the full usage. Writes are not yet supported.
