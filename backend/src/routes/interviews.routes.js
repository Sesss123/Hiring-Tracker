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
// PB-16 (Schedule Interview) and PB-17 (Assign Interviewer) are now real,
// separate steps: interviewerId is optional here — HR can schedule a
// date/time with no interviewer picked yet, then assign one later via
// PATCH /:id/interviewer below. Passing interviewerId at schedule time
// still works in one call, same as before, for HR who want to do both at
// once.
//
// DELIBERATE FIX, flagged per the project's TRACE-DON'T-INVENT rule:
// the real app.js silently does nothing if interviewer_id or
// scheduled_at is missing —
//   if (!scheduleForm.interviewer_id || !scheduleForm.scheduled_at) return;
// with no error shown to HR. That was flagged as a known bug/risk
// throughout this project. This backend does NOT reproduce that bug: it
// returns a real 400 validation error instead, since silently swallowing
// a missing required field server-side would just move the same problem
// behind an API instead of fixing it. scheduledAt is still required now;
// only interviewerId became optional.
router.post("/", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const { candidateId, interviewerId, scheduledAt, notes } = req.body || {};
  if (!candidateId || !scheduledAt) {
    return res.status(400).json({ error: "candidateId and scheduledAt are required." });
  }

  const [applicantRows] = await pool.query("SELECT id, name FROM applicants WHERE id = :id", { id: candidateId });
  if (!applicantRows.length) return res.status(404).json({ error: "Candidate (applicant) not found." });

  if (interviewerId) {
    const [interviewerRows] = await pool.query(
      "SELECT id FROM users WHERE id = :id AND role = 'interviewer'", { id: interviewerId }
    );
    if (!interviewerRows.length) return res.status(400).json({ error: "interviewerId must be a real user with role 'interviewer'." });
  }

  const id = uid("iv");
  await pool.query(
    "INSERT INTO interviews (id, candidate_id, interviewer_id, scheduled_at, status, notes) VALUES (:id, :candidateId, :interviewerId, :scheduledAt, 'Scheduled', :notes)",
    { id, candidateId, interviewerId: interviewerId || null, scheduledAt, notes: notes || null }
  );
  await pool.query("UPDATE applicants SET status = 'Interview Scheduled' WHERE id = :id", { id: candidateId });

  // Closes PB-24 (Notify Assigned Interviewer) — previously zero code.
  // In-app notification, not email, so this project has no third-party
  // email service dependency; the interviewer sees it on their next login.
  // Only fires here if an interviewer was picked at schedule time — if
  // assigned later via PATCH /:id/interviewer, that route notifies instead.
  if (interviewerId) {
    await pool.query(
      "INSERT INTO notifications (id, user_id, message, interview_id) VALUES (:id, :userId, :message, :interviewId)",
      {
        id: uid("notif"), userId: interviewerId, interviewId: id,
        message: `You've been assigned to interview ${applicantRows[0].name} on ${new Date(scheduledAt).toLocaleString()}.`,
      }
    );
  }

  const [rows] = await pool.query("SELECT * FROM interviews WHERE id = :id", { id });
  res.status(201).json(toCamel(rows[0]));
}));

// PATCH /api/interviews/:id/interviewer — HR only. PB-17 (Assign
// Interviewer) as a real, separate step from scheduling: picks or changes
// the interviewer on an already-scheduled interview and notifies them
// (PB-24) at the moment they're actually assigned.
router.patch("/:id/interviewer", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const { interviewerId } = req.body || {};
  if (!interviewerId) return res.status(400).json({ error: "interviewerId is required." });

  const [interviewRows] = await pool.query(
    "SELECT i.id, i.scheduled_at, a.name AS candidate_name FROM interviews i JOIN applicants a ON a.id = i.candidate_id WHERE i.id = :id",
    { id: req.params.id }
  );
  if (!interviewRows.length) return res.status(404).json({ error: "Interview not found." });

  const [interviewerRows] = await pool.query(
    "SELECT id FROM users WHERE id = :id AND role = 'interviewer'", { id: interviewerId }
  );
  if (!interviewerRows.length) return res.status(400).json({ error: "interviewerId must be a real user with role 'interviewer'." });

  await pool.query("UPDATE interviews SET interviewer_id = :interviewerId WHERE id = :id", { id: req.params.id, interviewerId });

  const interview = interviewRows[0];
  await pool.query(
    "INSERT INTO notifications (id, user_id, message, interview_id) VALUES (:id, :userId, :message, :interviewId)",
    {
      id: uid("notif"), userId: interviewerId, interviewId: req.params.id,
      message: `You've been assigned to interview ${interview.candidate_name} on ${new Date(interview.scheduled_at).toLocaleString()}.`,
    }
  );

  const [rows] = await pool.query("SELECT * FROM interviews WHERE id = :id", { id: req.params.id });
  res.json(toCamel(rows[0]));
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
