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
| Members | `GET members?q&status` · `POST members` · `GET/PATCH members/:code` · `POST members/:code/reset-password` | Reception, owner (due-date edit: owner) |
| Dashboard | `GET dashboard` | Reception, owner |
| Messages | `GET whatsapp?status` · `PATCH whatsapp/:id` · `POST whatsapp/reminders` · `POST/DELETE announcements` | Reception, owner |
| Setup | `GET plans` · `GET staff` | Reception, owner |
| Setup | `POST/PATCH plans` · `POST/PATCH staff` · `GET/PATCH settings` · `GET reports` | Owner |
| Trainer | `GET trainer/today` · `trainer/clients` · `trainer/clients/:id/bests` · `trainer/plans` · `PATCH trainer/sessions/:id` · `POST trainer/plans` · `DELETE trainer/plans/:id` | Trainer, owner |
| Trainer | `POST trainer/sessions` (path provisional: not listed in §10) | Trainer, owner |

### Pending: the PDF does not say how these work

Not implemented until the requirement is clarified:

- Recording a payment correction through the API: how a correction is entered and whether it
  changes the due date or queues a receipt. (The database already links a correction to its
  original payment and keeps payments append-only.)
- What disabling an account does. `active` is stored and editable (§6 Disable/Enable) but has
  no other effect: login and existing tokens are not blocked.
- The message for an unknown thumbprint ID (the scan is saved with no reason and the
  response message is empty).
- How trainer sessions are created (`POST trainer/sessions` exists but is not in §10 and no
  screen creates sessions).
- A member registered without the optional first payment (§6) has **no due date** until a
  payment is recorded. The PDF gives no due-date rule for that case, so the §7 rules are
  applied literally: with no due date the "overdue" and "due soon" tests and the door's
  "due date + grace days" test do not apply, so the status is **Active** and entry is
  **allowed** unless frozen; the first payment later starts on the payment date; a freeze
  has no due date to move; no fee reminder is sent; the member is not in Overview's overdue
  or due-soon lists or in "might quit". Confirm or define the intended rule.

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

### Self-registration (web admin "Register your gym")

`POST /v1/gyms/register` (public) creates a gym and its owner in one transaction
through the same `createGym` as the script. The Gym Code (gym ID) is a slug of the
gym name (`Iron House Fitness` → `iron-house-fitness`, then `-2`, `-3`… if taken);
member prefix and short letters are the name's initials; colour defaults to `#17191C`.
Gym email and owner email are contact-only (never a login, §2) and unique across all
gyms, ignoring case. Passwords: 8–72 characters with a letter and a number. Any
role or gym ID in the body is ignored: the account is always the new gym's owner.
At most 5 registrations per client address per hour (per API process). Migration
`0004_gym_self_registration.sql` adds the contact columns. A self-registered gym
still needs steps 2–4 of §12 (brand file, icon, app build) for its member app.

## Environment (`api/.env`)

`api/.env` is git-ignored. Never commit it or paste its values anywhere.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection (host contains `-pooler`). Used by the running API. |
| `DATABASE_URL_DIRECT` | Neon **direct** connection (no `-pooler`). Used by migrations and the scripts. |
| `JWT_SECRET` | Signs login tokens and screenshot links. 32+ random characters. |
| `CORS_ORIGINS` | Comma-separated web admin origins. Required in production. |
| `UPLOAD_DIR` | Optional. Where payment screenshots are saved in development (default `./uploads`, git-ignored). |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | §8 S3-compatible storage (AWS S3, Cloudflare R2). **Required in production**; when set, screenshots go to the bucket instead of `UPLOAD_DIR`. Keep the bucket private. |
| `S3_REGION`, `S3_ENDPOINT` | Region (default `auto`, for R2) and, for non-AWS providers, the endpoint URL. |
| `PORT`, `NODE_ENV` | Defaults `3000`, `development`. |

Screenshots are never public: the API serves them only through 15-minute signed links (§11).

**HTTPS only in production (§11).** With `NODE_ENV=production` the API refuses plain-HTTP
requests (403 "HTTPS is required.") and sends HSTS. Deploy it behind the host's TLS proxy
(Railway, Render, nginx), which must set `X-Forwarded-Proto`. `/health` stays reachable for
the host's health checks.

## Database and migrations

- Schema: `src/db/schema.ts`. Migrations: `drizzle/` (SQL, committed).
  `0001_integrity_rules.sql` holds the rules Drizzle cannot express (append-only
  payments; exercise names are unique per gym; gym isolation for workouts);
  `0002_builtin_exercises.sql` installs the 17 built-in exercises.
- `0003_optional_registration_payment.sql` (§6 "Optional first payment"): removes the 0001
  trigger `members_require_payment` and its function `check_member_has_payment()`, and lets
  `members.due_on` be empty. It changes no data. **Not yet applied to Neon**: review it, then
  run `db:migrate` and `db:verify` (which now expects 4 migrations, 5 triggers, 4 functions).
  It contains `DROP TRIGGER`/`DROP FUNCTION` (rules only, no data), an exception to the rule
  below that needs the owner's review before it is applied.
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
runs the mobile app's own API client (`app/src/api/http.ts`) against a live server (§11);
`test/admin-contract.e2e.test.ts` does the same for the web admin's client (`admin/src/lib/api.ts`).

Owner-approved rules: a reset password goes back to the default (last 6 digits of the mobile
number); fee reminder and welcome wording are in `src/whatsapp/whatsapp.ts`. Frozen members
get no fee reminder.

CI: `.github/workflows/ci.yml` runs the typechecks, all tests (PGlite) and both builds on
every push (§13). It needs no secrets.

**Convention:** Vitest compiles with esbuild, which does not emit decorator
metadata, so every constructor dependency is named explicitly:
`constructor(@Inject(MembersService) private readonly members: MembersService)`.

**Transactions:** inside `db.transaction(async (tx) => …)` read and write only
through `tx`. A query on `this.db` inside a transaction deadlocks on PGlite and
reads outside the transaction on Postgres.

## Build

`npm --workspace api run build` compiles to `dist/` (shared rules are
compiled in); `npm --workspace api run start` runs `dist/api/src/main.js`.
