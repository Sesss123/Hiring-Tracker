// Loads the same demo data app.js's seedIfNeeded() used to write into
// localStorage — the 6 sample jobs and the 3 demo staff accounts — but
// with bcrypt-hashed passwords instead of plaintext, and into MySQL
// instead of the browser. Safe to re-run: it skips anything that already
// exists (by email / by title).
require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./pool");

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const JOBS = [
  {
    title: "Software Engineer", department: "Engineering",
    description: "Build and maintain features across our web-based recruitment platform, working closely with designers, QA and product to ship reliable releases.",
    requirements: "Experience with JavaScript, React, Node.js, REST APIs and SQL databases. Comfortable with Git and agile teamwork.",
  },
  {
    title: "QA Engineer", department: "Engineering",
    description: "Own the quality of new features before release: design test cases, run manual and automated checks, and track down the root cause of bugs.",
    requirements: "Experience with manual and automated testing, test case design, bug tracking tools and basic SQL for verifying data.",
  },
  {
    title: "UI/UX Designer", department: "Product & Design",
    description: "Design clear, usable interfaces for our recruitment platform, from candidate-facing job pages to internal HR dashboards.",
    requirements: "Experience with Figma, user research, wireframing and usability testing. A strong portfolio and attention to accessibility.",
  },
  {
    title: "HR Executive", department: "Human Resources",
    description: "Manage job postings, coordinate candidate communication end-to-end, and support the interview scheduling process for hiring teams.",
    requirements: "Experience in recruitment or HR administration, strong written communication, and familiarity with applicant tracking tools.",
  },
  {
    title: "Data Analyst", department: "Business Intelligence",
    description: "Turn recruitment data into insights: build reporting dashboards, track hiring funnel metrics, and flag bottlenecks in the pipeline.",
    requirements: "Experience with SQL, spreadsheet modelling, and data visualization tools. Comfortable presenting findings to non-technical teams.",
  },
  {
    title: "Customer Support Executive", department: "Operations",
    description: "Be the first point of contact for candidates and client companies using the platform, resolving account and application queries.",
    requirements: "Excellent communication skills, patience under pressure, and basic familiarity with ticketing/helpdesk software.",
  },
];

// Same 3 demo accounts as app.js's seedIfNeeded(), same plaintext passwords
// (so the team can keep using them to log in) — but now hashed with bcrypt
// before they ever touch the database.
const USERS = [
  { name: "Hansi Perera", email: "hr@Altrium.test", password: "hr12345", role: "hr" },
  { name: "Nimal Fernando", email: "interviewer@Altrium.test", password: "interview123", role: "interviewer" },
  { name: "Amanda Silva", email: "manager@Altrium.test", password: "manager123", role: "manager" },
];

async function main() {
  for (const job of JOBS) {
    const [rows] = await pool.query("SELECT id FROM jobs WHERE title = :title LIMIT 1", { title: job.title });
    if (rows.length) { console.log(`Skip job (exists): ${job.title}`); continue; }
    await pool.query(
      "INSERT INTO jobs (id, title, department, description, requirements, status) VALUES (:id, :title, :department, :description, :requirements, 'open')",
      { id: uid("job"), ...job }
    );
    console.log(`Seeded job: ${job.title}`);
  }

  for (const u of USERS) {
    const [rows] = await pool.query("SELECT id FROM users WHERE email = :email LIMIT 1", { email: u.email.toLowerCase() });
    if (rows.length) { console.log(`Skip user (exists): ${u.email}`); continue; }
    const password_hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      "INSERT INTO users (id, name, email, password_hash, role) VALUES (:id, :name, :email, :password_hash, :role)",
      { id: uid("user"), name: u.name, email: u.email.toLowerCase(), password_hash, role: u.role }
    );
    console.log(`Seeded user: ${u.email} (role: ${u.role})`);
  }

  console.log("\nDemo login credentials (unchanged from the old app, now checked against bcrypt hashes):");
  USERS.forEach((u) => console.log(`  ${u.role.padEnd(12)} ${u.email}  /  ${u.password}`));

  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
