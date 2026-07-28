# sanity-deploy

Trigger Vercel Deploy Hooks from your Sanity Studio.

A "Deploy" tool that lives in the Studio navbar — add one or more Vercel
projects, store them as Sanity documents, and kick off deploys without
leaving the editor.

## Install

```sh
pnpm add sanity-deploy
```

Targets Sanity Studio v5 and React 19.

## Configure

```ts
// sanity.config.{ts,js}
import { defineConfig } from 'sanity'
import { vercelDeployTool } from 'sanity-deploy'

export default defineConfig({
  // ...
  plugins: [
    vercelDeployTool({
      projects: [
        {
          name: 'Production',
          projectId: '<project_id>',
          teamId: '<team_id>',
          url: '<deploy_hook_url>',
        },
      ],
    }),
  ],
})
```

The `projects` array is optional — editors can add projects from the UI.

## License

MIT — see [LICENSE](./LICENSE).
