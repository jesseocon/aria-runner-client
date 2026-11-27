#!/bin/bash
# Regenerate src/api.ts from the runner's OpenAPI document. Run after an aria-runner change to its API:
#   ARIA_RUNNER_DIR=../aria-runner npm run gen
set -euo pipefail
cd "$(dirname "$0")/.."
RUNNER=${ARIA_RUNNER_DIR:-../aria-runner}
(cd "$RUNNER" && uv run --quiet python -c '
import json, sys
from aria_runner.api import create_app
json.dump(create_app().openapi(), sys.stdout, indent=1, sort_keys=True)
') > openapi/aria-runner.json
npx openapi-typescript openapi/aria-runner.json -o src/api.ts
echo "src/api.ts from aria-runner $(cd "$RUNNER" && git rev-parse --short HEAD)"
