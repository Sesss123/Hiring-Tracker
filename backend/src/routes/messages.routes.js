const express = require("express");
const asyncHandler = require("../asyncHandler");
const pool = require("../db/pool");
const { toCamel } = require("../camelCase");
const { requireAuth, requireRole } = require("../auth/middleware");

const router = express.Router();

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// POST /api/messages — public (Contact() form, no login needed).
router.post("/", asyncHandler(async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: "Name, email and message are all required." });
  }
  const id = uid("msg");
  await pool.query(
    "INSERT INTO contact_messages (id, name, email, message) VALUES (:id, :name, :email, :message)",
    { id, name, email, message }
  );
  res.status(201).json({ id });
}));

// GET /api/messages — HR only. The old app never actually exposed a way
// to read these back from the dashboard (KEYS.messages was write-only in
// app.js); this endpoint is added so the data isn't captured and never
// seen. Flagged here rather than left silently unreachable.
router.get("/", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM contact_messages ORDER BY sent_at DESC");
  res.json(toCamel(rows));
}));

module.exports = router;
