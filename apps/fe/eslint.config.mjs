// @ts-check
import prettier from "eslint-config-prettier";

import withNuxt from "./.nuxt/eslint.config.mjs";

// `withNuxt()` already wires up typescript-eslint, the Vue parser, and
// eslint-plugin-import-x. Phase 0 keeps this minimal — the reference build's
// unused-imports plugin + import/order rules get layered on once there's
// enough real code (multiple modules/composables) for those rules to matter;
// adding them now against a two-file scaffold would just be noise.
export default withNuxt(
  {
    ignores: ["dist/**", "node_modules/**", "public/**"],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  // Keep ESLint from conflicting with Prettier formatting (applied last).
  prettier,
);
