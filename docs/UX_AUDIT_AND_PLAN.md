# UX audit and Phase 2 plan

Date: 2026-11-20. Base: branch `vercel-deploy` (PR #2), commit `87b8d73`.

## 1. Audit

### What was checked

| Check | How | Result |
|---|---|---|
| Lint, typecheck, unit + integration tests | `pnpm lint`, `pnpm typecheck`, `pnpm test` | Clean; 90/90 tests pass |
| End-to-end flow | `pnpm test:e2e` (Playwright) | 10/10 pass |
| Dependency advisories | `pnpm audit --prod` | No known vulnerabilities (after Next.js 16.4.6 in PR #2) |
| Bad values on screen | Script signs in as each of the 5 demo users, at 1366 px and 390 px. It visits 15 app pages plus linked heat, recommendation and verification detail pages (182 page views). It searches the rendered text for `NaN`, `undefined`, `Infinity`, `null`, `[object Object]` | **0 found** |
| Runtime errors | Same crawl, collecting `pageerror` and console errors | **0 found** |
| Structure / a11y basics | Same crawl: exactly one `<h1>` per page; every button/link has an accessible name | All pass |
| Horizontal overflow | Same crawl: `scrollWidth > innerWidth` | **1 issue**: `/tariffs` at 1366 px for owner and analyst (the tariff-window rows overflow the side panel by 31 px). Fixed in M3 with a container query |

### Strengths to keep

- Domain logic is pure and deterministic (`src/domain/*`). It runs in the browser too. The optimiser solves the deck day in about 30 ms, which makes a live in-browser simulator possible.
- Permissions are enforced on the server for every action. The UI hides controls as a convenience only.
- Evidence labels (SIMULATED / MEASURED / ASSUMPTION), the data-mode badge and the simulation banner are already consistent.
- Charts are hand-built SVG with hover read-outs, tariff bands, hatched holding (pattern plus colour) and honest data gaps.

### Gaps (what Phase 2 addresses)

1. **No public front door.** `/` redirects straight to `/login`. There is nothing that explains the product before sign-in, no "How it works", and no way to create an account.
2. **Design tokens cover colour only.** Radius, shadow, motion and type scale are written inline as arbitrary values (`text-[13px]`, `rounded-md`, ad-hoc shadows). They need named tokens so new public pages and app pages look like one product.
3. **Navigation is mouse-first.** There are 15 sections and a factory switcher, but no keyboard way to jump between them or to a heat.
4. **Charts show, but you cannot ask them questions.** The timeline gives a per-minute read-out, but you cannot ask "what did 14:00–16:30 cost?" without leaving the page.
5. Tariff form overflow (above).

Out of scope, stated plainly:

- A dark theme. The charts, hatch patterns and tariff bands were tuned for the light canvas, and a rushed dark mode would hurt legibility.
- Marketing claims beyond the deck. Every number shown publicly comes from the simulator and is labelled as simulated.

## 2. Architecture

```
src/app
  page.tsx             NEW  landing "/" with the live shift simulator (signed-in users see "Open dashboard")
  how-it-works/        NEW  the six-step loop, with the guardrail at each step
  login/               restyled on the shared AuthLayout
  register/            NEW  account + own synthetic sandbox factory
  (app)/layout.tsx     adds the command palette and the post-sign-up welcome toast
src/components
  public/              NEW  logo, PublicShell, AuthLayout, ShiftSimulator
  shell/command-palette.tsx  NEW  Ctrl/⌘ K, plus a visible "Jump to" button in the top bar
  shell/welcome-toast.tsx    NEW
  charts/energy-timeline.tsx  + window inspector (drag to select, Esc / double-click / Clear to reset)
src/domain/deck.ts     NEW  pure deck-day optimiser input (shared by tests and the simulator)
src/domain/window.ts   NEW  pure window statistics for the inspector
src/server/services/registration.ts  NEW  creates org, factory, furnace, meter, owner, then seeds the scenario
```

The public pages live directly under `src/app` (no route group was needed; each uses `PublicShell` or `AuthLayout`).

### Registration design

- **Creates:** a user, a new organisation and a **simulation** factory that only this user can see (OWNER). The factory is seeded with the deterministic "holding-anomaly" scenario. A visitor gets a private sandbox and never touches the shared demo factory.
- **Safety:**
  - Uses the existing scrypt hashing and session code.
  - Passwords need 10 or more characters, and emails must be unique. Neither the error message nor the response time reveals whether an email already exists.
  - Rate limits: 3 sign-ups per IP per 10 minutes.
  - `ALLOW_REGISTRATION="false"` turns sign-up off. The page then says so, and the server action refuses.
- Real (non-simulation) factories are never created by self-service.

## 3. Three UX innovations

1. **Live shift simulator on the landing page.** The real optimiser runs in the browser against the deck's foundry day. Visitors drag "moulding line delay", "dispatch cut-off" and "peak tariff premium" and watch three things update instantly: current practice against the optimised schedule (kWh/t, ₹/t, holding minutes), a mini Gantt over the tariff bands, and which constraint blocks when the plan turns infeasible. Every figure is labelled "Simulated · deck assumptions". It is the product's core idea, made tactile in about ten seconds.
2. **Command palette (Ctrl/⌘ K).** One keystroke opens a fuzzy-search list. It covers every section the user's role can open, the current day's heats ("H07 · 45 min holding · flagged"), switching factory, choosing the day, and sign-out. It is fully keyboard-driven and announced to screen readers. Permissions are still checked on the server.
3. **Energy window inspector.** Drag across any energy timeline to select a time window. A chip then gives the window's real figures from the meter data: kWh, cost at the tariff in force, the share of energy in peak / solar / normal bands, average kW, minutes of holding and heats touched. Esc or double-click clears it. This turns the chart from a picture into an instrument.

## 4. Milestones and verification

| Milestone | Delivers | Verified by |
|---|---|---|
| M1 | Radius/shadow/motion/type tokens in `globals.css`; `PublicShell`; shared `Logo` | lint, typecheck, build |
| M2 | `/`, `/how-it-works`, restyled `/login`, `/register` + service + tests | unit/integration test for registration (isolation, duplicate email, disabled flag); e2e sign-up |
| M3 | Tariff overflow fix; window inspector (pure stats function, unit-tested) | unit tests; crawl re-run reports 0 issues |
| M4 | Command palette, landing simulator, skeleton/empty/toast polish | e2e: palette navigation, simulator recompute; full crawl; production build; Vercel deploy check |

## 5. Result (verified 2026-11-20)

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | Clean |
| `pnpm test` | 103/103 pass (adds deck, window and registration tests) |
| `pnpm build` (clean `.next`) | Succeeds |
| `pnpm test:e2e` | 15/15 pass: the original 10 plus simulator recompute and infeasible state, How it works, sign-up into a private sandbox with the welcome toast and palette navigation, duplicate sign-up, and the window inspector |
| Crawl (5 roles × 2 widths, 182 app page views) | 0 bad values, 0 errors, 0 overflow (the `/tariffs` overflow is fixed) |
| Public pages at 390 px and 1366 px | One `<h1>` each, no overflow, no bad values, no console errors |

Notes:

- The peak-multiplier slider in the simulator often does not move the numbers: on the deck day both schedules finish before the evening peak. It starts to matter once moulding delays push heats past 18:00. That is the honest answer, so it stays.
- Registration on the public Vercel demo writes to the per-instance `/tmp` copy, so sandbox accounts there are temporary.
