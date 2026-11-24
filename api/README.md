# API (NestJS)

One backend for every gym (spec §8–10). NestJS 11, Zod, Drizzle ORM,
PostgreSQL on Neon. Business rules come from `../shared`; do not reimplement
them here.

Status: **all §10 routes implemented and tested; database migrated on Neon.**

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
| Fees | `POST payments` (renewal, or a Corrected Payment with `correctsPaymentId`) · `GET payments?from&to&member` | Reception, owner |
| Approvals | `GET payment-proofs` · `POST payment-proofs/:id/approve\|reject` · `GET freeze-requests` · `POST freeze-requests/:id/approve\|reject` | Reception, owner |
| Files | `GET files/proofs/:id?exp&sig` (15-minute signed link) | Signed link |
| Members | `GET members?q&status` · `POST members` · `GET/PATCH members/:code` · `POST members/:code/reset-password` | Reception, owner (due-date edit: owner) |
| Dashboard | `GET dashboard` | Reception, owner |
| Messages | `GET whatsapp?status` · `PATCH whatsapp/:id` · `POST whatsapp/reminders` · `POST/DELETE announcements` | Reception, owner |
| Setup | `GET plans` | Reception, owner |
| Setup | `POST/PATCH plans` · `GET/POST/PATCH staff` · `GET/PATCH settings` · `GET reports` | Owner |
| Trainer | `GET trainer/today` · `trainer/clients` · `trainer/clients/:id/bests` · `trainer/plans` · `PATCH trainer/sessions/:id` · `POST trainer/plans` · `DELETE trainer/plans/:id` | Trainer, owner |
| Trainer | `POST trainer/sessions` (path provisional: not listed in §10) | Trainer, owner |

### Defaults chosen where the PDF is silent (change on request)

- **Corrected payments:** a new row linked to the original (`correctsPaymentId`);
  same member only; an original may be corrected more than once (the latest
  correction counts in totals); a correction cannot itself be corrected; it keeps
  the original's period, does **not** move the due date and queues no receipt.
- **Disabled accounts:** cannot log in; existing tokens stop working; disabled
  members are blocked at the door (QR, typed ID, thumbprint) and the scan is saved.
- **Reset password:** 6 random digits (not the predictable last-6-digits default).
- **Unknown fingerprint / disabled member / welcome and reminder WhatsApp texts:**
  wording is ours; the PDF gives none.
- **Owners** cannot disable themselves (§6) or change their own role.
- **"Active members"** (dashboard, announcement WhatsApp copies): enabled accounts
  that are not overdue.

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
npm --workspace api run gym:create -- --id ironhouse --name "Iron House Fitness" --short IH \
  --city Lahore --prefix IH --owner-name "Kamran Iqbal" --owner-phone 03451234567
npm --workspace api run gym:demo   # §13 demo gym "demo" with three fee plans
```

Creates the gym with a random check-in secret and its first owner, and prints
the owner's password once (set `OWNER_PASSWORD` to choose it). The gym ID must
match the app's brand file (`app/brands/<gym>.json`).

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
  payments, registration needs a payment, exercise name rules, gym isolation
  for workouts); `0002_builtin_exercises.sql` installs the 17 built-in exercises.
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
