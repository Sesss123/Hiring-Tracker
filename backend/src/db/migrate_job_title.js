// One-off migration: adds users.job_title, a purely descriptive field
// (not used in access control — see schema.sql's comment) so an account
// with role 'manager' can be labeled e.g. "Operations Manager" in the UI
// without adding a new role/ENUM value. Safe to re-run.
require("dotenv").config();
const pool = require("./pool");

async function main() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'job_title'`,
    { db: process.env.DB_NAME }
  );
  if (rows[0].c > 0) {
    console.log("users.job_title already exists, skipping");
  } else {
    await pool.query("ALTER TABLE users ADD COLUMN job_title VARCHAR(80) NULL AFTER role");
    console.log("Added users.job_title");
  }
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
