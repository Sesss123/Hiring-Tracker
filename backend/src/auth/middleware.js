const jwt = require("jsonwebtoken");

// Reads "Authorization: Bearer <token>", verifies it, and attaches the
// decoded { id, email, role } to req.user. This is what replaces the old
// app's approach of trusting whatever user object the client kept in
// localStorage (hl_session) with nothing checking it server-side.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing or invalid Authorization header." });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

// requireRole("hr") or requireRole("hr", "manager") — enforces the same
// role boundaries the old app only enforced client-side via which
// dashboard component happened to render.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
