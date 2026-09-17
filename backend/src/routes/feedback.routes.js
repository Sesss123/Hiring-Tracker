const express = require("express");
const asyncHandler = require("../asyncHandler");
const pool = require("../db/pool");
const { toCamel } = require("../camelCase");
const { requireAuth, requireRole } = require("../auth/middleware");

const router = express.Router();

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// GET /api/feedback — any logged-in staff. Bulk list of every feedback
// row. Added once wiring the frontend showed InterviewsTab, DecisionLog
// and ManagerDashboard/ReviewCandidates all need to look up feedback
// across many interviews at once (feedbackFor(interviewId) called in a
// loop), not one interview at a time — matching the old app's
// load(KEYS.feedback) with no filter.
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM feedback ORDER BY created_at DESC");
  res.json(toCamel(rows));
}));

// POST /api/feedback/interviews/:interviewId — interviewer only
// (submitFeedback() in app.js). Upserts (the old app re-used the record
// if feedback already existed for that interview), then marks the
// interview Completed and the applicant's status Interviewed — same two
// side effects as the original function.
router.post("/interviews/:interviewId", requireAuth, requireRole("interviewer"), asyncHandler(async (req, res) => {
  const { rating, recommendation, comments } = req.body || {};
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: "rating must be an integer from 1 to 5." });
  }
  if (!["Hire", "Maybe", "No Hire"].includes(recommendation)) {
    return res.status(400).json({ error: "recommendation must be one of: Hire, Maybe, No Hire." });
  }

  const [ivRows] = await pool.query("SELECT * FROM interviews WHERE id = :id", { id: req.params.interviewId });
  if (!ivRows.length) return res.status(404).json({ error: "Interview not found." });
  const interview = ivRows[0];

  // Only the interviewer this interview was assigned to may submit feedback
  // for it — the old app had no such server-side check at all (the client
  // simply never rendered another interviewer's interviews).
  if (interview.interviewer_id !== req.user.id) {
    return res.status(403).json({ error: "You can only submit feedback for interviews assigned to you." });
  }

  const [existing] = await pool.query("SELECT id FROM feedback WHERE interview_id = :id", { id: interview.id });
  if (existing.length) {
    await pool.query(
      "UPDATE feedback SET rating = :rating, recommendation = :recommendation, comments = :comments WHERE interview_id = :interviewId",
      { rating: ratingNum, recommendation, comments: comments || null, interviewId: interview.id }
    );
  } else {
    await pool.query(
      "INSERT INTO feedback (id, interview_id, interviewer_id, rating, recommendation, comments) VALUES (:id, :interviewId, :interviewerId, :rating, :recommendation, :comments)",
      { id: uid("fb"), interviewId: interview.id, interviewerId: req.user.id, rating: ratingNum, recommendation, comments: comments || null }
    );
  }

  await pool.query("UPDATE interviews SET status = 'Completed' WHERE id = :id", { id: interview.id });
  await pool.query("UPDATE applicants SET status = 'Interviewed' WHERE id = :id", { id: interview.candidate_id });

  const [rows] = await pool.query("SELECT * FROM feedback WHERE interview_id = :id", { id: interview.id });
  res.status(existing.length ? 200 : 201).json(toCamel(rows[0]));
}));

// GET /api/feedback/interviews/:interviewId — any logged-in staff
// (feedbackFor() single lookups).
router.get("/interviews/:interviewId", requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM feedback WHERE interview_id = :id", { id: req.params.interviewId });
  if (!rows.length) return res.status(404).json({ error: "No feedback submitted yet." });
  res.json(toCamel(rows[0]));
}));

module.exports = router;
