const express = require("express");
const asyncHandler = require("../asyncHandler");
const pool = require("../db/pool");
const { toCamel } = require("../camelCase");
const { requireAuth, requireRole } = require("../auth/middleware");

const router = express.Router();

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// POST /api/interviews — HR only (submitSchedule() in app.js).
//
// DELIBERATE FIX, flagged per the project's TRACE-DON'T-INVENT rule:
// the real app.js silently does nothing if interviewer_id or
// scheduled_at is missing —
//   if (!scheduleForm.interviewer_id || !scheduleForm.scheduled_at) return;
// with no error shown to HR. That was flagged as a known bug/risk
// throughout this project. This backend does NOT reproduce that bug: it
// returns a real 400 validation error instead, since silently swallowing
// a missing required field server-side would just move the same problem
// behind an API instead of fixing it.
router.post("/", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const { candidateId, interviewerId, scheduledAt, notes } = req.body || {};
  if (!candidateId || !interviewerId || !scheduledAt) {
    return res.status(400).json({ error: "candidateId, interviewerId and scheduledAt are all required." });
  }

  const [applicantRows] = await pool.query("SELECT id FROM applicants WHERE id = :id", { id: candidateId });
  if (!applicantRows.length) return res.status(404).json({ error: "Candidate (applicant) not found." });

  const [interviewerRows] = await pool.query(
    "SELECT id FROM users WHERE id = :id AND role = 'interviewer'", { id: interviewerId }
  );
  if (!interviewerRows.length) return res.status(400).json({ error: "interviewerId must be a real user with role 'interviewer'." });

  const id = uid("iv");
  await pool.query(
    "INSERT INTO interviews (id, candidate_id, interviewer_id, scheduled_at, status, notes) VALUES (:id, :candidateId, :interviewerId, :scheduledAt, 'Scheduled', :notes)",
    { id, candidateId, interviewerId, scheduledAt, notes: notes || null }
  );
  await pool.query("UPDATE applicants SET status = 'Interview Scheduled' WHERE id = :id", { id: candidateId });

  const [rows] = await pool.query("SELECT * FROM interviews WHERE id = :id", { id });
  res.status(201).json(toCamel(rows[0]));
}));

// GET /api/interviews — logged-in staff only.
// - interviewer role: only their own assigned interviews (matches
//   InterviewerDashboard filtering load(KEYS.interviews) by interviewerId).
// - hr / manager: everything (matches the HR/Manager dashboards, which
//   read the full interviews list).
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role === "interviewer") {
    const [rows] = await pool.query("SELECT * FROM interviews WHERE interviewer_id = :id ORDER BY scheduled_at", { id: req.user.id });
    return res.json(toCamel(rows));
  }
  const [rows] = await pool.query("SELECT * FROM interviews ORDER BY scheduled_at");
  res.json(toCamel(rows));
}));

module.exports = router;
