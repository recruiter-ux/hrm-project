# Velixa HR — Project Notes

> **Purpose of this file:** a complete context handoff. Paste it at the start of
> any new session so whoever (or whatever) picks up the work knows what was
> decided and why, without reading the whole codebase.
>
> **Keep it current.** When a decision changes, edit this file in the same
> commit as the code change.

**Last updated:** Phase 1 — authentication, permissions, employee management
**Company:** Hazel Mobile (AI and mobility apps studio)
**Product:** Velixa HR — internal HR platform
**Directed by:** a non-developer product owner, module by module, across many
separate sessions. Favour clarity and explicit comments over cleverness.

---

## 1. Where the project stands

### Built (Phase 0 — scaffolding)

- npm workspaces monorepo — NestJS API + Next.js web app
- PostgreSQL schema for Core HR via Prisma, including effective-dated
  employment history
- Docker Compose for local Postgres + Redis
- GitHub Actions CI (format, lint, build)
- A health endpoint and a status page that prove the stack is wired together

### Built (Phase 1 — auth, permissions, employees)

- **Authentication.** JWT access + refresh tokens in httpOnly cookies, refresh
  rotation, server-side revocation, account lockout. 11 tables now.
- **Permission enforcement.** Both guards are global; the `PermissionScope`
  system actually restricts what each person can see and do.
- **Employee CRUD.** Directory, profile, create, edit — all scope-aware.
- **Employment history enforcement.** Job changes can only happen through the
  transactional service. The shortcut is rejected by the API.
- **Document upload/download** with a storage abstraction and confidentiality
  controls.
- **Org chart** built from current reporting lines.

### Built (Phase 2, Module 1 — Leave Management)

**Backend complete and verified. UI complete and rendering, but three actions
were only exercised through the API, not clicked in a browser — see §10.**

- Leave types, balances, requests, and the approval flow (14 tables now)
- All six validation rules enforced and tested
- Permission scoping respected throughout
- Three screens: My leave, Request leave, Leave approvals

### Deliberately NOT built yet

Do not add these without being asked — they are scheduled for later phases.

- **User account provisioning.** Creating an employee does NOT create a login.
  There is no invite email, no self-service password reset, and no admin UI for
  granting AccessRoles. Accounts currently come from the seed script only. This
  is the most obvious gap — see §8.
- **Department and Role (job title) admin screens.** Both are seeded; neither
  can be edited in the UI.
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
Velixa HR/
├── apps/
│   ├── api/                    NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma   THE database schema — single source of truth
│   │   │   ├── seed.ts         Development sample data (safe to re-run)
│   │   │   └── migrations/     Generated SQL. Committed. Never edit by hand.
│   │   └── src/
│   │       ├── main.ts         Entry point: cookies, CORS, validation, /api prefix
│   │       ├── app.module.ts   Root module — register new modules HERE
│   │       ├── config/         Env parsing + start-up validation
│   │       ├── prisma/         PrismaService (global)
│   │       ├── redis/          RedisService (global, unused so far)
│   │       ├── storage/        StorageService — swap for S3 later (global)
│   │       ├── auth/           Login, tokens, JwtAuthGuard
│   │       ├── permissions/    Scope resolution + PermissionsGuard (global)
│   │       ├── assignments/    EmploymentAssignmentService — job changes
│   │       ├── employees/      Employee CRUD + org chart
│   │       ├── documents/      Upload / download / archive
│   │       └── health/         GET /health
│   └── web/                    Next.js frontend
│       └── src/
│           ├── app/
│           │   ├── login/      Sign-in screen
│           │   └── (app)/      Authenticated pages (shared nav shell)
│           │       ├── employees/
│           │       └── org-chart/
│           ├── components/     AuthProvider, shared UI
│           └── lib/            api.ts (fetch + auto-refresh), types.ts
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

### ✅ Resolved in Phase 1

- **The employment-history invariant is now enforced** — DTO shape, transactional
  service, and partial unique index. See §8.
- **`User` is a separate table from `Employee`**, linked by an optional
  `employeeId`, exactly as planned.

### No user-account provisioning (the biggest current gap)

