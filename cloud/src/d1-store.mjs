/** D1-backed store for handler.mjs. All statements are parameterized. */
export function d1Store(db) {
  return {
    async get(hash) {
      const row = await db.prepare("SELECT body, expires_at FROM saves WHERE code_hash = ?").bind(hash).first();
      return row ? { body: new Uint8Array(row.body), expires_at: row.expires_at } : null;
    },
    /** false when the code hash already exists (the caller retries with a new code). */
    async put(row) {
      const result = await db.prepare("INSERT INTO saves (code_hash, body, raw_bytes, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(code_hash) DO NOTHING")
        .bind(row.code_hash, row.body, row.raw_bytes, row.created_at, row.updated_at, row.expires_at).run();
      return (result.meta?.changes ?? 0) > 0;
    },
    async update(hash, row) {
      const result = await db.prepare("UPDATE saves SET body = ?, raw_bytes = ?, updated_at = ?, expires_at = ? WHERE code_hash = ? AND expires_at > ?")
        .bind(row.body, row.raw_bytes, row.updated_at, row.expires_at, hash, row.now).run();
      return (result.meta?.changes ?? 0) > 0;
    },
    async remove(hash) {
      const result = await db.prepare("DELETE FROM saves WHERE code_hash = ?").bind(hash).run();
      return (result.meta?.changes ?? 0) > 0;
    },
    /** Fixed-window counter; true when this request is within the limit. */
    async hit(bucket, windowStart, limit) {
      const row = await db.prepare(
        "INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1) " +
        "ON CONFLICT(bucket) DO UPDATE SET count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END, " +
        "window_start = excluded.window_start RETURNING count").bind(bucket, windowStart).first();
      return (row?.count ?? 1) <= limit;
    },
    async cleanup(now) {
      await db.prepare("DELETE FROM saves WHERE expires_at <= ?").bind(now).run();
      await db.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - 24 * 3600 * 1000).run();
    },
  };
}
