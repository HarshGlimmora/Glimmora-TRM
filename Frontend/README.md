# Glimmora TRM — Frontend

A premium, trust-first frontend for the **Glimmora Tax Resource Management** platform.
Built as a Next.js 14 (App Router) + TypeScript + TailwindCSS application, ready to be wired up to a real backend.

> Sovereign Tax Resource Management
> Verified identity · Audited access · Deterministic rules.

---

## What's in scope

This frontend covers the full **pre-product** experience — everything up to and including the role-aware dashboard. No filing, no payments, no admin operations beyond reaching the dashboard.

| # | Surface | Route |
|---|---|---|
| 1 | Login (email or mobile) | `/login` |
| 2 | OTP verification | `/verify` |
| 3 | Role selection | `/role-select` |
| 4 | Taxpayer onboarding (5 steps) | `/onboarding/taxpayer` |
| 5 | Consultant onboarding (5 steps) | `/onboarding/consultant` |
| 6 | Role-aware dashboard | `/dashboard` |
| 7 | CA ↔ Taxpayer linking | `/connections` |

The taxpayer and consultant dashboards render distinct content, alerts, stat tiles, activity timelines, and primary CTAs.

---

## Tech stack

- **Next.js 14** App Router with React Server Components
- **TypeScript** in strict mode (`noUncheckedIndexedAccess: true`)
- **TailwindCSS 3** with a tokenised design system in `app/globals.css`
- **Zustand** for client state (auth + onboarding drafts) — partialised so sensitive fields never persist
- **Typography**: IBM Plex Sans / IBM Plex Mono + Instrument Serif display
- A **mock API layer** (`lib/api/index.ts`) with `Promise<T>` returns — swap a single module to integrate a real backend
- **No data libraries** beyond what is strictly needed — designed for clarity and easy auditing

---

## Run it

```bash
cd Frontend
npm install
npm run dev          # http://localhost:3000

# Other helpful scripts
npm run build        # production bundle
npm run typecheck    # tsc --noEmit
npm run lint
```

**Demo OTP** is `1-2-3-4-5-6`. After five wrong attempts the verification flow locks for 60 seconds. After successful verification, a brand-new identifier routes you to **role selection** → onboarding; the seeded identifiers route you straight to the dashboard.

Seeded demo identifiers:

| Role | Email | Mobile |
|---|---|---|
| Taxpayer | `taxpayer@demo.glimmora.in` | `9876543210` |
| Consultant | `ca@demo.glimmora.in` | `9988776655` |

---

## Design language

Trust-first, government-grade, calm:

- **Surface** — off-white `bg-vellum` with soft radial tints
- **Brand** — deep navy (`#15243F`-ish) used sparingly for primary actions
- **Accent** — restrained deep teal (`#0E5C70`-ish) for focus and verification
- **Seal** — muted gold reserved for trust marks
- **Signals** — desaturated success / warning / error
- **Display type** — Instrument Serif at large sizes; IBM Plex Sans for body
- **Tabular numerals** for PAN/Aadhaar/identifiers via the `.tabular` utility

A small consistent SVG icon set lives at `components/shared/Icon.tsx` — stroke-based, 1.5px line weight. No emoji icons.

---

## Security model (frontend)

The frontend takes the following defensive stance:

