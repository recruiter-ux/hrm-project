# [PROJECT_NAME] — Project Notes

> **Purpose of this file:** a complete context handoff. Paste it at the start of
> any new session so whoever (or whatever) picks up the work knows what was
> decided and why, without reading the whole codebase.
>
> **Keep it current.** When a decision changes, edit this file in the same
> commit as the code change.

**Last updated:** Phase 0 — initial scaffolding
**Company:** Hazel Mobile (AI and mobility apps studio)
**Product:** [PROJECT_NAME] — internal HR platform
**Directed by:** a non-developer product owner, module by module, across many
separate sessions. Favour clarity and explicit comments over cleverness.

---

## 1. Where the project stands

### Built (Phase 0)

- npm workspaces monorepo — NestJS API + Next.js web app
- PostgreSQL schema for Core HR via Prisma (9 tables), including effective-dated
  employment history
- Docker Compose for local Postgres + Redis
- GitHub Actions CI (format, lint, build)
- A health endpoint and a status page that prove the stack is wired together

### Deliberately NOT built yet

Do not add these without being asked — they are scheduled for later phases.

- **Authentication and authorisation.** The RBAC *tables* exist; nothing
  enforces them. There is no login, no session, no password, no JWT.
- **Employee UI.** No CRUD screens, no forms, no tables.
- **Every other module:** Recruitment/ATS, Attendance & Shifts, Leave,
  Dashboards, Notifications, Reporting, Payroll, Performance, AI features.
- **Tests.** No test runner is installed. Add Jest with the first real feature.

### Planned module order (MVP)

Core HR → Auth → Attendance & Shifts → Leave → Recruitment/ATS →
Dashboards → Notifications → Reporting.
Later: Payroll, Performance Management, AI features.

---

## 2. Stack and why

| Choice | Version | Reasoning |
| --- | --- | --- |
| Node.js | 24 LTS | Active LTS line, supported to April 2028. Pinned in `.nvmrc` and CI. |
| npm workspaces | npm 10+ | Explicitly chosen over Turborepo/Nx. One tool, no extra config, no build-graph concepts to learn. Revisit only if builds get slow. |
| NestJS | 11.x | Opinionated structure (modules/controllers/services). The rigidity is the point when many separate sessions touch the code. |
| Next.js | 15.x, App Router | React 19, server components available when needed. |
| PostgreSQL | 17 | Relational integrity matters for HR data. |
| Prisma | 6.x | Schema file doubles as readable documentation; migrations are generated and reviewable. |
| Redis | 7 | Not used yet. Present so local matches production later. |
| Tailwind CSS | 4.x | Included now so the UI phase does not need a styling retrofit. |
| TypeScript | 5.x, strict | `strict: true` in both apps. Do not weaken it. |

---

## 3. Folder structure

```
[PROJECT_NAME]/
├── apps/
│   ├── api/                    NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma   THE database schema — single source of truth
│   │   │   ├── seed.ts         Development sample data (safe to re-run)
│   │   │   └── migrations/     Generated SQL. Committed. Never edit by hand.
│   │   └── src/
│   │       ├── main.ts         Entry point: CORS, validation, /api prefix
│   │       ├── app.module.ts   Root module — register new modules HERE
│   │       ├── config/         Env parsing + start-up validation
│   │       ├── prisma/         PrismaService (global)
│   │       ├── redis/          RedisService (global, unused so far)
│   │       └── health/         GET /health
│   └── web/                    Next.js frontend
│       └── src/app/            App Router pages
├── packages/                   Empty. For shared code later.
├── .github/workflows/ci.yml
├── docker-compose.yml          Postgres + Redis only
├── .env.example                Copy to .env — ONE env file for everything
├── PROJECT_NOTES.md            This file
└── README.md                   How to run it
```

### Where new code goes

A new backend module (say Leave) means:

1. `apps/api/prisma/schema.prisma` — add the models, run `npm run prisma:migrate`
2. `apps/api/src/leave/` — `leave.module.ts`, `leave.controller.ts`,
   `leave.service.ts`, plus a `dto/` folder
