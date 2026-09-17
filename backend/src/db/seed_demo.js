// Second-stage demo seed: populates a full, working end-to-end flow on top
// of seed.js's jobs + 3 staff accounts, so every screen in the app has real
// data instead of empty states:
//   applicants (with resume text + AI match score) -> candidates shortlist
//   -> interviews (assigned to Nimal Fernando, the demo interviewer)
//   -> feedback (submitted by Nimal) -> decisions (Hired/Rejected by HR/manager)
//   -> a couple of public contact messages
// Safe to re-run: skips anything that already exists (by email/name match).
require("dotenv").config();
const pool = require("./pool");
const { analyzeMatch } = require("../matching");

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const APPLICANTS = [
  {
    job: "Software Engineer",
    name: "Sachini Rajapaksa", email: "sachini.raj@example.com", phone: "0771234567",
    cover_note: "Excited to bring my full-stack experience to Altrium's engineering team.",
    resume_text: "Software engineer with 4 years experience building REST APIs using Node.js and Express, React front-ends, and SQL databases. Comfortable with Git, agile ceremonies and code review.",
  },
  {
    job: "Software Engineer",
    name: "Dilan Wickramasinghe", email: "dilan.w@example.com", phone: "0772345678",
    cover_note: "I have shipped several production JavaScript apps and enjoy mentoring junior developers.",
    resume_text: "Full-stack developer skilled in JavaScript, React, Node.js, REST API design and PostgreSQL/MySQL. Familiar with Git-based workflows and agile teams.",
  },
  {
    job: "QA Engineer",
    name: "Kavindi Jayasuriya", email: "kavindi.j@example.com", phone: "0773456789",
    cover_note: "Passionate about catching bugs before customers do.",
    resume_text: "QA engineer experienced in manual and automated testing, writing test cases, using bug tracking tools like Jira, and basic SQL for verifying data integrity.",
  },
  {
    job: "UI/UX Designer",
    name: "Tharindu Bandara", email: "tharindu.b@example.com", phone: "0774567890",
    cover_note: "My portfolio focuses on accessible, research-driven design for internal tools.",
    resume_text: "UI/UX designer with a strong portfolio in Figma, user research, wireframing and usability testing, with an emphasis on accessibility best practices.",
  },
  {
    job: "Data Analyst",
    name: "Nadeesha Gunawardena", email: "nadeesha.g@example.com", phone: "0775678901",
    cover_note: "I love turning messy data into dashboards people actually use.",
    resume_text: "Data analyst with strong SQL, spreadsheet modelling and data visualization skills, experienced presenting findings to non-technical stakeholders.",
  },
  {
    job: "HR Executive",
    name: "Ishara Peiris", email: "ishara.p@example.com", phone: "0776789012",
    cover_note: "Two years managing candidate communication end-to-end at a mid-size firm.",
    resume_text: "HR executive with recruitment administration experience, strong written communication, and familiarity with applicant tracking systems.",
  },
];

async function findJobId(title) {
  const [rows] = await pool.query("SELECT id, description, requirements FROM jobs WHERE title = :title LIMIT 1", { title });
  return rows[0] || null;
}

async function findUserByEmail(email) {
  const [rows] = await pool.query("SELECT id, name FROM users WHERE email = :email LIMIT 1", { email: email.toLowerCase() });
  return rows[0] || null;
}