Creating an employee does **not** create a login. There is no invite flow, no
self-service password reset, and no UI for granting AccessRoles — accounts and
role grants exist only because the seed script writes them.

So a real new hire added through the UI today cannot sign in. This is the first
thing to build in Phase 2. It needs, roughly:

- an admin screen to create a `User` for an employee and grant AccessRoles
- an invite or set-password flow (emailed one-time token) so nobody has to
  handle a plaintext password
- password reset, and "revoke all sessions" (already implemented as
  `TokenService.revokeAllForUser`, just not exposed)

### No status history

`Employee.status` (PROBATION → ACTIVE → ON_LEAVE …) has no history table. This
was deliberate — status flips far more often than job assignments and would
drown the career history in noise. If "how long was this person on leave last
year?" becomes a real question, derive it from the Leave module rather than
adding status rows to `EmploymentAssignment`.

### No audit log

`EmploymentAssignment.recordedById` and `EmployeeAccessRole.grantedById` cover
the two most sensitive changes, but there is still no general log of who edited
what. Add a generic `AuditLog` table (`actorId`, `entityType`, `entityId`,
`action`, `before`, `after`, `at`) — now feasible, since there is finally an
authenticated actor to record.

### Open security items

- `Employee.dateOfBirth` and `nationalId` are regulated personal data stored in
  plain columns. Decide on pgcrypto or application-level encryption **before**
  real records are loaded.
- **No rate limiting on the login endpoint.** Per-account lockout exists (5
  attempts, 15 minutes) but an attacker can still spray many accounts from one
  IP. Add `@nestjs/throttler`.
- **No security headers.** Add `helmet`.
- **No structured request logging.** Nest's default logger is fine locally but
  will not do once this is deployed.
- **Uploaded files are not virus-scanned**, and the MIME type is taken from the
  client rather than sniffed from the bytes. Both matter once real staff can
  upload.
- **`sameSite: 'lax'` assumes API and web share a site.** Revisit before
  deploying them to different domains — see §8.
- The seed's sample data uses realistic-looking names and a known password.
  It refuses to run with `NODE_ENV=production`, but never point it at a real
  database regardless.

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

## 7. The product name

The project was built under a `[PROJECT_NAME]` placeholder and renamed to
**Velixa HR** on 2026-09-15. The placeholder is gone; this section records what
the name touches, so a future rename (or a second environment) does not have to
rediscover it.

### The name appears in three different forms

Because "Velixa HR" is not a legal identifier everywhere a name is needed:

| Form | Where | Constraint |
| --- | --- | --- |
| `Velixa HR` | Prose, UI text, page titles, code comments | Human-readable |
| `velixa-hr` | npm package name and scope, Docker project/container/volume names | Lowercase, no spaces |
| `velixa_hr` | Postgres database name (`velixa_hr_dev`) | Postgres identifier rules |

To find every occurrence:

```bash
git grep -n -e "Velixa HR" -e "velixa-hr" -e "velixa_hr"
```

### What each form controls

| Location | Value | Notes |
| --- | --- | --- |
| Root `package.json` | `"name": "velixa-hr"` | Must stay lowercase, no spaces |
| All three `package.json` | `@velixa-hr/api`, `@velixa-hr/web` | The npm **scope**. Root scripts reference it (`-w @velixa-hr/api`) — these must change together or `npm run dev` breaks. Re-run `npm install` afterwards so the workspace symlinks and lockfile are rebuilt. |
| `.env` / `.env.example` | `POSTGRES_DB=velixa_hr_dev` | Changing it requires recreating the database |
| `.env` / `.env.example` | `DATABASE_URL` | Repeats the database name — must match `POSTGRES_DB` or nothing connects |
| `docker-compose.yml` | `name:`, `container_name:`, volume `name:` | Renaming a volume **orphans the old one**: Docker silently creates a fresh empty volume and the old data becomes invisible while still consuming disk. Always `npm run db:nuke` *before* changing volume names. |

### If the name ever changes again

Do it in this order. Steps 1 and 5 are the ones people forget.

1. `npm run db:nuke` — removes containers **and** volumes while Compose still
   knows their current names. Skipping this leaves orphaned volumes.
