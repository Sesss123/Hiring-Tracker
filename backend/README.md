# HireLine Backend (Express + MySQL)

This replaces the old app's "database" (everything in the browser's
`localStorage`, plaintext passwords, zero server-side checks) with a real
Node.js/Express API backed by MySQL, with bcrypt-hashed passwords and
JWT-based login. Every table and field name here was traced directly from
`app.js`'s `KEYS` object and every place it reads/writes each entity — see
the comments in `src/db/schema.sql` and each route file for the exact line
each endpoint replaces.

## 1. Install prerequisites (on your own Windows machine, not inside Cowork)

This project could not be `npm install`-ed or have MySQL installed for you
automatically from this session — the sandboxed workspace Cowork runs
commands in in this session has no general internet access (npm's
registry, MySQL's download servers, etc. are all blocked by the account's
network policy). Do this part yourself, once, in a normal terminal:

1. Install **Node.js** (v18+) from https://nodejs.org if you don't have it:
   `node -v` should work in PowerShell/cmd afterwards.
2. Install **MySQL Server** (Community Server, free) from
   https://dev.mysql.com/downloads/mysql/ — during setup, set a root
   password and remember it.
3. Create a dedicated app user + database login (don't use root from the
   app). In MySQL Workbench or the `mysql` command line:
   ```sql
   CREATE USER 'hireline_app'@'localhost' IDENTIFIED BY 'pick-a-real-password';
   GRANT ALL PRIVILEGES ON hireline.* TO 'hireline_app'@'localhost';
   FLUSH PRIVILEGES;
   ```
   (The `hireline` database itself is created for you by `npm run db:init`
   below — you don't need to create it by hand.)

## 2. Configure

In this `backend/` folder:

```
copy .env.example .env
```

Then edit `.env` and fill in the real `DB_PASSWORD` you set above, and
replace `JWT_SECRET` with a random string (the comment in `.env.example`
shows a one-line command to generate one).

## 3. Install dependencies and set up the database

From inside `backend/`:

```
npm install
npm run db:init
npm run db:seed
```

- `db:init` runs `src/db/schema.sql`, which creates the `hireline`
  database and all 8 tables (users, jobs, applicants, candidates,
  interviews, feedback, decisions, contact_messages).
- `db:seed` loads the same demo data the old app used to seed into
  `localStorage` on first run — the 6 sample jobs and the 3 demo staff
  accounts — except passwords are now bcrypt-hashed before they're stored.
  The demo logins are unchanged for the team's convenience:

  | Role        | Email                      | Password      |
  |-------------|----------------------------|----------------|
  | hr          | hr@Altrium.test            | hr12345        |
  | interviewer | interviewer@Altrium.test   | interview123   |
  | manager     | manager@Altrium.test       | manager123     |

## 4. Run it

```
npm start
```

The API listens on `http://localhost:4000` (change `PORT` in `.env` if
that's taken). `GET /api/health` should return `{"ok":true}`.

## What this fixes from the old app

- **Passwords were plaintext** in `localStorage` (`{ id, name, email,
  password, role }`, compared with `===` in `Login()`). Now: bcrypt-hashed
  in MySQL, checked with `bcrypt.compare`, and login returns a signed JWT
  instead of the client just trusting whatever `hl_session` object it
  finds in its own storage.
- **No server-side authorization at all.** Every "HR only" / "interviewer
  only" / "manager only" boundary in the old app was enforced purely by
  which React component happened to render — nothing stopped a browser
  console from calling the same functions regardless of role. Every route
  here checks `requireAuth` + `requireRole(...)` server-side.
- **No real database** — a browser refresh with storage cleared, or a
  second device, meant totally different data. Now it's one shared MySQL
  database every client talks to over the API.

## Deliberate deviations from the old app's exact behaviour (flagged, not silent)

- `POST /api/interviews` returns a real `400` if `interviewerId` or
  `scheduledAt` is missing. The old `submitSchedule()` in `app.js` just
  silently did nothing (`if (!scheduleForm.interviewer_id || …) return;`)
  with no error shown to HR — this was flagged repeatedly as a real bug in
  this project's own risk notes. Fixed here rather than reproduced.
- Feedback submission now checks that the logged-in interviewer is the one
  the interview was actually assigned to (`403` otherwise). The old app
  had no equivalent check at all — it was only ever safe because the UI
  never showed another interviewer's interviews.
- Login now returns the same generic "Incorrect email or password" for
  both "no such user" and "wrong password" (same as before) — this was
  already correct in the old app and is preserved, not changed.

## What this backend does not do yet (scope, not oversight)

- **CV files themselves** (the actual PDF/DOCX bytes) still need to live
  wherever the frontend puts them — the old app stores them in the
  browser's IndexedDB (`hl_cv_files`, keyed by `fileId`) specifically to
  avoid the earlier `localStorage` crash bug. This backend stores
  `resume_file_id` / `resume_file_name` / `resume_file_type` (the
  metadata) and the extracted `resume_text` used for scoring, but not the
  binary file. Migrating the file storage itself to the server (e.g. to
  disk or an object store) is a separate piece of work the team should
  scope deliberately, not something to bolt on silently here.
- **PB-24 (Notify Assigned Interviewer)** — still has no backend support
  here either, consistent with it having zero code in the current app.

## Frontend wiring (`app.js`)

`app.js` has been rewired to call this API instead of `localStorage`.
Every `load(KEYS.x)` / `save(KEYS.x, …)` call site was replaced with an
`api.*` call (see the `const api = {...}` block near the top of
`app.js`, and `apiFetch()`/`authHeaders()` just above it), and `hl_session`
now stores `{ ...user, token }` — the JWT this backend issues — sent as
`Authorization: Bearer <token>` on every request. `API_BASE` is
hardcoded to `http://localhost:4000/api`; change it there if you run the
backend on a different host/port.

Two things were **removed** from `app.js` as part of this, not silently
dropped:
- `seedIfNeeded()` — the backend's `npm run db:seed` is now the one
  source of demo data, so the frontend no longer seeds its own copy into
  `localStorage` on first load.
- `resetAllData()` and its two "Reset demo data" UI entry points — wiping
  a shared MySQL database from one browser is a different, riskier
  operation than clearing your own `localStorage` was, and needs a
  deliberate team decision (e.g. a proper `npm run db:seed`-based reset
  script) rather than a leftover client button quietly doing it.

Because of this, running the app now **requires the backend to actually
be running** (`npm start` in this folder) — opening `index.html` on its
own is no longer enough, and every screen that talks to the API will show
"Could not reach the HireLine server" until it is.

## Project structure

```
backend/
  package.json
  .env.example
  src/
    server.js            entry point, mounts every router
    asyncHandler.js       wraps async route handlers so DB errors reach the error handler instead of hanging the request
    matching.js           the AI-match / CV-similarity scoring, ported verbatim from app.js
    camelCase.js           toCamel() — converts MySQL's snake_case columns to the camelCase keys app.js already expects
    auth/middleware.js     requireAuth (JWT) + requireRole (hr/interviewer/manager)
    db/schema.sql          CREATE DATABASE + all 8 tables, with the real field names traced from KEYS
    db/pool.js             mysql2 connection pool
    db/init.js             runs schema.sql (npm run db:init)
    db/seed.js             loads demo jobs + demo users with hashed passwords (npm run db:seed)
    routes/auth.routes.js        /api/auth/register, /api/auth/login
    routes/jobs.routes.js        /api/jobs (+ /:id/status)
    routes/applicants.routes.js  /api/applicants (+ /:id/status, /:id/promote, /cv-similarity)
    routes/candidates.routes.js  /api/candidates (+ /:id/pin)
    routes/interviews.routes.js  /api/interviews
    routes/feedback.routes.js    /api/feedback (bulk list at "/", nested at "/interviews/:interviewId")
    routes/decisions.routes.js   /api/decisions (bulk list at "/", nested at "/applicants/:id")
    routes/messages.routes.js    /api/messages
    routes/users.routes.js       /api/users (?role= filter) — staff directory for interviewer dropdowns and name lookups
```
