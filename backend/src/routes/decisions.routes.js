const express = require("express");
const asyncHandler = require("../asyncHandler");
const pool = require("../db/pool");
const { toCamel } = require("../camelCase");
const { requireAuth, requireRole } = require("../auth/middleware");

const router = express.Router();

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// GET /api/decisions — any logged-in staff. Bulk list of every decision
// (DecisionLog in app.js reads load(KEYS.decisions) with no filter at
// all — added once wiring the frontend showed the single-lookup endpoint
// below wasn't enough for that screen).
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM decisions ORDER BY decided_at DESC");
  res.json(toCamel(rows));
}));

// POST /api/decisions/applicants/:id — manager only (makeDecision() inside
// ReviewCandidates, which only ManagerDashboard renders).
router.post("/applicants/:id", requireAuth, requireRole("manager"), asyncHandler(async (req, res) => {
  const { decision, notes } = req.body || {};
  if (!["Hired", "Rejected"].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'Hired' or 'Rejected'." });
  }

  const [appRows] = await pool.query("SELECT id, status FROM applicants WHERE id = :id", { id: req.params.id });
  if (!appRows.length) return res.status(404).json({ error: "Candidate (applicant) not found." });
  if (["Hired", "Rejected"].includes(appRows[0].status)) {
    return res.status(409).json({ error: `A decision has already been recorded for this candidate (${appRows[0].status}).` });
  }

  const id = uid("dec");
  await pool.query(
    "INSERT INTO decisions (id, candidate_id, decision, notes, decided_by) VALUES (:id, :candidateId, :decision, :notes, :decidedBy)",
    { id, candidateId: req.params.id, decision, notes: notes || null, decidedBy: req.user.id }
  );
  await pool.query("UPDATE applicants SET status = :status WHERE id = :id", { id: req.params.id, status: decision });

  const [rows] = await pool.query("SELECT * FROM decisions WHERE id = :id", { id });
  res.status(201).json(toCamel(rows[0]));
}));

// GET /api/decisions/applicants/:id — any logged-in staff member.
router.get("/applicants/:id", requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM decisions WHERE candidate_id = :id ORDER BY decided_at DESC LIMIT 1", { id: req.params.id }
  );
  if (!rows.length) return res.status(404).json({ error: "No decision recorded yet." });
  res.json(toCamel(rows[0]));
}));

// DELETE /api/decisions/applicants/:id — manager only. Reverses a
// Hired/Rejected decision: removes the decision record and restores the
// applicant's status to what it was before the decision (interviewed if
// any interview took place, otherwise back to their last shortlist/apply
// stage). Added to close a known gap: previously a decision was
// permanent, so a manager's mis-click had no way back short of editing
// the database directly.
router.delete("/applicants/:id", requireAuth, requireRole("manager"), asyncHandler(async (req, res) => {
  const [appRows] = await pool.query("SELECT id, status FROM applicants WHERE id = :id", { id: req.params.id });
  if (!appRows.length) return res.status(404).json({ error: "Candidate (applicant) not found." });
  if (!["Hired", "Rejected"].includes(appRows[0].status)) {
    return res.status(409).json({ error: "This candidate has no active decision to undo." });
  }

  const [interviewRows] = await pool.query(
    "SELECT id FROM interviews WHERE candidate_id = :id LIMIT 1", { id: req.params.id }
  );
  const [candidateRows] = await pool.query(
    "SELECT id FROM candidates WHERE applicant_id = :id LIMIT 1", { id: req.params.id }
  );
  const restoredStatus = interviewRows.length ? "Interviewed" : candidateRows.length ? "Shortlisted" : "Applied";

  await pool.query("DELETE FROM decisions WHERE candidate_id = :id", { id: req.params.id });
  await pool.query("UPDATE applicants SET status = :status WHERE id = :id", { id: req.params.id, status: restoredStatus });

  res.json({ restoredStatus });
}));

module.exports = router;
