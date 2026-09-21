-- HireLine MySQL schema
-- Traced directly from app.js's KEYS object and every place each entity is
-- read/written (load()/save() calls). Field names below map 1:1 onto the
-- real localStorage record shapes so migrating existing data is a straight
-- copy, not a redesign.
--
-- KEYS.users            -> users
-- KEYS.jobs              -> jobs
-- KEYS.applicants        -> applicants          (raw pool from the public Apply form)
-- KEYS.candidates        -> candidates          (hl_candidates_shortlist: HR-promoted shortlist)
-- KEYS.interviews        -> interviews
-- KEYS.feedback          -> feedback
-- KEYS.decisions         -> decisions
-- KEYS.messages          -> contact_messages
--
-- Known real-app quirk preserved here on purpose (see project notes):
-- Schedule Interview / Assign Interviewer / Hiring Decision / Reporting all
-- key off applicants.id in the current app, NOT candidates.id, despite the
-- UI calling that stage "Candidates". interviews.candidate_id and
-- decisions.candidate_id below both reference applicants(id) to match the
-- app's actual behaviour, not the UI's naming.

CREATE DATABASE IF NOT EXISTS hireline CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hireline;

-- ---------------------------------------------------------------------
-- users  (was: plaintext { id, name, email, password, role } in KEYS.users)
-- Login now checks password_hash with bcrypt instead of a plaintext ===.
-- Only hr / interviewer / manager are real, modeled roles with distinct
-- access control (see auth/middleware.js's requireRole()) — there is no
-- separate "Operations Manager" login role or permission set.
-- job_title is purely descriptive (shown in the UI, e.g. "Operations
-- Manager"), not used anywhere in access control — a deliberate choice to
-- let a manager account carry that job title without adding a 4th role
-- and its own ENUM value/permission rules, which would be a bigger schema
-- change for a title that the team never defined distinct permissions for.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(40)  PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('hr','interviewer','manager') NOT NULL,
  job_title     VARCHAR(80)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- jobs  (KEYS.jobs)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id           VARCHAR(40)  PRIMARY KEY,
  title        VARCHAR(160) NOT NULL,
  department   VARCHAR(120) NULL,
  description  TEXT         NOT NULL,
  requirements TEXT         NOT NULL,
  status       ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- applicants  (KEYS.applicants — raw pool from the public Apply form,
-- includes the AI match score for HR's eyes only)
-- resume_file_id points at the browser's IndexedDB (hl_cv_files) record —
-- the CV file itself is NOT migrated into MySQL by this backend; see
-- README "What this backend does not do yet".
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applicants (
  id                VARCHAR(40)  PRIMARY KEY,
  job_id            VARCHAR(40)  NOT NULL,
  name              VARCHAR(160) NOT NULL,
  email             VARCHAR(190) NOT NULL,
  phone             VARCHAR(40)  NULL,
  cover_note        TEXT         NULL,
  resume_text       LONGTEXT     NULL,
  resume_file_name  VARCHAR(255) NULL,
  resume_file_type  VARCHAR(120) NULL,
  resume_file_id    VARCHAR(64)  NULL,
  match_score       INT          NULL,
  matched_keywords  JSON         NULL,
  missing_keywords  JSON         NULL,
  quality_score     INT          NULL,
  quality_breakdown JSON         NULL,
  status            ENUM('Applied','Shortlisted','Interview Scheduled','Interviewed','Offered','Rejected','Hired')
                       NOT NULL DEFAULT 'Applied',
  applied_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_applicants_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- candidates  (KEYS.candidates -> "hl_candidates_shortlist": the smaller,
-- HR-curated shortlist with its own pin/search/sort/delete)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidates (
  id                VARCHAR(40)  PRIMARY KEY,
  applicant_id      VARCHAR(40)  NOT NULL,
  job_id            VARCHAR(40)  NOT NULL,
  name              VARCHAR(160) NOT NULL,
  email             VARCHAR(190) NOT NULL,
  phone             VARCHAR(40)  NULL,
  cover_note        TEXT         NULL,
  resume_text       LONGTEXT     NULL,
  resume_file_name  VARCHAR(255) NULL,
  resume_file_type  VARCHAR(120) NULL,
  resume_file_id    VARCHAR(64)  NULL,
  match_score       INT          NULL,
  matched_keywords  JSON         NULL,
  missing_keywords  JSON         NULL,
  applied_at        DATETIME     NULL,
  pinned            BOOLEAN      NOT NULL DEFAULT FALSE,
  added_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_candidates_applicant FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE,
  CONSTRAINT fk_candidates_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- interviews  (KEYS.interviews)
-- candidate_id references applicants(id) on purpose — see header note.
-- interviewer_id is nullable so Schedule Interview (PB-16) and Assign
-- Interviewer (PB-17) can be genuinely separate steps: HR can schedule a
-- date/time first with no interviewer picked yet, then assign one later
-- via PATCH /:id/interviewer. Previously these were one combined call.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interviews (
  id             VARCHAR(40) PRIMARY KEY,
  candidate_id   VARCHAR(40) NOT NULL,
  interviewer_id VARCHAR(40) NULL,
  scheduled_at   DATETIME    NOT NULL,
  status         ENUM('Scheduled','Completed') NOT NULL DEFAULT 'Scheduled',
  notes          TEXT        NULL,
  created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_interviews_applicant   FOREIGN KEY (candidate_id) REFERENCES applicants(id) ON DELETE CASCADE,
  CONSTRAINT fk_interviews_interviewer FOREIGN KEY (interviewer_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- feedback  (KEYS.feedback)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id             VARCHAR(40) PRIMARY KEY,
  interview_id   VARCHAR(40) NOT NULL UNIQUE,
  interviewer_id VARCHAR(40) NOT NULL,
  rating         TINYINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  recommendation ENUM('Hire','Maybe','No Hire') NOT NULL,
  comments       TEXT        NULL,
  created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_feedback_interview   FOREIGN KEY (interview_id) REFERENCES interviews(id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_interviewer FOREIGN KEY (interviewer_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- decisions  (KEYS.decisions)
-- candidate_id references applicants(id) on purpose — see header note.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS decisions (
  id           VARCHAR(40) PRIMARY KEY,
  candidate_id VARCHAR(40) NOT NULL,
  decision     ENUM('Hired','Rejected') NOT NULL,
  notes        TEXT        NULL,
  decided_by   VARCHAR(40) NOT NULL,
  decided_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_decisions_applicant FOREIGN KEY (candidate_id) REFERENCES applicants(id) ON DELETE CASCADE,
  CONSTRAINT fk_decisions_user      FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- contact_messages  (KEYS.messages -> "hl_contact_messages")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_messages (
  id       VARCHAR(40)  PRIMARY KEY,
  name     VARCHAR(160) NOT NULL,
  email    VARCHAR(190) NOT NULL,
  message  TEXT         NOT NULL,
  sent_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- notifications  (new — closes PB-24 "Notify Assigned Interviewer", which
-- previously had zero code. In-app only, not email, to avoid adding a
-- third-party email service/API key dependency to a campus project.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          VARCHAR(40)  PRIMARY KEY,
  user_id     VARCHAR(40)  NOT NULL,
  message     VARCHAR(255) NOT NULL,
  interview_id VARCHAR(40) NULL,
  read_at     DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_interview FOREIGN KEY (interview_id) REFERENCES interviews(id) ON DELETE CASCADE
) ENGINE=InnoDB;
