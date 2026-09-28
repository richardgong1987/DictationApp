#!/usr/bin/env bash
# Builds the macOS installer (.dmg) for DictationApp. Run ./package.sh --help for options.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./package.sh [--native]

  (no option)  Universal DMG for Apple Silicon and Intel Macs, like the release workflow.
  --native     DMG for this Mac's architecture only; builds about twice as fast.
EOF
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' not found. $2" >&2
    exit 1
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: a .dmg can only be built on macOS." >&2
  exit 1
fi

cd "$(dirname "$0")"

build_args=(--bundles dmg)
case "${1:-}" in
  "")
    is_universal=true
    build_args+=(--target universal-apple-darwin)
    bundle_dir="src-tauri/target/universal-apple-darwin/release/bundle/dmg"
    ;;
  --native)
    is_universal=false
    bundle_dir="src-tauri/target/release/bundle/dmg"
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

require npm "Install Node.js 20+ from https://nodejs.org"
require cargo "Install Rust from https://rustup.rs"

if [[ "$is_universal" == true ]]; then
  require rustup "Install Rust from https://rustup.rs"
  # A universal app is stitched together from one build per architecture.
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
fi

if [[ ! -d node_modules ]]; then
  npm ci
fi

# DMGs from earlier versions stay in the bundle folder; clear them so the one listed below is new.
rm -f "$bundle_dir"/*.dmg

npm run tauri -- build "${build_args[@]}"

echo
echo "DMG ready:"
ls -1 "$PWD/$bundle_dir"/*.dmg
