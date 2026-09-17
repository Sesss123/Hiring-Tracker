const express = require("express");
const asyncHandler = require("../asyncHandler");
const pool = require("../db/pool");
const { toCamel } = require("../camelCase");
const { requireAuth, requireRole } = require("../auth/middleware");
const { analyzeMatch, analyzeCVToCVSimilarity } = require("../matching");
const { scoreCVQuality } = require("../gemini");

const router = express.Router();

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const STATUS_OPTIONS = ["Applied", "Shortlisted", "Interview Scheduled", "Interviewed", "Offered", "Rejected", "Hired"];

// POST /api/applicants — PUBLIC. This is the guest Apply form
// (ApplicationForm.handleSubmit in app.js): no login required, same as
// the old app, since candidates never need an account to apply.
// NOTE: the actual CV file still needs to be stored client-side in
// IndexedDB by the frontend (as it is today) — this backend stores the
// file's metadata/fileId and the extracted resume_text, not the binary.
// See README "What this backend does not do yet".
router.post("/", asyncHandler(async (req, res) => {
  const { jobId, name, email, phone, coverNote, resumeText, resumeFileName, resumeFileType, resumeFileId } = req.body || {};
  if (!jobId || !name || !email || !phone || !coverNote || !resumeText) {
    return res.status(400).json({ error: "Name, email, phone, cover note and CV text are all required." });
  }

  const [jobRows] = await pool.query("SELECT * FROM jobs WHERE id = :id", { id: jobId });
  if (!jobRows.length) return res.status(404).json({ error: "Job not found." });
  const job = jobRows[0];

  const { score, matchedKeywords, missingKeywords } = analyzeMatch(job.description, job.requirements, resumeText);

  const id = uid("app");
  await pool.query(
    `INSERT INTO applicants
      (id, job_id, name, email, phone, cover_note, resume_text, resume_file_name, resume_file_type, resume_file_id,
       match_score, matched_keywords, missing_keywords, status)
     VALUES
      (:id, :jobId, :name, :email, :phone, :coverNote, :resumeText, :resumeFileName, :resumeFileType, :resumeFileId,
       :score, :matchedKeywords, :missingKeywords, 'Applied')`,
    {
      id, jobId, name, email, phone, coverNote, resumeText,
      resumeFileName: resumeFileName || null, resumeFileType: resumeFileType || null, resumeFileId: resumeFileId || null,
      score, matchedKeywords: JSON.stringify(matchedKeywords), missingKeywords: JSON.stringify(missingKeywords),
    }
  );

  const [rows] = await pool.query("SELECT * FROM applicants WHERE id = :id", { id });
  res.status(201).json(toCamel(rows[0]));
}));

// GET /api/applicants — any logged-in staff (requireAuth only, no role
// restriction). Corrected from an earlier hr-only draft once wiring the
// frontend showed InterviewerDashboard and ManagerDashboard/ReviewCandidates
// both read the full applicants list directly too (KEYS.applicants had no
// role restriction at all in the old app). ?jobId= filters to one job.
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const sql = req.query.jobId
    ? "SELECT * FROM applicants WHERE job_id = :jobId ORDER BY match_score DESC"
    : "SELECT * FROM applicants ORDER BY match_score DESC";
  const [rows] = await pool.query(sql, { jobId: req.query.jobId });
  res.json(toCamel(rows));
}));

