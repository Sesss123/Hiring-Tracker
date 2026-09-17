// MySQL columns are snake_case (job_id, match_score, created_at, ...) but
// the frontend (app.js) was written entirely against camelCase field
// names (jobId, matchScore, createdAt, ...) from its original
// localStorage-object days. Rather than touch every field access across a
// 2500-line frontend file, every route converts its MySQL rows through
// this before calling res.json(), so the API's shape matches exactly what
// app.js already expects. JSON columns (matched_keywords, etc.) are
// already parsed into arrays/objects by mysql2 — this only renames keys,
// it doesn't touch values.
function toCamel(row) {
  if (Array.isArray(row)) return row.map(toCamel);
  if (row === null || typeof row !== "object" || row instanceof Date) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const camelKey = k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    out[camelKey] = v;
  }
  return out;
}

module.exports = { toCamel };
