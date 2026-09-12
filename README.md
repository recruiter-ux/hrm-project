# [PROJECT_NAME]

Internal HR platform for **Hazel Mobile**.

**Status: Phase 1 — login, permissions, and employee management.** You can sign
in, browse and edit employees, upload documents, and view the org chart. What
each person can see depends on their access level.

For *why* things were built this way, see **[PROJECT_NOTES.md](PROJECT_NOTES.md)**.

---

## What is in here

| Piece | What it does | Runs at |
| --- | --- | --- |
| **API** (NestJS) | The backend. Talks to the database. | http://localhost:4000 |
| **Web** (Next.js) | The website you look at. | http://localhost:3000 |
| **Postgres** | The database where HR data lives. | port 5432 |
| **Redis** | A fast cache. Nothing uses it yet. | port 6379 |

Postgres and Redis run inside **Docker**, so you do not install them yourself.

---

## Step 1 — Install the two tools you need

You only do this once. **Neither is currently installed on this machine.**

### Node.js 24 LTS

Download and run the Windows installer: <https://nodejs.org/en/download>
Choose the **LTS** version. Accept every default.

### Docker Desktop

Download and run: <https://www.docker.com/products/docker-desktop/>
After installing, **launch Docker Desktop and leave it running.** You should see
a whale icon in your system tray. Nothing below works if Docker is not running.

### Confirm both worked

**Close and reopen your terminal first** (installers change settings that only
apply to new terminals), then run:

```bash
node --version
```

```bash
docker --version
```

You want a version number from each, e.g. `v24.x.x`. If you get
"not recognized", restart your computer and try again.

---

## Step 2 — Set up the project

Run these from the project folder (`D:\WORK\HRM`), one at a time, waiting for
each to finish.

### 2a. Create your settings file

```bash
copy .env.example .env
```

This creates your local settings. You do not need to edit it — the defaults work
for local development. It is deliberately excluded from git so passwords never
get pushed.

### 2b. Install and start everything

```bash
npm run setup
```

This one command does five things: installs dependencies, starts the database
containers, generates the database client, creates all the tables, and fills
them with sample staff data.

**It takes a few minutes the first time.** It downloads a lot. Later runs are fast.

---

## Step 3 — Run it

```bash
npm run dev
```

This starts the API and the website together, and stays running. Log messages
from both appear in the same window, colour-coded `api` and `web`.

**Leave this window open.** To stop everything, press `Ctrl + C`.

---

## Step 4 — Confirm it is working

Open <http://localhost:3000> in your browser. You should see a sign-in screen.

Sign in with any of these. **The password for all of them is `Password123!`**

| Email | What they can see |
| --- | --- |
| `sana.iqbal@hazelmobile.com` | HR administrator — everyone |
| `bilal.khan@hazelmobile.com` | Department head — Engineering and its sub-teams |
| `omar.farooq@hazelmobile.com` | Manager — himself and his direct reports |
| `zara.ahmed@hazelmobile.com` | Employee — only herself |

Signing in as two different people and comparing what they see is the quickest
way to confirm permissions are working.

These accounts exist only because the seed script creates them. Adding an
employee through the UI does **not** create a login — that comes in Phase 2.

### Two extra checks (optional)

**See the raw API response** — open <http://localhost:4000/health>. You should
get a block of text starting with `{"status":"ok"`. This is the only endpoint
that works without signing in; everything else returns "Unauthorized" by design.

**See the sample data in the database** — in a *second* terminal window:

```bash
npm run prisma:studio
```

This opens a spreadsheet-like database browser at <http://localhost:5555>.
Click **employees** and you should see 7 sample Hazel Mobile staff.

Then click **employment_assignments** — 12 rows showing each person's career
history: who was promoted, who moved department, and who converted from intern
to full-time. That table is the reason the system can answer "which department
was this person in last March?".

Close Studio with `Ctrl + C` when done.

---

## Everyday commands

Run these from the project folder.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the API and website. **The main one.** |
| `npm run db:up` | Start the database containers. |
| `npm run db:down` | Stop the database containers (data is kept). |
| `npm run prisma:studio` | Browse the database in your browser. |
| `npm run db:seed` | Re-add the sample data. Safe to run repeatedly. |
| `npm run lint` | Check the code for mistakes. |
| `npm run build` | Check that everything compiles, as CI does. |
| `npm run format` | Auto-tidy formatting across the project. |

### After changing the database schema

Only relevant when `apps/api/prisma/schema.prisma` changes:

```bash
npm run prisma:migrate
```

It asks for a short name for the change (e.g. `add_leave_tables`), then updates
the database and writes a migration file to commit.

---

## If something goes wrong

### "docker: command not found" or the containers will not start

Docker Desktop is not running. Open it from the Start menu, wait for the whale
icon to stop animating, then try again.

### "Port 5432 is already in use"

Another Postgres is running on your machine. Open `.env` and change:

```
POSTGRES_PORT=5433
```

Then in the same file change `5432` to `5433` inside `DATABASE_URL` too. Then:

```bash
npm run db:down
```

```bash
npm run db:up
```

### "Port 3000 is already in use"

Something else is using it. Close it, or change the port in
`apps/web/package.json` (the `-p 3000` part).

### The status page shows red for Database

The database containers are not running. In a second terminal:

```bash
npm run db:up
```

Then click **Re-check** on the status page.

### Nothing works and you want a clean slate

⚠️ **This deletes all local database data,** including the sample staff. That is
fine right now — there is nothing real in there.

```bash
npm run db:nuke
```

```bash
npm run setup
```

---

## Push this to GitHub

Git has already been initialised here with an initial commit. To publish it:

**1.** On GitHub, create a **new empty repository**. Do *not* tick "Add a
README", "Add .gitignore", or "Choose a license" — this project already has
them, and pre-filled files cause a conflict on the first push.

**2.** Copy the repository URL GitHub shows you, then run these three commands,
replacing the URL with yours:

```bash
git remote add origin https://github.com/YOUR-ORG/YOUR-REPO.git
```

```bash
git branch -M main
```

```bash
git push -u origin main
```

**3.** Refresh the GitHub page — your files will be there. Click the **Actions**
tab to watch the CI checks run. A green tick means lint and build passed.

After this first push, future updates are:

```bash
git add .
```

```bash
git commit -m "Describe what you changed"
```

```bash
git push
```

> **Note:** run `npm run setup` (or at least `npm install`) *before* your first
> push, so that `package-lock.json` exists and gets committed. It pins exact
> dependency versions so CI and your machine install identically.

---

## A note on the project name

`[PROJECT_NAME]` is a placeholder. When you settle on the real name, see
**[PROJECT_NOTES.md § 7](PROJECT_NOTES.md#7-️-project_name-placeholder--read-before-renaming)** —
it lists every place the name appears and flags the few that are awkward to
change once there is real data.

Short version: there are **three** tokens to replace, not one —
`[PROJECT_NAME]`, `project-name`, and `project_name`.