// PATCH /api/applicants/:id/status — HR only (updateStatus() in
// ReviewCandidates). Accepts any of the app's real status values.
router.patch("/:id/status", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!STATUS_OPTIONS.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUS_OPTIONS.join(", ")}` });
  }
  const [result] = await pool.query("UPDATE applicants SET status = :status WHERE id = :id", { id: req.params.id, status });
  if (!result.affectedRows) return res.status(404).json({ error: "Applicant not found." });
  res.status(204).end();
}));

// POST /api/applicants/:id/promote — HR only (addToCandidates()): copies
// the applicant into the candidates shortlist. No-ops (matches
// isAlreadyCandidate()) if already promoted.
router.post("/:id/promote", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const [appRows] = await pool.query("SELECT * FROM applicants WHERE id = :id", { id: req.params.id });
  if (!appRows.length) return res.status(404).json({ error: "Applicant not found." });
  const a = appRows[0];

  const [existing] = await pool.query("SELECT id FROM candidates WHERE applicant_id = :id", { id: a.id });
  if (existing.length) return res.status(200).json({ message: "Already on the shortlist.", candidateId: existing[0].id });

  const id = uid("cand");
  await pool.query(
    `INSERT INTO candidates
      (id, applicant_id, job_id, name, email, phone, cover_note, resume_text, resume_file_name, resume_file_type,
       resume_file_id, match_score, matched_keywords, missing_keywords, applied_at, pinned)
     VALUES
      (:id, :applicantId, :jobId, :name, :email, :phone, :coverNote, :resumeText, :resumeFileName, :resumeFileType,
       :resumeFileId, :matchScore, :matchedKeywords, :missingKeywords, :appliedAt, FALSE)`,
    {
      id, applicantId: a.id, jobId: a.job_id, name: a.name, email: a.email, phone: a.phone,
      coverNote: a.cover_note, resumeText: a.resume_text, resumeFileName: a.resume_file_name,
      resumeFileType: a.resume_file_type, resumeFileId: a.resume_file_id, matchScore: a.match_score,
      matchedKeywords: JSON.stringify(a.matched_keywords), missingKeywords: JSON.stringify(a.missing_keywords),
      appliedAt: a.applied_at,
    }
  );
  res.status(201).json({ candidateId: id });
}));

// GET /api/applicants/cv-similarity?jobId=... — HR only. Ports
// calculatePeerCVScores(): average CV-to-CV cosine similarity against
// every other applicant for the same job (PB-07).
router.get("/cv-similarity", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ error: "jobId query parameter is required." });

  const [pool_] = await pool.query(
    "SELECT id, resume_text FROM applicants WHERE job_id = :jobId AND resume_text IS NOT NULL",
    { jobId }
  );

  const scores = {};
  pool_.forEach((candidate) => {
    const others = pool_.filter((r) => r.id !== candidate.id);
    if (!others.length) { scores[candidate.id] = 0; return; }
    const total = others.reduce((sum, other) => sum + analyzeCVToCVSimilarity(candidate.resume_text, other.resume_text), 0);
    scores[candidate.id] = Math.round(total / others.length);
  });

  res.json(scores);
}));

// POST /api/applicants/:id/quality-check — HR only. HR-triggered (not run
// automatically on every apply, since it costs a Gemini call) CV quality
// score using the rubric in src/gemini.js — separate from match_score
// (job-fit keyword similarity). Saves quality_score + quality_breakdown on
// the applicant row and returns the result.
router.post("/:id/quality-check", requireAuth, requireRole("hr"), asyncHandler(async (req, res) => {
  const [appRows] = await pool.query("SELECT * FROM applicants WHERE id = :id", { id: req.params.id });
  if (!appRows.length) return res.status(404).json({ error: "Applicant not found." });
  const applicant = appRows[0];

  const [jobRows] = await pool.query("SELECT title, requirements FROM jobs WHERE id = :id", { id: applicant.job_id });
  const job = jobRows[0] || {};

  let result;
  try {
    result = await scoreCVQuality(job.title, job.requirements, applicant.resume_text);
  } catch (err) {
    return res.status(502).json({ error: `CV quality check failed: ${err.message}` });
  }

  await pool.query(
    "UPDATE applicants SET quality_score = :score, quality_breakdown = :breakdown WHERE id = :id",
    { id: applicant.id, score: result.totalQualityScore, breakdown: JSON.stringify(result.breakdown) }
  );

  res.json({ qualityScore: result.totalQualityScore, breakdown: result.breakdown });
}));

module.exports = router;
