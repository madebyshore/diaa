/**
 * plopfile.mjs — Scaffolding generators for Tamahagane FE.
 *
 * Generators:
 *   new-page       — Create a new route with HTML template, page class, and sanity-content entry
 *   new-transition — Create a custom transition between two existing pages
 *
 * Usage:
 *   pnpm run new-page
 *   pnpm run new-transition
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Scan src/routes/ for existing route folders (excludes "partials").
 * Returns an array of folder names representing available page keys.
 */
function getAvailablePages() {
  const routesDir = path.join(__dirname, "src", "routes");
  return fs
    .readdirSync(routesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "partials")
    .map((d) => d.name);
}

/**
 * Convert a kebab-case string to PascalCase.
 * e.g. "case-study" → "CaseStudy", "home" → "Home"
 *
 * @param {string} str - The kebab-case string.
 * @returns {string} The PascalCase string.
 */
function toPascalCase(str) {
  return str
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

/**
 * Build the sanity-content.ts code block for a new page entry.
 * Includes the comment header, pages.push(), and media[] assignment.
 *
 * @param {object} data - The template data from plop prompts.
 * @returns {string} The code to insert into sanity-content.ts.
 */
function buildSanityBlock(data) {
  const varName = data.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "Path";

  return `
  // ---------------------------------------------------------------------------
  // ${data.title} page
  // ---------------------------------------------------------------------------

  const ${varName} = "${data.route}";
  pages.push({
    path: ${varName},
    key: "${data.name}",
    title: "${data.title}",
    template: "${data.isTemplate ? data.name : data.name}",
    data: {},
  });

  media["${data.route}"] = {
    textures: {
      main: [
        [{ url: "/assets/images/placeholder.jpg", id: "${data.name}-0" }],
      ],
    },
  };

`;
}

/**
 * Build the import statement for a new transition class.
 *
 * @param {string} className - The transition class name (e.g. "HomeAboutTransition").
 * @param {string} fileName - The file name without extension (e.g. "home-to-about").
 * @returns {string} The import statement.
 */
function buildTransitionImport(className, fileName) {
  return `import { ${className} } from "./transitions/${fileName}";`;
}

/**
 * Build the registry.register() call for a new transition.
 *
 * @param {string} fromKey - The from page key.
 * @param {string} toKey - The to page key.
 * @param {string} className - The transition class name.
 * @returns {string} The register call.
 */
function buildTransitionRegister(fromKey, toKey, className) {
  return `    this.registry.register("${fromKey}", "${toKey}", new ${className}());`;
}

export default function (plop) {
  // -------------------------------------------------------------------------
  // new-page generator
  // -------------------------------------------------------------------------
  plop.setGenerator("new-page", {
    description: "Create a new route page (HTML + TS module + sanity-content entry)",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Page name (kebab-case, e.g. 'contact' or 'case-study'):",
        validate: (v) => {
          if (!v) return "Page name is required";
          if (!/^[a-z][a-z0-9-]*$/.test(v)) return "Use kebab-case (lowercase, hyphens)";
          const existing = getAvailablePages();
          if (existing.includes(v)) return `Route "${v}" already exists`;
          return true;
        },
      },
      {
        type: "input",
        name: "route",
        message: "Route path (e.g. '/contact'):",
        default: (answers) => `/${answers.name}`,
        validate: (v) => {
          if (!v.startsWith("/")) return "Route must start with /";
          return true;
        },
      },
      {
        type: "input",
        name: "title",
        message: "Page title (displayed in browser tab):",
        default: (answers) => toPascalCase(answers.name),
      },
      {
        type: "confirm",
        name: "isTemplate",
        message: "Is this a CMS template route? (star-prefix HTML filename)",
        default: false,
      },
    ],
    actions: (data) => {
      // Compute derived template data
      data.pascalName = toPascalCase(data.name);
      data.htmlFilename = data.isTemplate ? `*${data.name}` : data.name;

      const actions = [
        // 1. Create HTML template
        {
          type: "add",
          path: `src/routes/{{name}}/{{htmlFilename}}.html`,
          templateFile: "plop-templates/page/page.html.hbs",
        },
        // 2. Create TS page module
        {
          type: "add",
          path: "src/routes/{{name}}/{{name}}.ts",
          templateFile: "plop-templates/page/page.ts.hbs",
        },
        // 3. Append page entry to sanity-content.ts
        {
          type: "modify",
          path: "scripts/sanity-content.ts",
          pattern: /(\n\s*return \{ pages, media \};)/,
          template: `${buildSanityBlock(data)}$1`,
        },
      ];

      return actions;
    },
  });

  // -------------------------------------------------------------------------
  // new-transition generator
  // -------------------------------------------------------------------------
  plop.setGenerator("new-transition", {
    description: "Create a custom transition between two existing pages",
    prompts: [
      {
        type: "list",
        name: "fromKey",
        message: "Transition FROM which page?",
        choices: () => getAvailablePages(),
      },
      {
        type: "list",
        name: "toKey",
        message: "Transition TO which page?",
        choices: () => getAvailablePages(),
      },
      {
        type: "input",
        name: "className",
        message: "Transition class name:",
        default: (answers) =>
          `${toPascalCase(answers.fromKey)}${toPascalCase(answers.toKey)}Transition`,
        validate: (v) => {
          if (!v) return "Class name is required";
          if (!/^[A-Z][A-Za-z0-9]*$/.test(v)) return "Use PascalCase";
          return true;
        },
      },
    ],
    actions: (data) => {
      data.fromName = toPascalCase(data.fromKey);
      data.toName = toPascalCase(data.toKey);
      const fileName = `${data.fromKey}-to-${data.toKey}`;

      const actions = [
        // 1. Create transition file
        {
          type: "add",
          path: `src/app/controller/transitions/${fileName}.ts`,
          templateFile: "plop-templates/transition/transition.ts.hbs",
        },
        // 2. Add import to controller/index.ts
        {
          type: "modify",
          path: "src/app/controller/index.ts",
          pattern: /(import { DefaultTransition } from ".\/transition-fx";)/,
          template: `$1\n${buildTransitionImport(data.className, fileName)}`,
        },
        // 3. Add registry.register() call in the Ctrl constructor
        {
          type: "modify",
          path: "src/app/controller/index.ts",
          pattern: /(this\.registry = new TransitionRegistry\(new DefaultTransition\(\)\);)/,
          template: `$1\n${buildTransitionRegister(data.fromKey, data.toKey, data.className)}`,
        },
      ];

      return actions;
    },
  });
}
