const express = require("express");
const asyncHandler = require("../asyncHandler");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

const router = express.Router();

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
}

// POST /api/auth/register
// Same fields/validation as the old Register() component (name, email,
// password >= 6 chars, role, reject duplicate email) except the password
// is now bcrypt-hashed before it is ever stored.
router.post("/register", asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  if (!["hr", "interviewer", "manager"].includes(role)) {
    return res.status(400).json({ error: "Role must be one of: hr, interviewer, manager." });
  }

  const normalizedEmail = email.toLowerCase();
  const [existing] = await pool.query("SELECT id FROM users WHERE email = :email LIMIT 1", { email: normalizedEmail });
  if (existing.length) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const id = uid("user");
  await pool.query(
    "INSERT INTO users (id, name, email, password_hash, role) VALUES (:id, :name, :email, :password_hash, :role)",
    { id, name, email: normalizedEmail, password_hash, role }
  );

  const user = { id, name, email: normalizedEmail, role };
  res.status(201).json({ token: signToken(user), user });
}));

// POST /api/auth/login
// Same lookup as the old Login() component (find by email, compare
// password) except the comparison is bcrypt.compare against a hash
// instead of a plaintext === check, and a signed token is returned
// instead of the raw user object being written straight into
// localStorage with nothing to stop it being edited by hand.
router.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const normalizedEmail = email.toLowerCase();
  const [rows] = await pool.query("SELECT * FROM users WHERE email = :email LIMIT 1", { email: normalizedEmail });
  const dbUser = rows[0];

  // Same generic error for "no such user" and "wrong password" as the old
  // app (setError("Incorrect email or password.")) so a login attempt
  // can't be used to enumerate which emails are registered.
  if (!dbUser) return res.status(401).json({ error: "Incorrect email or password." });

  const ok = await bcrypt.compare(password, dbUser.password_hash);
  if (!ok) return res.status(401).json({ error: "Incorrect email or password." });

  const user = { id: dbUser.id, name: dbUser.name, email: dbUser.email, role: dbUser.role };
  res.json({ token: signToken(user), user });
}));

module.exports = router;
