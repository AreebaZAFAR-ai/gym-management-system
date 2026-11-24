# API (NestJS)

One backend for every gym (spec §8–10). NestJS 11, Zod, Drizzle ORM,
PostgreSQL on Neon. Business rules come from `../shared`; do not reimplement
them here.

Status: **stage 1, skeleton and configuration.** Health check, config
validation, database connection and the `{ message }` error format are done.
Tables, auth and routes come next.

## Run locally

Requires **Node 20.19 or newer**.

```bash
# from the repository root
npm install
cp api/.env.example api/.env     # then fill in (see below)
npm --workspace api run db:check # read-only: checks both Neon connections
npm run api                      # build and start on PORT (default 3000)
curl http://localhost:3000/health
```

## Environment (`api/.env`)

`api/.env` is git-ignored. Never commit it or paste its values anywhere.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection (host contains `-pooler`). Used by the running API. |
| `DATABASE_URL_DIRECT` | Neon **direct** connection (no `-pooler`). Used only by migrations. |
| `JWT_SECRET` | Signs login tokens. 32+ random characters. |
| `CORS_ORIGINS` | Comma-separated web admin origins. Required in production. |
| `PORT`, `NODE_ENV` | Defaults `3000`, `development`. |

Both Neon strings come from Neon console → project → **Connect**. Toggle
"Connection pooling" on for `DATABASE_URL` and off for `DATABASE_URL_DIRECT`.

## Database and migrations

- Schema: `src/db/schema.ts`. Migrations: `drizzle/` (SQL, committed).
- `npm --workspace api run db:generate` writes a new SQL migration. **Read it
  before applying**; it must never contain `DROP` or data-destroying changes
  to existing tables.
- `npm --workspace api run db:migrate` applies pending migrations through the
  direct connection.
- Never use `drizzle-kit push`.

## Tests

```bash
npm --workspace api run test
```

Tests run against in-memory PGlite and never touch Neon.

**Convention:** Vitest compiles with esbuild, which does not emit decorator
metadata, so every constructor dependency is named explicitly:
`constructor(@Inject(MembersService) private readonly members: MembersService)`.

## Layout

```
src/main.ts            bootstrap (loads .env, validates, listens)
src/app.setup.ts       /v1 prefix, error filter, CORS (shared with tests)
src/config/            environment validation (Zod)
src/db/                Drizzle schema and connection (pooled)
src/health/            GET /health
src/common/            { message } error filter
drizzle.config.ts      migrations (direct connection)
scripts/db-check.mjs   read-only Neon connection check
test/                  Vitest + PGlite
```

## Build

`npm --workspace api run build` compiles to `dist/` (shared rules are
compiled in); `npm --workspace api run start` runs `dist/api/src/main.js`.
