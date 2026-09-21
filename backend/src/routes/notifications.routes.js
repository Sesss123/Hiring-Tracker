const express = require("express");
const asyncHandler = require("../asyncHandler");
const pool = require("../db/pool");
const { toCamel } = require("../camelCase");
const { requireAuth } = require("../auth/middleware");

const router = express.Router();

// GET /api/notifications — the logged-in user's own notifications only,
// unread first, newest first. Closes PB-24 (Notify Assigned Interviewer):
// when HR schedules an interview, a row is inserted here for that
// interviewer (see routes/interviews.routes.js) so they see it on login.
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM notifications WHERE user_id = :userId ORDER BY (read_at IS NULL) DESC, created_at DESC",
    { userId: req.user.id }
  );
  res.json(toCamel(rows));
}));

// PATCH /api/notifications/:id/read — marks one notification read. Scoped
// to the logged-in user so nobody can mark someone else's notification.
router.patch("/:id/read", requireAuth, asyncHandler(async (req, res) => {
  const [result] = await pool.query(
    "UPDATE notifications SET read_at = NOW() WHERE id = :id AND user_id = :userId AND read_at IS NULL",
    { id: req.params.id, userId: req.user.id }
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Notification not found." });
  res.status(204).end();
}));

// PATCH /api/notifications/read-all — marks every one of the logged-in
// user's unread notifications read in one call (dashboard "mark all read").
router.patch("/read-all", requireAuth, asyncHandler(async (req, res) => {
  await pool.query(
    "UPDATE notifications SET read_at = NOW() WHERE user_id = :userId AND read_at IS NULL",
    { userId: req.user.id }
  );
  res.status(204).end();
}));

module.exports = router;
