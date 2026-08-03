# GitHub Actions workflows

| File     | Trigger                                | What it does           |
| -------- | -------------------------------------- | ---------------------- |
| `ci.yml` | Push / PR to `main`, or run by hand     | Lint, format, and build |

## Things worth knowing

- **CI never touches a real database.** `prisma generate` and `prisma validate`
  read the schema file only. When migration testing is added later, it will
  need a Postgres service container.
- **`npm ci` needs `package-lock.json` committed.** Run `npm install` locally
  once and commit the lockfile it produces, or every CI run reinstalls from
  scratch and can pick up different dependency versions than your machine.
- **Deployment is deliberately absent.** No hosting decision has been made yet.
