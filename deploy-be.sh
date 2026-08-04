#!/usr/bin/env bash
# Deploys the Sanity Studio (diaa-be) and the SSR preview (diaa-preview)
# to Vercel — see DEPLOY.md "Backend" and "Preview".
set -euo pipefail

vercel link --yes --project diaa-be --scope shore
vercel deploy --prod --yes --scope shore

vercel link --yes --project diaa-preview --scope shore
vercel deploy --prod --yes --scope shore