3. `apps/api/src/app.module.ts` — add `LeaveModule` to `imports`
4. `apps/api/prisma/seed.ts` — register the module's permissions

---

## 4. The database schema in plain English

Nine tables. Two are join tables that exist only to connect the others.

> **The one thing to get straight before reading on.** Two words sound alike
> and mean completely different things:
>
> | Table | Means | Example |
> | --- | --- | --- |
> | `Role` | A **job title** — what someone is employed to do | "Software Engineer", "Recruiter" |
> | `AccessRole` | A **permission set** — what someone may do in this software | "HR Administrator", "Manager" |
>
> They are separate tables because they change independently. Promoting an
> engineer to Senior must not silently grant them access to salary data, and
> making someone an HR Administrator does not change their job.

### Employee — the centre of everything

One row per person employed by Hazel Mobile. Nearly every future table points
back here: attendance records, leave requests, payslips, performance reviews.

Key points:

- **`employeeNumber` is separate from `id` on purpose.** `id` is an opaque
  database key that should never appear on paperwork. `employeeNumber`
  (`HM-0042`) is the short human code for payroll files and ID badges.
- **An employee has one manager, and a manager has many reports.** This is a
  self-reference: `Employee.managerId` points at another `Employee`. It is
  nullable because the CEO has no manager. Leave approval routing and
  attendance anomaly **escalation** both climb this chain upward.
- **An employee belongs to at most one department** (`departmentId`) and holds
  one job title (`roleId`).
- **`workingTitle` is an optional free-text override.** Role says "Software
  Engineer"; the business card can say "Software Engineer II, Platform". This
  stops the `Role` table bloating with a near-duplicate row per person.
- **`timezone` is on the employee, with a default.** A 9am shift is a different
  instant in every office; attendance is meaningless without it. It is here
  from day one because backfilling it after attendance data exists is painful.
- **Employees are soft-deleted** (`deletedAt`), never removed — see §5.

> ⚠️ **Five fields on `Employee` are a cache, not the source of truth.**
> `roleId`, `departmentId`, `managerId`, `employmentType` and
> `workLocationType` describe *today only*. The real record is
> `EmploymentAssignment` — see below. Never write these five from anywhere
> except the one service method that also writes an assignment row.

### EmploymentAssignment — the career history

**One row = "between these two dates, this person held this job title, in this
department, reporting to this manager, on these terms."**

This is what lets the system answer questions the `Employee` table cannot:

- Which department was Ali in last March?
- When was Zara promoted, and from what?
- Who was this person's manager when they filed that leave request?

Payroll and Reporting both need those answers, and **history cannot be
reconstructed after the fact** — which is why this table exists before any real
employee data is loaded.

How it works:

- **`effectiveTo = NULL` means "this is the current arrangement".**
- **Exactly one row per employee may have `effectiveTo = NULL`.**
- Changing someone's job means, **in one transaction**: close the current row
  (set its `effectiveTo`), insert the new row, and update the cached fields on
  `Employee`. All three steps live in a single service method.
- **`reason`** (HIRE, PROMOTION, DEPARTMENT_TRANSFER, …) is what turns a list of
  rows into a readable career history, and what Reporting groups by. Note
  `DATA_CORRECTION` — it means "we fixed a typo", not a real-world event, so
  reports must exclude it.
- **Employment terms live here too** (`employmentType`, `workLocationType`),
  because an intern converting to full-time is a career event Payroll must see.
- **`status` deliberately does *not* live here.** It flips often (every leave of
  absence), and would drown the genuine job changes in noise.