| Concern | Approach |
|---|---|
| Raw PAN / Aadhaar / OTP | Held in **component state only** — never in `localStorage`, never in `sessionStorage` |
| Display of identity values | Masked (`maskPan`, `maskAadhaar`, `maskMobile`, `maskEmail`) with explicit reveal toggle |
| PAN validation | Format + entity-code class checks |
| Aadhaar validation | 12 digits + **Verhoeff checksum** (UIDAI spec) |
| Mobile validation | 10 digits + DoT prefix (6–9) |
| OTP brute-force | Max 5 incorrect attempts → 60 s lockout; resend cooldown 30 s |
| Input sanitization | `sanitizeText` / `sanitizeDigits` / `sanitizeEmail` / `sanitizeMobile` / `sanitizePan` / `sanitizeAadhaar` strip control chars, zero-width, HTML tags |
| XSS | React's default escaping; no `dangerouslySetInnerHTML` anywhere |
| Session expiry | 45-minute TTL; `AuthGuard` redirects on expiry, sweeping all `glmra.*` keys from sessionStorage |
| Route guarding | `AuthGuard` wraps `(app)` layout; onboarding pages check session presence |
| `localStorage` policy | Wrapper `sessionDraft` refuses to persist sensitive keys with `console.warn` audit signal |
| Headers | CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, `Cache-Control: no-store` on authenticated routes |

A grep for `localStorage.setItem` should return zero hits in source.

---

## Folder layout

```
Frontend/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── verify/page.tsx
│   │   ├── role-select/page.tsx
│   │   └── onboarding/
│   │       ├── page.tsx            ← role router redirect
│   │       ├── taxpayer/page.tsx   ← 5-step flow
│   │       └── consultant/page.tsx ← 5-step flow
│   ├── (app)/
│   │   ├── layout.tsx              ← AuthGuard + TopBar
│   │   ├── dashboard/page.tsx      ← role-aware
│   │   └── connections/page.tsx    ← CA ↔ Taxpayer linking
│   ├── layout.tsx                  ← fonts, metadata
│   ├── page.tsx                    ← /login redirect
│   └── globals.css                 ← tokens + base styles
├── components/
│   ├── ui/                         ← primitives (Button, Input, Card, …)
│   ├── auth/                       ← AuthShell, OtpInput
│   ├── onboarding/                 ← OnboardingShell, StepIndicator, IdentityField, …
│   ├── dashboard/                  ← TopBar, PrimaryCta, StatCard, IdentityCard, …
│   └── shared/                     ← Logo, Icon, RoleBadge, AuthGuard, TrustMarks
├── lib/
│   ├── api/                        ← mock-db + typed service layer
│   ├── security/                   ← sanitize, mask, storage
│   ├── store/                      ← auth-store, onboarding-store (Zustand)
│   ├── validation/                 ← identity validators (PAN / Aadhaar / mobile / ICAI / PIN / OTP)
│   ├── utils/                      ← cn, format
│   └── types.ts
├── middleware.ts                   ← Cache-Control + X-Robots-Tag
├── next.config.mjs                 ← global security headers
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Wiring a real backend

The entire mock layer is `lib/api/index.ts`. Each function — `beginLogin`, `verifyOtp`, `createTaxpayerProfile`, `createConsultantProfile`, `requestLink`, `updateLinkStatus`, `fetchDashboard` — returns a `Promise<T>` with the same typed contract that a real service should expose. To integrate:

1. Implement equivalents that call your API (e.g. `fetch`/`hono-client`/`tRPC`).
2. Replace the function bodies in `lib/api/index.ts`. No component needs to change.
3. If you persist tokens, do so via an HTTP-only cookie — never via the auth-store's `partialize`. The store should remain non-sensitive.

---

## Accessibility highlights

- WCAG-AA contrast on body text and primary actions
- Visible focus rings (`:focus-visible`) on every interactive element
- Skip-link to `<main id="main">`
- Modals trap escape, lock body scroll, and respect `prefers-reduced-motion`
- All form fields have explicit `<label>` elements; errors use `role="alert"` and `aria-live`
- OTP input uses `inputMode="numeric"`, `autocomplete="one-time-code"`, and `aria-label` per digit
- Step indicators use `aria-current="step"`

---

## What's intentionally **not** built

Per scope:

- Filing flow, payments, returns, notices, admin
- Officer / judicial / enforcement surfaces (only Taxpayer and Consultant)
- Real backend, persistence beyond mock state
- Email/SMS delivery (mock OTP only)
- E-filing portal integration

---

## License

Internal preview / demo build. © Glimmora.