2. Find-and-replace all three forms across tracked files **and `.env`**
   (`.env` is git-ignored, so `git grep` will not show it).
3. `npm install` — rebuilds workspace links and `package-lock.json`.
4. `npm run db:up && npm run prisma:migrate && npm run db:seed` — the new
   database starts empty, so migrations and seed must be re-run.
5. Restart the dev servers. They cache the old workspace names.

### Not yet present, but will need the name

JWT issuer/audience claims, Redis key prefix, email "from" name, S3 bucket
name. None exist yet. Once they hold live values they are much harder to
rename, so wire them to the current name deliberately when they land.

### Unaffected by the rename

The **repo folder** is still `D:\WORK\HRM` and the **GitHub remote** is still
`recruiter-ux/hrm-project`. Neither matters functionally. If you want them to
match the product name, rename the GitHub repo in its settings and then
`git remote set-url origin <new-url>`; the local folder can be renamed freely.

---

## 8. Authentication and permissions (Phase 1)

### How signing in works

1. `POST /api/auth/login` checks the password with bcrypt.
2. The API returns **two httpOnly cookies** — a short-lived access token
   (15 min) and a long-lived refresh token (7 days).
3. Every later request carries the access cookie automatically.
4. When it expires, the web app calls `POST /api/auth/refresh` once, gets a new
   pair, and retries. The user notices nothing.
5. `POST /api/auth/logout` revokes the refresh token server-side and clears
   both cookies.

### Decisions worth knowing

- **Tokens live in httpOnly cookies, not localStorage.** JavaScript cannot read
  an httpOnly cookie, so a cross-site-scripting bug in the frontend cannot
  steal a session. The cost is that the frontend can never inspect the token —
  which is why `GET /api/auth/me` exists and why session restore on page
  refresh is a network call rather than a localStorage read.
- **Two different secrets** for access and refresh tokens. If the access
  secret leaks, the attacker can mint short-lived tokens but cannot mint
  refresh tokens and hold a session indefinitely. Start-up validation refuses
  to boot if they are equal or shorter than 32 characters.
- **Refresh tokens are stored server-side, hashed (SHA-256).** A plain JWT
  cannot be revoked; a database row can. This is what makes logout real. SHA-256
  rather than bcrypt because the token is already server-generated randomness —
  there is nothing to brute-force, and the lookup happens on every refresh.
- **Refresh tokens rotate.** Each refresh revokes the old token, so a stolen one
  is usable at most once.
- **`sameSite: 'lax'` works in development** because `localhost:3000` and
  `localhost:4000` count as the same site (ports are ignored). ⚠️ **If the API
  and web app are ever deployed to different domains, this must become
  `sameSite: 'none'` with `secure: true`,** or every login will silently fail.
  See `TokenService.setAuthCookies`.
- **bcryptjs, not bcrypt or argon2.** The pure-JavaScript implementation avoids
  native compilation, which is a recurring source of install failures on
  Windows. Same algorithm, somewhat slower. Work factor 12.
- **Account lockout** after 5 failed attempts, for 15 minutes. Login failures
  all return the same message so nobody can enumerate which emails have
  accounts, and a missing account still runs a dummy hash so response timing
  does not give it away either.

### How permissions are enforced

Two guards, both registered globally in `AppModule`, so **every endpoint is
protected by default**:

| Guard | Question | Opt out with |
| --- | --- | --- |
| `JwtAuthGuard` | Who are you? | `@Public()` |
| `PermissionsGuard` | May you do this? | (only acts on `@RequirePermission(...)`) |

Forgetting a decorator therefore *locks an endpoint down* rather than exposing
it — the safe direction to fail.

**Permissions are loaded fresh from the database on each request, not baked
into the token.** That costs one indexed query and buys immediate revocation:
remove someone from the `hr_admin` AccessRole and they lose access on their
next request, not 15 minutes later.

**The guard decides *whether*; the service decides *which rows*.**
`PermissionsGuard` resolves the caller's scope and attaches it to the request;
`PermissionsService.buildEmployeeScopeFilter()` turns that scope into a Prisma
`where` fragment, which is ANDed with the user's own filters. There is no way
to widen visibility through a crafted query string.