> ⚠️ **One database rule Prisma cannot express.** Prisma has no syntax for a
> partial unique index, so "only one open assignment per employee" must be added
> by hand to the first migration — and it has to go in **before** that migration
> is applied:
>
> 1. `npm run prisma:migrate -- --create-only` (writes the SQL, does not run it)
> 2. append the `CREATE UNIQUE INDEX … WHERE "effective_to" IS NULL` statement
>    quoted in `schema.prisma` above the model
> 3. `npm run prisma:migrate` (applies the edited file)
>
> A plain `migrate dev` writes *and* applies in one step, leaving nothing to
> edit. Without the index, a bug can leave someone with two current jobs and
> every headcount report silently double-counts them.

### Role — job titles

One row per job title the company recognises. Kept as a table rather than free
text so that Recruitment can open a requisition against a defined role,
Reporting can group headcount by role and job family, and Performance can hang
career ladders off it.

- **`jobFamily`** groups related titles ("Engineering", "People") for reporting
  and career paths.
- **`level` is a plain number, not an enum.** Every company reworks its
  levelling eventually; a number can be re-mapped without a database migration,
  and it sorts correctly, which an enum does not.
- **Salary bands are deliberately absent.** That is Payroll, and compensation
  data needs its own access controls.

### Department — the org chart

