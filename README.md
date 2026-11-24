# Gym Management System and White-Label Member App

A gym management system for Pakistani gyms. Fees are recorded (cash,
JazzCash, Easypaisa, bank), check-in uses a signed rotating QR, and each gym
gets its own branded member app.

| Part | Folder | Stack | Status |
| --- | --- | --- | --- |
| Mobile app (members, reception, trainers) | `app/` | Expo (React Native), TypeScript, Expo Router | Built; talks to the API when `API_URL` is set (demo data otherwise) |
| Shared types and business rules | `shared/` | TypeScript, Vitest | Built and tested |
| API | `api/` | NestJS, Zod, JWT, bcrypt, PostgreSQL (Neon) + Drizzle | All §10 routes built and tested; Neon migrated |
| Web admin | `admin/` | Next.js (App Router) | Not started |

## Quick start

```bash
npm install
npm test        # business-rule unit tests (shared/)
npm run app     # start the Expo app (Node 22.13+ required)
```

See [`app/README.md`](app/README.md) for demo accounts, environment variables
and how to add a gym.

## Shared rules (`shared/`)

The API and app share one source for: phone parsing, Pakistan dates,
membership status and door entry, payment periods, freezes, member codes,
check-in QR signing/verification, plate maths, Epley 1RM, warm-ups and
"% of best". The API must import these rather than reimplement them, and its
responses must match `shared/src/types.ts`.
