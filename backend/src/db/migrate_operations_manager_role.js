// One-off migration: adds 'operations_manager' as a 4th value to
// users.role ENUM. A real, distinct-access role (not a cosmetic
// job_title): it can view the Reporting Dashboard but cannot make or
// undo hiring decisions, unlike 'manager' which can do both. Safe to
// re-run — checks the current ENUM definition first.
require("dotenv").config();
const pool = require("./pool");

async function main() {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
    { db: process.env.DB_NAME }
  );
  if (rows[0] && rows[0].COLUMN_TYPE.includes("operations_manager")) {
    console.log("users.role already includes 'operations_manager', skipping");
  } else {
    await pool.query("ALTER TABLE users MODIFY COLUMN role ENUM('hr','interviewer','manager','operations_manager') NOT NULL");
    console.log("users.role now includes 'operations_manager'");
  }
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
