/**
 * mustache.d.ts — ambient module declaration for `mustache`.
 *
 * The `mustache` package ships no type declarations at all (verified: its
 * `package.json` has no `types`/`typings` field and no `.d.ts` files) — a
 * pre-existing gap that's invisible to `apps/fe` today only because nothing
 * there runs a bare `tsc --noEmit` across `scripts/` (its build is esbuild/
 * Vite-transpiled, not type-checked, and ESLint's type-aware rules don't hit
 * this path). `apps/preview`'s `tsc --noEmit` transitively type-checks
 * `apps/fe/scripts/routes-plugin.ts` and `apps/fe/scripts/slices/render.ts`
 * (both `import Mustache from "mustache"`), so it needs this declaration.
 * Scoped to this project only — no `apps/fe` file is touched for it.
 */
declare module "mustache";
