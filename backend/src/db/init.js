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
  console.log("Schema applied: database 'hireline' and all tables are ready.");
  await connection.end();
}

main().catch((err) => {
  console.error("Failed to initialise database:", err.message);
  process.exit(1);
});
