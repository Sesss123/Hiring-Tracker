const express = require("express");
const asyncHandler = require("../asyncHandler");
const pool = require("../db/pool");
const { requireAuth, requireRole } = require("../auth/middleware");
const { toCamel } = require("../camelCase");

const router = express.Router();

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// GET /api/jobs  — public (Careers page lists open jobs, no login needed,
// same as the old app where JobsList/Careers just read KEYS.jobs directly).
// Pass ?all=1 (HR dashboard) to include closed jobs too.
router.get("/", asyncHandler(async (req, res) => {
  const sql = req.query.all
    ? "SELECT * FROM jobs ORDER BY created_at DESC"
    : "SELECT * FROM jobs WHERE status = 'open' ORDER BY created_at DESC";
  const [rows] = await pool.query(sql);
  res.json(toCamel(rows));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM jobs WHERE id = :id", { id: req.params.id });
  if (!rows.length) return res.status(404).json({ error: "Job not found." });
  res.json(toCamel(rows[0]));
}));

// POST /api/jobs — HR only (matches JobsTab.handleSubmit's create path;
// title/description/requirements required, same as the client validation).
router.post("/", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const { title, department, description, requirements } = req.body || {};
  if (!title || !description || !requirements) {
    return res.status(400).json({ error: "Title, description and requirements are required." });
  }
  const id = uid("job");
  await pool.query(
    "INSERT INTO jobs (id, title, department, description, requirements, status) VALUES (:id, :title, :department, :description, :requirements, 'open')",
    { id, title, department: department || null, description, requirements }
  );
  const [rows] = await pool.query("SELECT * FROM jobs WHERE id = :id", { id });
  res.status(201).json(toCamel(rows[0]));
}));

// PUT /api/jobs/:id — HR only (matches JobsTab.handleSubmit's update path:
// only title/department/description/requirements are editable, status and
// createdAt are left alone).
router.put("/:id", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const { title, department, description, requirements } = req.body || {};
  if (!title || !description || !requirements) {
    return res.status(400).json({ error: "Title, description and requirements are required." });
  }
  const [result] = await pool.query(
    "UPDATE jobs SET title = :title, department = :department, description = :description, requirements = :requirements WHERE id = :id",
    { id: req.params.id, title, department: department || null, description, requirements }
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Job not found." });
  const [rows] = await pool.query("SELECT * FROM jobs WHERE id = :id", { id: req.params.id });
  res.json(toCamel(rows[0]));
}));

// DELETE /api/jobs/:id — HR only (matches confirmDelete()'s hard filter-out;
// ON DELETE CASCADE removes dependent applicants/candidates, same as the
// old app silently orphaning nothing because everything lived in one
// flat localStorage array).
router.delete("/:id", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const [result] = await pool.query("DELETE FROM jobs WHERE id = :id", { id: req.params.id });
  if (!result.affectedRows) return res.status(404).json({ error: "Job not found." });
  res.status(204).end();
}));

// PATCH /api/jobs/:id/status — HR only (matches JobsTab.toggleStatus(),
// a real working feature — flipping status between "open" and "closed" —
// that is separate from the edit form and was missed on the first pass
// of this backend; added once the frontend wiring surfaced the gap).
router.patch("/:id/status", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!["open", "closed"].includes(status)) {
    return res.status(400).json({ error: "status must be 'open' or 'closed'." });
  }
  const [result] = await pool.query("UPDATE jobs SET status = :status WHERE id = :id", { id: req.params.id, status });
  if (!result.affectedRows) return res.status(404).json({ error: "Job not found." });
  const [rows] = await pool.query("SELECT * FROM jobs WHERE id = :id", { id: req.params.id });
  res.json(toCamel(rows[0]));
}));

module.exports = router;
