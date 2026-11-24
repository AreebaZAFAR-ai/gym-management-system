# API (NestJS)

One backend for every gym (spec §8–10). NestJS 11, Zod, Drizzle ORM,
PostgreSQL on Neon. Business rules come from `../shared`; do not reimplement
them here.

Status: **§10 routes implemented and tested, except the pending items below; database migrated on Neon.**

## Routes

All under `/v1` except `/health`. Errors are always `{ "message": "..." }`.
The owner may call every staff route; members get 403 on staff routes.

| Area | Routes | Roles |
| --- | --- | --- |
| Health | `GET /health` | Public |
| Auth | `POST auth/login` (10 tries per phone per 15 min) | Public |
| Auth | `GET auth/me` · `POST auth/change-password` | Any |
| Brand | `GET gyms/:id` | Public |
| Member | `GET me/membership` · `me/progress` · `me/checkin-key` · `me/history/:exerciseId` · `me/plan/today` | Member |
| Member | `POST me/sessions` · `me/payment-proofs` (multipart `file`, images ≤ 6 MB) · `me/freeze` | Member |
| Shared | `GET announcements` · `GET exercises` | Any |
| Door | `POST checkins/scan {code}` · `GET checkins?date=` | Reception, owner |
| Door | `POST devices/:gymId/fingerprint {fingerprintId}`, header `x-device-key` | Door device |
| Fees | `POST payments` · `GET payments?from&to&member` | Reception, owner |
| Approvals | `GET payment-proofs` · `POST payment-proofs/:id/approve\|reject` · `GET freeze-requests` · `POST freeze-requests/:id/approve\|reject` | Reception, owner |
| Files | `GET files/proofs/:id?exp&sig` (15-minute signed link) | Signed link |
| Members | `GET members?q&status` · `POST members` · `GET/PATCH members/:code` | Reception, owner (due-date edit: owner) |
| Dashboard | `GET dashboard` | Reception, owner |
| Messages | `GET whatsapp?status` · `PATCH whatsapp/:id` · `POST/DELETE announcements` | Reception, owner |
| Setup | `GET plans` | Reception, owner |
| Setup | `POST/PATCH plans` · `GET/POST/PATCH staff` · `GET/PATCH settings` · `GET reports` | Owner |
| Trainer | `GET trainer/today` · `trainer/clients` · `trainer/clients/:id/bests` · `trainer/plans` · `PATCH trainer/sessions/:id` · `POST trainer/plans` · `DELETE trainer/plans/:id` | Trainer, owner |
| Trainer | `POST trainer/sessions` (path provisional: not listed in §10) | Trainer, owner |

### Pending: the PDF does not say how these work

Not implemented until the requirement is clarified:

- `POST members/:code/reset-password`: what the new password is.
- `POST whatsapp/reminders` and the welcome WhatsApp at registration: the message wording.
- Recording a payment correction through the API: how a correction is entered and whether it
  changes the due date or queues a receipt. (The database already links a correction to its
  original payment and keeps payments append-only.)
- What disabling an account does. `active` is stored and editable (§6 Disable/Enable) but has
  no other effect.
- The message for an unknown thumbprint ID (the scan is saved with no reason and the
  response message is empty).

## Run locally

Requires **Node 20.19 or newer**.

```bash
# from the repository root
npm install
cp api/.env.example api/.env       # then fill in (see below)
npm --workspace api run db:check   # read-only: checks both Neon connections
npm run api                        # build and start on PORT (default 3000)
curl http://localhost:3000/health
```

## Adding a gym (§12 step 1, super admin)

```bash
OWNER_PASSWORD=<password> npm --workspace api run gym:create -- --id ironhouse --name "Iron House Fitness" \
  --short IH --city Lahore --color "#17191C" --prefix IH --owner-name "<name>" --owner-phone <mobile>
OWNER_PASSWORD=<password> npm --workspace api run gym:demo   # §13 demo gym "demo" with three fee plans
```

Creates the gym with a random check-in secret (§12) and its first owner with the
given password. Neither is printed. The gym ID must match the app's brand file
(`app/brands/<gym>.json`).

## Environment (`api/.env`)

`api/.env` is git-ignored. Never commit it or paste its values anywhere.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection (host contains `-pooler`). Used by the running API. |
| `DATABASE_URL_DIRECT` | Neon **direct** connection (no `-pooler`). Used by migrations and the scripts. |
| `JWT_SECRET` | Signs login tokens and screenshot links. 32+ random characters. |
| `CORS_ORIGINS` | Comma-separated web admin origins. Required in production. |
| `UPLOAD_DIR` | Optional. Where payment screenshots are saved (default `./uploads`, git-ignored). |
| `PORT`, `NODE_ENV` | Defaults `3000`, `development`. |

Screenshots are stored on local disk (§8 development storage). Production
S3-compatible storage is **not wired up yet**.

## Database and migrations

- Schema: `src/db/schema.ts`. Migrations: `drizzle/` (SQL, committed).
  `0001_integrity_rules.sql` holds the rules Drizzle cannot express (append-only
  payments; from your clarifications: registration needs a payment and exercise
  names are unique per gym; gym isolation for workouts); `0002_builtin_exercises.sql` installs the 17 built-in exercises.
- `npm --workspace api run db:generate` writes a new SQL migration. **Read it
  before applying**; it must never contain `DROP` or data-destroying changes.
- `npm --workspace api run db:migrate` applies pending migrations (direct connection).
- `npm --workspace api run db:verify` checks tables, indexes, triggers and every
  integrity rule inside a transaction that is rolled back (leaves no data).
- Never use `drizzle-kit push`.

## Tests

```bash
npm --workspace api run test
```

Tests run against in-memory PGlite and never touch Neon. `test/contract.e2e.test.ts`
runs the mobile app's own API client (`app/src/api/http.ts`) against a live server (§11).

**Convention:** Vitest compiles with esbuild, which does not emit decorator
metadata, so every constructor dependency is named explicitly:
`constructor(@Inject(MembersService) private readonly members: MembersService)`.

**Transactions:** inside `db.transaction(async (tx) => …)` read and write only
through `tx`. A query on `this.db` inside a transaction deadlocks on PGlite and
reads outside the transaction on Postgres.

## Build

`npm --workspace api run build` compiles to `dist/` (shared rules are
compiled in); `npm --workspace api run start` runs `dist/api/src/main.js`.
