// Creates the hireline database and every table from schema.sql.
// Run once per machine: npm run db:init
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

  // Connect WITHOUT selecting a database yet, since schema.sql itself
  // contains "CREATE DATABASE IF NOT EXISTS hireline".
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });

  console.log("Connected. Applying schema.sql ...");
  await connection.query(schema);

  // MySQL does not consistently support `ADD COLUMN IF NOT EXISTS` across
  // Railway versions. Check the existing table first so upgrades remain
  // idempotent without stopping the rest of schema.sql halfway through.
  const [resumeColumns] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = 'hireline'
        AND TABLE_NAME = 'applicants'
        AND COLUMN_NAME IN ('resume_file_size', 'resume_file_data')`
  );
  const existingColumns = new Set(resumeColumns.map((row) => row.COLUMN_NAME));

  if (!existingColumns.has("resume_file_size")) {
    await connection.query(
      "ALTER TABLE hireline.applicants ADD COLUMN resume_file_size BIGINT UNSIGNED NULL AFTER resume_file_id"
    );
  }
  if (!existingColumns.has("resume_file_data")) {
    await connection.query(
      "ALTER TABLE hireline.applicants ADD COLUMN resume_file_data LONGBLOB NULL AFTER resume_file_size"
    );
  }

  console.log("Schema applied: database 'hireline' and all tables are ready.");
  await connection.end();
}

main().catch((err) => {
  console.error("Failed to initialise database:", err.message);
  process.exit(1);
});