- **Departments nest inside other departments** via `parentId`: Engineering →
  Mobile Engineering → iOS. Reporting needs roll-ups ("headcount for
  Engineering and everything beneath it"), and DEPARTMENT-scoped permissions
  need to include sub-departments. A flat list cannot express either.
- **A department has a head** (`headEmployeeId`) — the fallback approver when
  someone's direct manager is away, and the last step in escalation.
- Employee → Department and Department → Employee both exist, pointing in
  opposite directions. That is intentional, not a mistake.

### AccessRole and Permission — who can do what in the software

Entirely separate from job titles. How the pieces connect:

```
Employee ──(EmployeeAccessRole)──> AccessRole ──(AccessRolePermission)──> Permission
```

- **A person can hold several access roles at once** — a team lead who also
  recruits is "Manager" + "Recruiter". Hence the `EmployeeAccessRole` join
  table, which also records **who granted the access and when** (the first
  question any audit asks) and an optional `expiresAt` for temporary elevation.
- **An access role holds many permissions, and a permission belongs to many
  access roles.** Hence `AccessRolePermission`.
- **Permissions are `resource` + `action`** (`leave_request:approve`), never
  free-form strings. Every future module registers its permissions the same
  way, so the admin screen can group hundreds of them automatically.

#### The single most important design decision: `PermissionScope`

`AccessRolePermission` carries a `scope` column — `SELF`, `TEAM`,
`DEPARTMENT`, or `GLOBAL`.

Plain English: *"can read employees"* is not one permission, it is four. HR
reads everyone. A department head reads their department. A manager reads their
direct reports. An employee reads only themselves.

Both "Manager" and "HR Administrator" hold `employee:read` — the scope is what
makes them mean different things. Without this column, Leave approval,
Attendance visibility, and Payroll access all become hardcoded `if` statements
scattered through the codebase.

This is why `AccessRolePermission` is an explicit table rather than Prisma's
implicit many-to-many: an implicit join table cannot carry extra columns.

#### Planned, not built: birthright access

A `Role.defaultAccessRoles` link, so that hiring someone with the job title
"Recruiter" automatically grants them the "Recruiter" access role. It is a pure
join table and can be added later with no data migration, so it was left out of
Phase 0. Until then, access is granted explicitly per person.

### Document — employee files

- **The file itself is not stored in the database.** Only metadata plus
  `storageKey`, a pointer into object storage (S3/Azure Blob in production, a
  local folder in development). Storing binaries in Postgres bloats every
  backup and migration.
- **`storageKey` is not a public URL.** Access goes through short-lived signed
  URLs generated per request, so permission checks cannot be bypassed by
  sharing a link.
- **`expiresAt` is indexed** because visas, work permits, and certifications
  lapse. "What expires in the next 60 days?" becomes a scheduled notification
  and a compliance report.
- **`isConfidential`** marks medical and disciplinary records as HR-only.
- **Ownership is a nullable foreign key per owner type.** Today the only owner
  is an Employee. When the ATS arrives, documents will also belong to
  candidates — that is added as a second nullable `candidateId` column, **not**
  by switching to a generic `ownerType`/`ownerId` pair. Generic pointers look
  flexible but throw away the database's ability to guarantee the referenced
  row actually exists.

---

## 5. Conventions

### Database

- **Primary keys are `cuid()` strings, not auto-incrementing integers.**
  Sequential integers leak business information — anyone seeing `/employees/47`
  learns the company has ~47 employees. They also collide when merging data
  from an acquired company or an external ATS.
- **Prisma is camelCase, Postgres is snake_case,** bridged by `@map`/`@@map`.
  The Reporting module will have people writing raw SQL against these tables,
  and snake_case is the Postgres convention.
- **Table names are plural** (`employees`, `access_role_permissions`).
- **`Employee`'s five assignment fields are a cache.** `roleId`,
  `departmentId`, `managerId`, `employmentType`, `workLocationType` must only
  ever be written by the same service method that writes an
  `EmploymentAssignment` row, in one transaction. Writing them from anywhere
  else silently desynchronises the history from the present.
- **Soft delete via `deletedAt`.** HR records must be retained for tax, payroll,
  and audit reasons after someone leaves.
  ⚠️ **Prisma does not enforce this.** Every query must filter
  `deletedAt: null` by hand until the Auth/Core phase adds a Prisma extension
  to apply it globally. This is a live footgun.
- **Every table has `createdAt` and `updatedAt`.**
- **Migrations are committed and never hand-edited.** Change
  `schema.prisma`, then run `npm run prisma:migrate`.

### Backend

- **One module per business area.** Controller handles HTTP; service holds
  logic; Prisma is only touched from services.
- **`process.env` appears only in `src/config/configuration.ts`.** Everything
  else reads through `ConfigService`, so there is one place to look when an
  environment variable is wrong.
- **Missing config fails at start-up, loudly** (`src/config/env.validation.ts`),
  rather than throwing a confusing error on the first database query.
- **`/api` prefix on everything except `/health`**, which stays at the root
  because uptime monitors conventionally probe there.
- **Global `ValidationPipe`** with `whitelist` and `forbidNonWhitelisted` — once
  DTOs exist, unexpected fields are rejected rather than silently ignored.

### General

- Single `.env` at the repo root, read by Docker Compose, Prisma, and the API.
  Prisma reaches it via `dotenv-cli` in the npm scripts (Prisma does not search
  parent folders in a monorepo).
- Prettier is the formatter; `format:check` runs in CI.
- Ports: web **3000**, API **4000**, Postgres **5432**, Redis **6379**.

---

## 6. Known limitations and deferred decisions

Read this section before designing any new module.

### The employment-history invariant is not enforced by code yet (the big one)

`EmploymentAssignment` exists and the schema is right, but **nothing yet stops
it going wrong.** Two specific gaps:

1. **The partial unique index must be added by hand** to the first generated
   migration — SQL is in `schema.prisma` above the model, and repeated in §4.
   Until it exists, an employee can end up with two "current" assignments.
2. **The transactional service method does not exist.** The seed writes the
   `Employee` cache and the assignment rows in separate steps, which is fine for
   fixed sample data but is *not* the pattern for real code.

**Build `EmploymentAssignmentService.changeAssignment()` as the first piece of
Core HR business logic**, before any screen can edit an employee. It must, in
one transaction: close the open assignment, insert the new one, and update the
five cached fields on `Employee`.

### No status history

`Employee.status` (PROBATION → ACTIVE → ON_LEAVE …) has no history table. This
was deliberate — status flips far more often than job assignments and would
drown the career history in noise. If "how long was this person on leave last
year?" becomes a real question, derive it from the Leave module rather than
adding status rows to `EmploymentAssignment`.

### Employee is not the login entity

When Auth is built, add a separate `User` table with an optional `employeeId`
rather than putting passwords on `Employee`. They are genuinely different
things: not every employee logs in (contractors, floor staff), and not every
user is an employee (external recruiters, auditors, ATS candidates).

### Employee is not the login entity

When Auth is built, add a separate `User` table with an optional `employeeId`
rather than putting passwords on `Employee`. They are genuinely different
things: not every employee logs in (contractors, floor staff), and not every
user is an employee (external recruiters, auditors, ATS candidates).

### No audit log

Who changed a salary, and when? Add a generic `AuditLog` table
(`actorId`, `entityType`, `entityId`, `action`, `before`, `after`, `at`) during
the Auth phase, when there is finally an actor to record.

### Open security items

- `Employee.dateOfBirth` and `nationalId` are regulated personal data stored in
  plain columns. Decide on pgcrypto or application-level encryption **before**
  real records are loaded.
- No rate limiting, no helmet/security headers, no request logging. All belong
  with the Auth phase.
- The seed's sample data uses realistic-looking names and emails. Never point
  the seed at a production database.

### Single-tenant by design

One company, one database. No `organisationId` anywhere. If Hazel Mobile ever
sells this externally, that is a significant refactor — deliberately deferred
rather than paying the complexity cost now for a maybe.

### Not yet decided

- Hosting/deployment target (nothing in CI deploys)
- Object storage provider for documents
- Email/notification provider
- Whether the web app talks to NestJS directly or through Next.js route handlers

---

## 7. ⚠️ `[PROJECT_NAME]` placeholder — read before renaming

There are **two** placeholder tokens, because `[PROJECT_NAME]` is not a legal
identifier in several of the places a name is needed.

| Token | Used for | Why |
| --- | --- | --- |
| `[PROJECT_NAME]` | Prose, UI text, page titles, comments | Human-readable |
| `project-name` | npm package names, Docker names | npm forbids uppercase and `[` `]` |
| `project_name` | Postgres database name | Postgres identifier rules |

**Search for all three.** From the repo root:

```bash
git grep -n -e "PROJECT_NAME" -e "project-name" -e "project_name"
```

### Places that are awkward to change — check these specifically

| Location | Value | Why it is awkward |
| --- | --- | --- |
| `.env` / `.env.example` | `POSTGRES_DB=project_name_dev` | Renaming needs the database recreated. Do `npm run db:nuke`, rename, then `npm run db:up && npm run prisma:migrate && npm run db:seed`. **All local data is lost** — fine now, not later. |
| `.env` / `.env.example` | `DATABASE_URL` | Contains the database name again. Must match `POSTGRES_DB` or nothing connects. |
| `docker-compose.yml` | `name:`, `container_name`, volume `name:` | Renaming a volume **orphans the old one** — Docker creates a fresh empty volume and the old data is invisible (though still on disk taking space). Run `npm run db:nuke` *before* renaming. |
| `package.json` (all three) | `@project-name/api`, `@project-name/web` | The npm **scope**. Referenced in root scripts (`-w @project-name/api`). Rename all of them together or `npm run dev` breaks. |
| Root `package.json` | `"name": "project-name"` | Must stay lowercase, no spaces, no brackets. |
| Repo folder | `D:\WORK\HRM` | Currently `HRM`, not the placeholder. Rename before `git init` if you want it to match — otherwise harmless. |
| Git remote URL | set at push time | Renaming the GitHub repo later requires `git remote set-url`. |

### Safe to change any time

Page titles, `<title>` metadata, README/PROJECT_NOTES prose, code comments, the
CI workflow name, the health endpoint's `service` string.

### Not yet present, but will need the name

JWT issuer/audience (Auth phase), Redis key prefix, email "from" name, S3
bucket name. **Decide the name before those land** — they are much harder to
rename once they hold live values.

---

## 8. Session start checklist

When starting a new session on this project:

1. Read this file and `README.md`.
2. `npm run db:up` — start Postgres and Redis.
3. `npm run dev` — start both apps.
4. Open <http://localhost:3000> — all four indicators should be green.
5. Confirm which module is being built, and check §6 for anything that must be
   settled first.