async function main() {
  const nimal = await findUserByEmail("interviewer@Altrium.test");
  const hansi = await findUserByEmail("hr@Altrium.test");
  const amanda = await findUserByEmail("manager@Altrium.test");
  if (!nimal || !hansi || !amanda) {
    throw new Error("Run `npm run db:seed` first — demo staff accounts (Nimal/Hansi/Amanda) not found.");
  }

  const insertedApplicants = [];
  for (const a of APPLICANTS) {
    const [existing] = await pool.query("SELECT id, job_id, status FROM applicants WHERE email = :email LIMIT 1", { email: a.email });
    if (existing.length) {
      console.log(`Skip applicant (exists): ${a.name}`);
      insertedApplicants.push({ ...existing[0], name: a.name });
      continue;
    }
    const job = await findJobId(a.job);
    if (!job) { console.log(`Skip applicant (job not found: ${a.job}): ${a.name}`); continue; }

    const { score, matchedKeywords, missingKeywords } = analyzeMatch(job.description, job.requirements, a.resume_text);
    const id = uid("app");
    await pool.query(
      `INSERT INTO applicants
        (id, job_id, name, email, phone, cover_note, resume_text, match_score, matched_keywords, missing_keywords, status)
       VALUES
        (:id, :job_id, :name, :email, :phone, :cover_note, :resume_text, :match_score, :matched_keywords, :missing_keywords, 'Applied')`,
      {
        id, job_id: job.id, name: a.name, email: a.email, phone: a.phone, cover_note: a.cover_note,
        resume_text: a.resume_text, match_score: score,
        matched_keywords: JSON.stringify(matchedKeywords), missing_keywords: JSON.stringify(missingKeywords),
      }
    );
    console.log(`Seeded applicant: ${a.name} -> ${a.job} (score ${score}%)`);
    insertedApplicants.push({ id, job_id: job.id, name: a.name, status: "Applied" });
  }

  // Promote the two Software Engineer applicants + the QA applicant to the
  // HR shortlist (candidates table), mirroring "Shortlist" in ApplicantsTab.
  const shortlistNames = ["Sachini Rajapaksa", "Dilan Wickramasinghe", "Kavindi Jayasuriya"];
  const shortlisted = insertedApplicants.filter((a) => shortlistNames.includes(a.name));

  for (const cand of shortlisted) {
    const [full] = await pool.query("SELECT * FROM applicants WHERE id = :id", { id: cand.id });
    if (!full.length) continue;
    const app = full[0];
    const [existingCand] = await pool.query("SELECT id FROM candidates WHERE applicant_id = :id", { id: app.id });
    if (existingCand.length) { console.log(`Skip shortlist (exists): ${app.name}`); continue; }
    await pool.query(
      `INSERT INTO candidates
        (id, applicant_id, job_id, name, email, phone, cover_note, resume_text, match_score, matched_keywords, missing_keywords, applied_at)
       VALUES
        (:id, :applicant_id, :job_id, :name, :email, :phone, :cover_note, :resume_text, :match_score, :matched_keywords, :missing_keywords, :applied_at)`,
      {
        id: uid("cand"), applicant_id: app.id, job_id: app.job_id, name: app.name, email: app.email,
        phone: app.phone, cover_note: app.cover_note, resume_text: app.resume_text, match_score: app.match_score,
        matched_keywords: app.matched_keywords, missing_keywords: app.missing_keywords, applied_at: app.applied_at,
      }
    );
    await pool.query("UPDATE applicants SET status = 'Shortlisted' WHERE id = :id", { id: app.id });
    console.log(`Shortlisted: ${app.name}`);
  }

  // Schedule interviews for Sachini and Dilan with Nimal Fernando.
  const interviewNames = ["Sachini Rajapaksa", "Dilan Wickramasinghe"];
  const toInterview = insertedApplicants.filter((a) => interviewNames.includes(a.name));
  const interviewIds = {};

  for (let i = 0; i < toInterview.length; i++) {
    const app = toInterview[i];
    const [existingInterview] = await pool.query("SELECT id, status FROM interviews WHERE candidate_id = :id", { id: app.id });
    if (existingInterview.length) {
      console.log(`Skip interview (exists): ${app.name}`);
      interviewIds[app.name] = existingInterview[0];
      continue;
    }
    const scheduledAt = new Date(Date.now() + (i === 0 ? -2 : 1) * 24 * 60 * 60 * 1000); // one past (for feedback demo), one upcoming
    const id = uid("intv");
    await pool.query(
      `INSERT INTO interviews (id, candidate_id, interviewer_id, scheduled_at, status, notes)
       VALUES (:id, :candidate_id, :interviewer_id, :scheduled_at, :status, :notes)`,
      {
        id, candidate_id: app.id, interviewer_id: nimal.id, scheduled_at: scheduledAt,
        status: i === 0 ? "Completed" : "Scheduled",
        notes: i === 0 ? "Technical round covering React and Node.js fundamentals." : "First round with hiring manager.",
      }
    );
    await pool.query("UPDATE applicants SET status = :status WHERE id = :id", {
      id: app.id, status: i === 0 ? "Interviewed" : "Interview Scheduled",
    });
    console.log(`Scheduled interview for ${app.name} with Nimal Fernando (${i === 0 ? "past/Completed" : "upcoming"})`);
    interviewIds[app.name] = { id, status: i === 0 ? "Completed" : "Scheduled" };
  }

  // Feedback for the completed interview (Sachini), submitted by Nimal.
  const sachiniInterview = interviewIds["Sachini Rajapaksa"];
  if (sachiniInterview && sachiniInterview.status === "Completed") {
    const [existingFb] = await pool.query("SELECT id FROM feedback WHERE interview_id = :id", { id: sachiniInterview.id });
    if (!existingFb.length) {
      await pool.query(
        `INSERT INTO feedback (id, interview_id, interviewer_id, rating, recommendation, comments)
         VALUES (:id, :interview_id, :interviewer_id, :rating, :recommendation, :comments)`,
        {
          id: uid("fb"), interview_id: sachiniInterview.id, interviewer_id: nimal.id,
          rating: 5, recommendation: "Hire",
          comments: "Strong grasp of React and Node.js fundamentals, clear communicator, good problem-solving approach.",
        }
      );
      console.log("Seeded feedback: Sachini Rajapaksa (Hire, 5/5) by Nimal Fernando");
    } else {
      console.log("Skip feedback (exists): Sachini Rajapaksa");
    }
  }

  // Hiring decision for Sachini, made by the manager (Amanda), based on the feedback above.
  const sachini = insertedApplicants.find((a) => a.name === "Sachini Rajapaksa");
  if (sachini) {
    const [existingDecision] = await pool.query("SELECT id FROM decisions WHERE candidate_id = :id", { id: sachini.id });
    if (!existingDecision.length) {
      await pool.query(
        `INSERT INTO decisions (id, candidate_id, decision, notes, decided_by)
         VALUES (:id, :candidate_id, :decision, :notes, :decided_by)`,
        {
          id: uid("dec"), candidate_id: sachini.id, decision: "Hired",
          notes: "Excellent technical interview feedback from Nimal Fernando. Approved to proceed with offer.",
          decided_by: amanda.id,
        }
      );
      await pool.query("UPDATE applicants SET status = 'Hired' WHERE id = :id", { id: sachini.id });
      console.log("Seeded decision: Sachini Rajapaksa -> Hired (by Amanda Silva)");
    } else {
      console.log("Skip decision (exists): Sachini Rajapaksa");
    }
  }

  // A couple of public contact messages (Contact Us form on the careers page).
  const MESSAGES = [
    { name: "Ruwan Perera", email: "ruwan.perera@example.com", message: "Hi, I applied for the QA Engineer role last week — is there an estimated timeline for first-round interviews?" },
    { name: "Chamodi Silva", email: "chamodi.silva@example.com", message: "Do you offer remote/hybrid work options for the Data Analyst position?" },
  ];
  for (const m of MESSAGES) {
    const [existing] = await pool.query("SELECT id FROM contact_messages WHERE email = :email AND message = :message LIMIT 1", m);
    if (existing.length) { console.log(`Skip message (exists): ${m.name}`); continue; }
    await pool.query(
      "INSERT INTO contact_messages (id, name, email, message) VALUES (:id, :name, :email, :message)",
      { id: uid("msg"), ...m }
    );
    console.log(`Seeded contact message from: ${m.name}`);
  }

  console.log("\nDemo data ready. Key things to check in the app:");
  console.log("  - HR (hr@Altrium.test): Applicants tab shows 6 applicants across jobs; Candidates tab shows 3 shortlisted.");
  console.log("  - Interviewer (interviewer@Altrium.test / Nimal Fernando): dashboard shows 2 interviews (1 completed w/ feedback, 1 upcoming).");
  console.log("  - Manager (manager@Altrium.test): Decision Log shows Sachini Rajapaksa -> Hired.");

  await pool.end();
}

main().catch((err) => {
  console.error("Demo seed failed:", err.message);
  process.exit(1);
});
