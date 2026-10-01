#!/usr/bin/env bash
# Builds DictationApp on a Mac: the macOS installer (.dmg) or the iOS app.
# Run ./package.sh --help for options.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./package.sh [--native | --ios | --ios-simulator]

  (no option)      Universal DMG for Apple Silicon and Intel Macs, like the release workflow.
  --native         DMG for this Mac's architecture only; builds about twice as fast.
  --ios            Signed IPA for iPhone and iPad. Needs your Apple team ID in
                   APPLE_DEVELOPMENT_TEAM (Xcode > Settings > Accounts). APPLE_EXPORT_METHOD
                   picks debugging (default), release-testing or app-store-connect.
  --ios-simulator  App for the iOS Simulator; needs no Apple account.

iOS builds also need Xcode, CocoaPods and XcodeGen: brew install cocoapods xcodegen
EOF
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' not found. $2" >&2
    exit 1
  fi
}

install_frontend_dependencies() {
  if [[ ! -d node_modules ]]; then
    npm ci
  fi
}

# $1: "universal" or "native"
build_dmg() {
  local build_args=(--bundles dmg)
  local bundle_dir="src-tauri/target/release/bundle/dmg"
  if [[ "$1" == universal ]]; then
    build_args+=(--target universal-apple-darwin)
    bundle_dir="src-tauri/target/universal-apple-darwin/release/bundle/dmg"
    require rustup "Install Rust from https://rustup.rs"
    # A universal app is stitched together from one build per architecture.
    rustup target add aarch64-apple-darwin x86_64-apple-darwin
  fi
  install_frontend_dependencies

  # DMGs from earlier versions stay in the bundle folder; clear them so the one listed below is new.
  rm -f "$bundle_dir"/*.dmg
  npm run tauri -- build "${build_args[@]}"

  echo
  echo "DMG ready:"
  ls -1 "$PWD/$bundle_dir"/*.dmg
}

# $1: "device" or "simulator"
build_ios() {
  # Checked here because the Tauri CLI would otherwise install missing tools itself.
  require xcodebuild "Install Xcode from the App Store."
  require pod "Install CocoaPods: brew install cocoapods"
  require xcodegen "Install XcodeGen: brew install xcodegen"
  require rustup "Install Rust from https://rustup.rs"

  local tauri_target rust_target
  if [[ "$1" == device ]]; then
    if [[ -z "${APPLE_DEVELOPMENT_TEAM:-}" ]]; then
      echo "error: set APPLE_DEVELOPMENT_TEAM to your Apple team ID, shown in Xcode > Settings > Accounts." >&2
      exit 1
    fi
    tauri_target=aarch64
    rust_target=aarch64-apple-ios
  elif [[ "$(uname -m)" == arm64 ]]; then
    tauri_target=aarch64-sim
    rust_target=aarch64-apple-ios-sim
  else
    tauri_target=x86_64
    rust_target=x86_64-apple-ios
  fi
  rustup target add "$rust_target"
  install_frontend_dependencies

  # The Xcode project in src-tauri/gen/apple is generated once, then kept with the code.
  if [[ ! -d src-tauri/gen/apple ]]; then
    npm run tauri -- ios init --ci
  fi

  local output_dir="src-tauri/gen/apple/build"
  rm -rf "$output_dir"
  if [[ "$1" == device ]]; then
    npm run tauri -- ios build --ci --target "$tauri_target" \
      --export-method "${APPLE_EXPORT_METHOD:-debugging}"
    echo
    echo "IPA ready:"
    find "$PWD/$output_dir" -name "*.ipa"
  else
    npm run tauri -- ios build --ci --target "$tauri_target" --no-sign
    echo
    echo "Simulator app ready (open the Simulator, then: xcrun simctl install booted <app>):"
    find "$PWD/$output_dir" -name "*.app" -maxdepth 4
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: DictationApp is packaged on macOS only." >&2
  exit 1
fi

cd "$(dirname "$0")"
require npm "Install Node.js 20+ from https://nodejs.org"
require cargo "Install Rust from https://rustup.rs"

case "${1:-}" in
  "") build_dmg universal ;;
  --native) build_dmg native ;;
  --ios) build_ios device ;;
  --ios-simulator) build_ios simulator ;;
  -h | --help) usage ;;
  *)
    usage >&2
    exit 1
    ;;
esac
