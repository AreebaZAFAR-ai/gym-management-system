# Member app (Expo)

One codebase for members, reception and trainers. The screens shown depend on
the role at login. Each gym gets its own build: its own name, colour, icon and
store listing.

Stack: Expo SDK 58 (React Native), TypeScript, Expo Router, expo-camera,
expo-image-picker, expo-secure-store, expo-keep-awake, and AsyncStorage for the
offline queue.

## Run locally

Requires **Node 22.13 or newer**. Expo SDK 58 does not support Node 20.

```bash
# from the repository root
npm install
npm run app            # = npm --workspace app run start
```

Open the app in a development build on a phone (`npx expo run:android`) or in
the browser with `w` (camera scanning is phone-only).

With no `API_URL` the app uses **built-in demo data** (`src/api/mock.ts`). The
demo applies the same rules as the server and resets on reload. The login
screen lists the demo accounts. Each password is the last 6 digits of the
phone number.

| Account | Phone | Shows |
| --- | --- | --- |
| Ali Raza (member) | 0300 1234567 | Returning member, trainer plan for today |
| Sara Khan (member) | 0300 7654321 | New member welcome |
| Usman Tariq (member) | 0311 1234567 | Overdue, blocked at the door (IH-0399) |
| Hina Malik (member) | 0312 1234567 | Due soon |
| Ayesha Noor (reception) | 0333 1234567 | Scan and collect |
| Bilal Ahmed (trainer) | 0344 1234567 | My day and plan builder |

## Environment

| Variable | Used at | Meaning |
| --- | --- | --- |
| `GYM` | build | Brand file to use: `brands/<GYM>.json` (default `ironhouse`) |
| `API_URL` | build | API base URL, e.g. `https://api.example.pk`. Unset or `mock` uses demo data |

## Adding a gym (white-label, spec §12)

1. Create the gym row and first owner on the server (API seed/script).
2. Add `brands/<gym>.json`: `id`, `name`, `short`, `city`, `primaryColor`,
   `bundleId` (e.g. `pk.ironhouse.members`), `payTo`, `receptionWhatsapp`.
3. Add `brands/<gym>/icon.png` (1024×1024) and `brands/<gym>/splash.png`.
4. Build: `GYM=<gym> API_URL=https://api... npx eas-cli@latest build --profile production`.
5. Submit under the gym's store listing: `npx eas-cli@latest submit`.

The build reads the name, colour and gym ID from the brand file. Pay-to
details and grace days come from the server, so the owner can change them
without a new build.

## Layout

```
src/app/                 routes (Expo Router)
  login.tsx              phone + password, remember me
  (member)/(tabs)/       Progress, Workout (floating tab bar)
  (member)/profile.tsx   fee, pay-to, screenshot, freeze, password, log out
  (member)/checkin.tsx   rotating signed QR, works offline
  (member)/history/      exercise history and chart
  reception.tsx          camera scan, typed ID, record payment
  trainer/               today's sessions, plan builder
src/api/                 GymApi interface, HTTP client, demo mock
src/lib/                 session, secure storage, offline queue, loaders
src/components/          UI kit, barbell, machine stack, rest timer, charts
src/strings.ts           all user-facing text (ready for Urdu)
src/theme.ts             design tokens from spec §12
```

Business rules and API types live in `../shared` and are unit-tested there.

## Checks

```bash
npx tsc --noEmit
npx expo lint
npm test --workspace shared
```
