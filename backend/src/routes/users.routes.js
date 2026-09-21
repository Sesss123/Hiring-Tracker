const express = require("express");
const asyncHandler = require("../asyncHandler");
const pool = require("../db/pool");
const { toCamel } = require("../camelCase");
const { requireAuth } = require("../auth/middleware");

const router = express.Router();

// GET /api/users — any logged-in staff member. Added once wiring the
// frontend showed several places genuinely need this (ApplicantsTab's
// interviewer dropdown, and interviewer/decided-by name lookups in
// InterviewsTab, ReviewCandidates and DecisionLog) — the old app read
// load(KEYS.users) directly with no restriction at all. password_hash is
// never included in the response. ?role=interviewer filters, matching
// the old app's `.filter(u => u.role === "interviewer")` call sites.
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const sql = req.query.role
    ? "SELECT id, name, email, role, job_title, created_at FROM users WHERE role = :role ORDER BY name"
    : "SELECT id, name, email, role, job_title, created_at FROM users ORDER BY name";
  const [rows] = await pool.query(sql, { role: req.query.role });
  res.json(toCamel(rows));
}));

module.exports = router;
