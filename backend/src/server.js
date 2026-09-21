require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const jobsRoutes = require("./routes/jobs.routes");
const applicantsRoutes = require("./routes/applicants.routes");
const candidatesRoutes = require("./routes/candidates.routes");
const interviewsRoutes = require("./routes/interviews.routes");
const feedbackRoutes = require("./routes/feedback.routes");
const decisionsRoutes = require("./routes/decisions.routes");
const messagesRoutes = require("./routes/messages.routes");
const usersRoutes = require("./routes/users.routes");
const notificationsRoutes = require("./routes/notifications.routes");

if (!process.env.JWT_SECRET) {
  console.error("Missing JWT_SECRET in .env — refusing to start (see .env.example).");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" })); // resume_text can be a few pages of plain text

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/jobs", jobsRoutes);
app.use("/api/applicants", applicantsRoutes);
app.use("/api/candidates", candidatesRoutes);
app.use("/api/interviews", interviewsRoutes);
app.use("/api/feedback", feedbackRoutes);   // bulk list at "/", nested at "/interviews/:interviewId"
app.use("/api/decisions", decisionsRoutes); // bulk list at "/", nested at "/applicants/:id"
app.use("/api/messages", messagesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/notifications", notificationsRoutes);

// Central error handler so a thrown/rejected promise in any route becomes
// a clean 500 with no stack trace leaked to the client, instead of the
// server crashing or Express's default HTML error page.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`HireLine backend listening on http://localhost:${PORT}`));