Verified behaviour with the seed data:

| Account | AccessRole | Scope | Sees |
| --- | --- | --- | --- |
| sana.iqbal | hr_admin | GLOBAL | all 7 |
| bilal.khan | department_head | DEPARTMENT | 4 (Engineering + nested teams) |
| omar.farooq | manager | TEAM | 2 (self + direct reports) |
| zara.ahmed | employee | SELF | 1 (self) |

**TEAM is one level deep by design** — a manager sees their own reports, not
their reports' reports. Skip-level visibility is what DEPARTMENT is for. If
that is wrong for Hazel Mobile, `buildEmployeeScopeFilter` is the single place
to change it.

**Single-record endpoints return 404, not 403, when out of scope.** Otherwise a
manager could discover that an employee exists by probing ids.

### The employment-history invariant is now enforced in code

The gap flagged in Phase 0 is closed. Three layers now protect it:

1. **The DTO shape.** `roleId`, `departmentId`, `managerId`, `employmentType`
   and `workLocationType` are only reachable inside `UpdateEmployeeDto.assignment`,
   which cannot be submitted without `effectiveFrom` and `reason`. Because the
   global ValidationPipe runs with `forbidNonWhitelisted: true`, sending any of
   them at the top level is **rejected with a 400** rather than silently applied.
2. **The service.** `EmploymentAssignmentService.changeAssignment()` closes the
   open assignment, opens the new one, and refreshes the cached fields on
   `Employee` — all in one transaction. Nothing else writes those five fields.
3. **The database.** The partial unique index makes a second open assignment
   impossible even if the code were wrong.

`GET /api/employees/drift` (requires `access_role:manage`) lists any employee
whose cache has drifted from their open assignment. It should always be empty.

### Documents

- Files are written to local disk in development via `StorageService`. Only a
  `storageKey` is stored in the database — swap in an S3 implementation and
  nothing else changes.
- **Storage keys are generated from a UUID, never the uploaded filename.** A
  filename like `../../.env` would otherwise escape the storage directory.
- **Allowlist of MIME types**, not a blocklist.
- Downloads are always `Content-Disposition: attachment` with `nosniff`, so an
  uploaded HTML or SVG file cannot execute scripts on our origin.
- **Two checks per document:** the employee must be within your scope, AND
  confidential documents additionally require `document:read_confidential`.
  Confidential files are filtered out of listings entirely rather than shown
  locked — their existence alone can be sensitive.

### Org chart: why it reads the cached fields

The chart shows the org as it stands **today**, which is exactly what
`Employee.managerId` represents. Deriving it from `employment_assignments`
would mean filtering `effective_to IS NULL` and joining to reach the same
answer more slowly.

That is only safe because the cache is now trustworthy — see the three layers
above. A **historical** org chart ("show me the org last March") is a different
feature and *would* have to query assignments with a date filter. Worth
building when Reporting lands.

### A bug worth remembering

`enableImplicitConversion: true` on the global ValidationPipe coerces strings
to booleans with `Boolean(value)` — and **`Boolean('false')` is `true`**. This
silently marked every uploaded document confidential until it was caught.

The fix is in `UploadDocumentDto`: read the raw value off `obj` inside
`@Transform` rather than trusting the already-converted `value`. **Any future
boolean that arrives as a string (query param or form field) needs the same
treatment.**

---

## 9. Session start checklist

When starting a new session on this project:

1. Read this file and `README.md`.
2. `npm run db:up` — start Postgres and Redis.
3. `npm run dev` — start both apps.
4. Open <http://localhost:3000> and sign in as `sana.iqbal@hazelmobile.com`
   (password `Password123!`).
5. Confirm which module is being built, and check §6 for anything that must be
   settled first.

> ⚠️ **Never run `npm run build` while `npm run dev` is running.** Both write to
> `apps/web/.next`, and the production build clobbers the dev server's chunks —
> every page then 500s with `Cannot find module './NNN.js'`. Recovery: stop the
> dev server, delete `apps/web/.next`, restart. Cost me ten minutes; not a code
> bug.

---

## 10. Leave Management (Phase 2, Module 1)

