const express = require("express");
const asyncHandler = require("../asyncHandler");
const pool = require("../db/pool");
const { toCamel } = require("../camelCase");
const { requireAuth, requireRole } = require("../auth/middleware");

const router = express.Router();

function safeDownloadName(name) {
  return (name || "cv").replace(/[\r\n"\\/]/g, "_");
}

async function sendCandidateCV(req, res, disposition) {
  const [rows] = await pool.query(
    `SELECT a.resume_file_name, a.resume_file_type, a.resume_file_data
       FROM candidates c
       JOIN applicants a ON a.id = c.applicant_id
      WHERE c.id = :id
      LIMIT 1`,
    { id: req.params.id }
  );
  if (!rows.length) return res.status(404).json({ error: "Candidate not found." });
  const record = rows[0];
  if (!record.resume_file_data) {
    return res.status(404).json({ error: "CV file is unavailable. Re-upload is required." });
  }
  const filename = safeDownloadName(record.resume_file_name);
  res.set({
    "Content-Type": record.resume_file_type || "application/octet-stream",
    "Content-Length": record.resume_file_data.length,
    "Content-Disposition": `${disposition}; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  });
  res.send(record.resume_file_data);
}

// GET /api/candidates — HR only (ManageCandidates / Candidate
// Shortlisting). ?jobId= filters, ?sort=score_desc|score_asc matches the
// old sortBy dropdown, ?search= filters by name/email server-side (PB-11
// — previously every candidate was downloaded and filtered client-side
// with .filter(); that instant-as-you-type client filtering still works
// and is left alone, but a real search query now exists too).
router.get("/", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const conditions = [];
  const params = {};
  if (req.query.jobId) { conditions.push("c.job_id = :jobId"); params.jobId = req.query.jobId; }
  if (req.query.search) {
    conditions.push("(c.name LIKE :search OR c.email LIKE :search)");
    params.search = `%${req.query.search}%`;
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const orderBy = req.query.sort === "score_asc" ? "ORDER BY c.match_score ASC" : "ORDER BY c.match_score DESC";
  const [rows] = await pool.query(
    `SELECT c.*, (a.resume_file_data IS NOT NULL) AS resume_file_available
       FROM candidates c
       JOIN applicants a ON a.id = c.applicant_id
       ${where} ${orderBy}`,
    params
  );
  res.json(toCamel(rows));
}));

router.get("/:id/cv", requireAuth, asyncHandler(async (req, res) => {
  await sendCandidateCV(req, res, "inline");
}));

router.get("/:id/cv/download", requireAuth, asyncHandler(async (req, res) => {
  await sendCandidateCV(req, res, "attachment");
}));

// PATCH /api/candidates/:id/pin — HR only, toggles pinned (matches the
// old app's togglePin() which flipped !c.pinned).
router.patch("/:id/pin", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const [result] = await pool.query("UPDATE candidates SET pinned = NOT pinned WHERE id = :id", { id: req.params.id });
  if (!result.affectedRows) return res.status(404).json({ error: "Candidate not found." });
  const [rows] = await pool.query("SELECT * FROM candidates WHERE id = :id", { id: req.params.id });
  res.json(toCamel(rows[0]));
}));

// DELETE /api/candidates/:id — HR only (matches the shortlist's own
// delete, separate from deleting the underlying applicant record).
router.delete("/:id", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const [result] = await pool.query("DELETE FROM candidates WHERE id = :id", { id: req.params.id });
  if (!result.affectedRows) return res.status(404).json({ error: "Candidate not found." });
  res.status(204).end();
}));

module.exports = router;
