# Web admin (Next.js)

Desktop-first admin for the owner, reception and trainers (spec §6). Next.js 16
App Router, React 19, TypeScript. Every page is a client component that calls the
API with a bearer token; there is no server-side data access (§8).

## Run locally

Requires **Node 20.9 or newer** and a running API (see `../api/README.md`).

```bash
# from the repository root
npm install
cp admin/.env.example admin/.env.local   # set NEXT_PUBLIC_API_URL
npm run admin                            # http://localhost:3001
```

Add the admin's origin (e.g. `http://localhost:3001`) to the API's `CORS_ORIGINS`.

## Environment (`admin/.env.local`)

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | API base URL without `/v1`, e.g. `https://api.example.com`. Built into the browser bundle, so rebuild after changing it. |

## Build and deploy

```bash
npm --workspace admin run typecheck
npm --workspace admin run build   # needs internet once: downloads the two Google fonts
npm --workspace admin run start   # serves the build on port 3001
```

On Vercel: set the project root to `admin/`, keep the default install command at
the repository root (npm workspaces), and set `NEXT_PUBLIC_API_URL`.

## Pages and roles

| Page | Path | Roles |
| --- | --- | --- |
| Login | `/login` | All staff (members are refused: "Members use the mobile app") |
| Overview | `/` | Reception, owner |
| Members, Add member, Member page | `/members`, `/members/new`, `/members/:code` | Reception, owner (due-date edit: owner) |
| Check-ins | `/checkins` | Reception, owner |
| Training plans | `/training` | Trainer, owner |
| Fees and payments | `/fees` | Reception, owner |
| Reports | `/reports` | Owner |
| WhatsApp, Announcements | `/whatsapp`, `/announcements` | Reception, owner |
| Staff and roles, Fee plans | `/staff`, `/fee-plans` | Owner |
| Settings | `/settings` | Owner |

The sidebar shows only the pages the signed-in role may open (`src/lib/nav.ts`);
opening another page shows "You do not have access". The API enforces the same
roles. Ctrl+K (Cmd+K) opens member search and actions for reception and owner.

## Notes

- Add member: the first payment is optional (§6). Without it, no payment or receipt is
  created and the member shows no due date ("—") until reception records a payment. This
  needs API migration `0003` applied to the database (see `../api/README.md`).

## Code layout

- `src/lib/api.ts` — the API client (framework-free). `api/test/admin-contract.e2e.test.ts`
  runs it against a live API on in-memory PGlite.
- `src/lib/strings.ts` — all UI text in one place, so Urdu can be added later (§11).
- `src/lib/session.tsx` — token (browser local storage), signed-in user, gym brand
  colour, Online/Offline state, approvals count.
- Business rules (status, due dates, reminders) live in the API and `../shared`;
  the admin only displays what the API returns.

## Adding a gym

Nothing to change here: the owner signs in with the gym code (the gym ID created by
`npm --workspace api run gym:create`, or shown after registering at `/register`), and
the gym name and colour come from the API.

## Public pages

- `/`: product landing page with **Log in** and **Register your gym**.
- `/register`: gym owner self-registration; shows the new Gym Code, then goes to `/login`
  with the code filled in.
- `/login`: staff sign-in. The signed-in Overview page is now at `/overview`.
- Product name and all landing text: `t.product` and `t.landing` in `src/lib/strings.ts`.
