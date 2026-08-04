#!/usr/bin/env bash
# Deploys the Sanity Studio (diaa-be) to Vercel — see DEPLOY.md "Backend".
set -euo pipefail

vercel link --yes --project diaa-be --scope shore
vercel deploy --prod --yes --scope shore
