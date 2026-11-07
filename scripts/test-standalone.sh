#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
extension_root="$project_root/standalone/quick-translate@shamsiddin"

for source_file in "$extension_root"/*.js; do
    node --check "$source_file"
done
glib-compile-schemas --strict "$extension_root/schemas"
node "$extension_root/tests/extension-lifecycle.cjs"
node "$extension_root/tests/translation-orchestrator.cjs"
node "$extension_root/tests/gemini-utils.cjs"
node "$extension_root/tests/popup-lifecycle.cjs"
node "$extension_root/tests/examples.cjs"
node "$extension_root/tests/learning-ui.cjs"
gjs -m "$extension_root/tests/learning-services.js"

if [[ "${LIVE_PROVIDER_TESTS:-0}" == "1" ]]; then
    gjs -m "$extension_root/tests/claude-live.js"
    gjs -m "$extension_root/tests/gemini-live.js"
fi

echo "Standalone Quick Translate test suite passed."
