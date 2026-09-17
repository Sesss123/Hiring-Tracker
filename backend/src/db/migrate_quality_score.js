// One-off migration for databases created before quality_score/quality_breakdown
// were added to applicants in schema.sql (Gemini-powered CV Quality Score
// feature). Safe to re-run: checks INFORMATION_SCHEMA before altering.
// Fresh installs get these columns automatically from schema.sql via db:init
// and don't need this script.
require("dotenv").config();
const pool = require("./pool");

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { db: process.env.DB_NAME, table, column }
  );
  return rows[0].c > 0;
}

async function main() {
  if (!(await columnExists("applicants", "quality_score"))) {
    await pool.query("ALTER TABLE applicants ADD COLUMN quality_score INT NULL AFTER missing_keywords");
    console.log("Added applicants.quality_score");
  } else {
    console.log("applicants.quality_score already exists, skipping");
  }

  if (!(await columnExists("applicants", "quality_breakdown"))) {
    await pool.query("ALTER TABLE applicants ADD COLUMN quality_breakdown JSON NULL AFTER quality_score");
    console.log("Added applicants.quality_breakdown");
  } else {
    console.log("applicants.quality_breakdown already exists, skipping");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