### Three tables

| Table | Holds |
| --- | --- |
| `LeaveType` | Reference data — Annual, Sick, Unpaid. Admin-editable. |
| `LeaveBalance` | One person's entitlement, for one type, for one year. |
| `LeaveRequest` | A request and its decision. |

### Decisions worth knowing

- **Only `entitledDays` is stored. Taken, pending, and remaining are derived**
  by summing requests on every read. A stored "remaining" counter would be a
  second source of truth that drifts the moment a request is cancelled or
  back-dated. Cancelling a request frees its reserved days automatically,
  because there is nothing to un-deduct.
- **Pending requests reserve balance.** Otherwise someone could submit ten
  requests for the same ten days and have them all pass validation.
- **`LeaveRequest.days` is stored, not recomputed.** If the working-day rules
  change later (a holiday calendar, a four-day week), an already-approved
  request must keep the number it was approved with, or historical balances
  silently change.
- **`approverId` is a snapshot** taken at submission from the employee's open
  `EmploymentAssignment`. If someone changes manager mid-request it stays with
  the manager who was actually asked.
- **Resolved from the assignment, not `Employee.managerId`.** The two agree, but
  the assignment is the source of truth. Falls back to the department head when
  someone has no manager, so a CEO's direct report is not stranded. A null
  approver is still possible (the CEO's own request) — only HR can decide those.
- **`requiresBalance` is per type**, which is how Unpaid leave can be taken with
  zero entitlement without hardcoding "Annual only" into the validation.
- **`REJECTED` and `CANCELLED` are separate states.** One is a manager's
  decision, the other the employee withdrawing. Collapsing them would destroy
  that distinction in any report.

### The six validation rules, and where they live

All in `LeaveService`, checked in this order so the message a person sees is
the most useful one:

1. End date not before start date
2. Range contains at least one working day
3. No overlap with an existing PENDING or APPROVED request
4. Enough balance — skipped when `requiresBalance` is false
5. Cannot approve or reject your own request
6. Cannot decide a request that is already decided

Rule 5 needs the **explicit self-check**, not just permissions: a manager holds
`leave_request:approve` at TEAM scope, and TEAM includes themselves, so scope
alone would let them approve their own leave. Verified directly.

### Permission scopes

| AccessRole | read | approve | create |
| --- | --- | --- | --- |
| employee | SELF | *(none at all)* | SELF |
| manager | TEAM | TEAM | SELF |
| department_head | DEPARTMENT | DEPARTMENT | SELF |
| hr_admin | GLOBAL | GLOBAL | GLOBAL |

`create` is SELF even for managers, deliberately — it is what stops a manager
raising and approving a request in one motion. HR's GLOBAL approve is what
unblocks a request whose manager has left the company.

Verified: Zara sees 2 requests, Omar 3, Bilal 4, Sana 4; Omar gets a 404
fetching Hassan's request by id.

### ⚠️ What is NOT finished

**Verified through the API but never clicked in a browser:**

- Submitting a request through the form at `/leave/new`
- Approve / Reject buttons on `/leave/approvals`
- Withdraw button on `/leave`

The pages render correctly with real data and the endpoints behind them are
fully tested, so the risk is a wiring mistake in the click handlers, not in the
logic. **Click these three before building anything on top.**

**Not built at all:**

- **No admin UI for leave types or balances.** The endpoints exist
  (`POST /api/leave/types`, `POST /api/leave/balances`) but there is no screen,
  so entitlements can only be changed by the seed or a direct API call.
- **No notifications.** A manager is not told a request is waiting; an employee
  is not told of a decision. This is the most visible gap for real use.
- **No public holiday calendar.** Only weekends are excluded, so leave over Eid
  or Christmas currently consumes those days. `working-days.ts` is the only file
  that changes when this lands.
- **No accrual.** A flat yearly entitlement set by HR. Real accrual (earned per
  month, pro-rated for joiners and leavers, carry-over caps) belongs with
  Payroll.
- **No team leave calendar** — who is off when, which is what managers actually
  want before approving.
- **Requests spanning New Year** are attributed entirely to the start date's
  year rather than split across two balances.
