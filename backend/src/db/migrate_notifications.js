// One-off migration for databases created before the notifications table
// (PB-24 "Notify Assigned Interviewer") existed. Safe to re-run — checks
// INFORMATION_SCHEMA first. Fresh installs get this table automatically
// from schema.sql via db:init and don't need this script.
require("dotenv").config();
const pool = require("./pool");

async function tableExists(table) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table`,
    { db: process.env.DB_NAME, table }
  );
  return rows[0].c > 0;
}

async function main() {
  if (await tableExists("notifications")) {
    console.log("notifications table already exists, skipping");
  } else {
    await pool.query(`
      CREATE TABLE notifications (
        id          VARCHAR(40)  PRIMARY KEY,
        user_id     VARCHAR(40)  NOT NULL,
        message     VARCHAR(255) NOT NULL,
        interview_id VARCHAR(40) NULL,
        read_at     DATETIME     NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_notifications_user      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_notifications_interview FOREIGN KEY (interview_id) REFERENCES interviews(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log("Created notifications table");
  }
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
