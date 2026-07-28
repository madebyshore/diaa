# diaa-preview

Vercel project serving **draft** Sanity content so the Studio's Presentation
tool can iframe the live site, click-to-edit any field, and see saves
reflected in ~1–3s. It is a thin host for `apps/fe`'s shared preview core
(`apps/fe/scripts/preview/*`) — the production `apps/fe` deployment is
completely separate and untouched by anything here.

Full architecture, local dev recipe, and troubleshooting:
**`apps/fe/docs/visual-editing.md`**.

## What lives here

- `api/[[...path]].ts` — catch-all Node.js Function adapting Vercel's
  Request/Response to `handlePreviewRequest()` (`apps/fe/scripts/preview/handler.ts`).
- `scripts/copy-assets.mjs` — build step: copies the real `apps/fe` production
  build's static assets into `public/`, and the small on-disk subset the
  preview render needs (route templates, shell template, build manifest)
  into `.preview-runtime/`.
- `vercel.json` — build command, static/function routing, headers.

Both `public/` and `.preview-runtime/` are entirely build-generated
(gitignored) — never edit them by hand.

## Required environment variables

| Variable | Purpose |
|---|---|
| `SANITY_READ_TOKEN` | **Required.** A Sanity **Viewer** token (Sanity Manage → API → Tokens) — least-privilege read access to drafts. |
| `SANITY_STUDIO_URL` | The Studio's deployed URL (e.g. `https://<studio-host>.sanity.studio`) — used for stega deep-links back to the Studio. |
| `SANITY_PROJECT_ID` / `SANITY_DATASET` | Optional — override `apps/fe/project.config.ts`'s defaults (`0in4i1po` / `production`). |
| `PREVIEW_SESSION_SECRET` | Optional — HMAC key for the session cookie. Falls back to a hash of `SANITY_READ_TOKEN` if unset, so it's not strictly required. |
| `PREVIEW_FE_ROOT` | Optional override — normally **not needed anywhere**: the render core auto-detects the copied `.preview-runtime/` tree on a deployed function and falls back to `apps/fe` locally (see `apps/fe/scripts/preview/render.ts` `resolveFeRoot()`). Set only to force a nonstandard path. |

## Vercel dashboard settings

- **Project**: new project named `diaa-preview`.
- **Root Directory**: `apps/preview`.
- **Framework Preset**: Other (this is a plain Node.js Function, not a
  framework build).
- **Deployment Protection**: **OFF**. The Studio iframes this deployment
  directly — Vercel's own auth wall would block that. Access is instead
  gated by the `@sanity/preview-url-secret`-validated session cookie
  (`/__preview/enable`) — every other route 401s without it.
- **Environment Variables**: set the four above (Production + Preview
  environments as needed).

## Local build/typecheck

```bash
pnpm --filter diaa-preview exec tsc --noEmit   # typecheck api/[[...path]].ts
pnpm --filter diaa-preview build                # real fe build + copy-assets.mjs
```
