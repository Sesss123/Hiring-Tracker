// One-off migration: makes interviews.interviewer_id nullable, so
// Schedule Interview (PB-16) and Assign Interviewer (PB-17) can be
// genuinely separate steps instead of one combined call. Safe to re-run.
require("dotenv").config();
const pool = require("./pool");

async function main() {
  const [rows] = await pool.query(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'interviews' AND COLUMN_NAME = 'interviewer_id'`,
    { db: process.env.DB_NAME }
  );
  if (rows[0] && rows[0].IS_NULLABLE === "YES") {
    console.log("interviews.interviewer_id is already nullable, skipping");
  } else {
    await pool.query("ALTER TABLE interviews MODIFY COLUMN interviewer_id VARCHAR(40) NULL");
    console.log("interviews.interviewer_id is now nullable");
  }
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
