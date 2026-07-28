// Flat config for ESLint v9 with TypeScript
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import-x";
import unusedImports from "eslint-plugin-unused-imports";

export default [
  {
    ignores: [
      "dist/**",
      "docs/**",
      "node_modules/**",
      "public/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "_/**",
      "scripts/**",
    ],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  // TypeScript recommended defaults
  ...tseslint.configs.recommended,
  // Project rules for TS files only
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    plugins: {
      "import-x": importPlugin,
      "unused-imports": unusedImports,
    },
    rules: {
      // Enforce deterministic import order (grouped + alphabetized)
      "import-x/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
            "type",
          ],
          pathGroups: [
            { pattern: "@/**", group: "internal", position: "before" },
            { pattern: "@app/**", group: "internal", position: "before" },
            { pattern: "@engine/**", group: "internal", position: "before" },
            { pattern: "@kido/**", group: "internal", position: "before" },
          ],
          pathGroupsExcludedImportTypes: ["builtin"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
          warnOnUnassignedImports: true,
        },
      ],
      // Keep a single blank line after imports
      "import-x/newline-after-import": ["warn", { count: 1 }],
      // Avoid resolver noise with TS path aliases
      "import-x/no-unresolved": "off",
      // Remove unused imports automatically on --fix
      "unused-imports/no-unused-imports": "error",
      // Prefer plugin's unused-vars so it cooperates with import removal
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-wrapper-object-types": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "prefer-const": "off",
    },
  },
  // Keep ESLint from conflicting with Prettier formatting
  prettier,
];
