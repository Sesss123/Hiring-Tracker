const express = require("express");
const asyncHandler = require("../asyncHandler");
const pool = require("../db/pool");
const { requireAuth } = require("../auth/middleware");

const router = express.Router();

// GET /api/reports/trends — any logged-in staff. Closes the "Trends" gap
// in the Reporting Dashboard (Reports() in app.js), which previously had
// only point-in-time stat cards and no over-time view. Groups applicants
// (by applied_at), interviews (by scheduled_at) and decisions (by
// decided_at) into weekly buckets over the last `weeks` weeks (default
// 12), so the frontend can draw a simple line/bar chart without doing its
// own date-bucketing client-side.
router.get("/trends", requireAuth, asyncHandler(async (req, res) => {
  const weeks = Math.min(Math.max(Number(req.query.weeks) || 12, 1), 52);

  const [applicantRows] = await pool.query(
    `SELECT DATE(applied_at) AS d FROM applicants WHERE applied_at >= DATE_SUB(NOW(), INTERVAL :weeks WEEK)`,
    { weeks }
  );
  const [interviewRows] = await pool.query(
    `SELECT DATE(scheduled_at) AS d FROM interviews WHERE scheduled_at >= DATE_SUB(NOW(), INTERVAL :weeks WEEK)`,
    { weeks }
  );
  const [decisionRows] = await pool.query(
    `SELECT DATE(decided_at) AS d, decision FROM decisions WHERE decided_at >= DATE_SUB(NOW(), INTERVAL :weeks WEEK)`,
    { weeks }
  );

  // ISO week key (Monday-start), e.g. "2026-W07" — buckets by calendar
  // week rather than raw date so the chart has a manageable number of
  // points even over a many-week range.
  function weekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  }

  const buckets = {};
  function bump(dateVal, field) {
    const key = weekKey(new Date(dateVal));
    if (!buckets[key]) buckets[key] = { week: key, applicants: 0, interviews: 0, hired: 0, rejected: 0 };
    buckets[key][field] += 1;
  }
  applicantRows.forEach((r) => bump(r.d, "applicants"));
  interviewRows.forEach((r) => bump(r.d, "interviews"));
  decisionRows.forEach((r) => bump(r.d, r.decision === "Hired" ? "hired" : "rejected"));

  const trend = Object.values(buckets).sort((a, b) => a.week.localeCompare(b.week));
  res.json(trend);
}));

module.exports = router;
