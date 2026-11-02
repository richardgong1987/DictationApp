#!/usr/bin/env bash
# Builds and installs DictationApp on macOS, or builds the iOS app.
# Run ./package.sh --help for options.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./package.sh [--native | --ios | --ios-simulator]

  (no option)      Build a universal macOS DMG, install the app, then build a signed iOS IPA.
  --native         Build a DMG for this Mac's architecture and install the app in /Applications.
  --ios            Signed IPA for iPhone and iPad, signed for the team of your Apple Development
                   certificate. If you have certificates from several teams, set
                   APPLE_DEVELOPMENT_TEAM to one (Xcode > Settings > Accounts). APPLE_EXPORT_METHOD
                   picks debugging (default), release-testing or app-store-connect.
  --ios-simulator  App for the iOS Simulator; needs no Apple account.

iOS builds also need Xcode with its iOS platform (xcodebuild -downloadPlatform iOS),
CocoaPods and XcodeGen (brew install cocoapods xcodegen).
EOF
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' not found. $2" >&2
    exit 1
  fi
}

# Prints a team ID only if the Apple Development certificates identify a single team.
signing_team() {
  local teams
  teams=$(security find-certificate -a -c "Apple Development:" -p 2>/dev/null \
    | openssl crl2pkcs7 -nocrl -certfile /dev/stdin 2>/dev/null \
    | openssl pkcs7 -print_certs -noout 2>/dev/null \
    | sed -n 's/^subject=.*OU *= *\([A-Z0-9]*\).*/\1/p' \
    | sort -u) || true
  if [[ "$teams" != *$'\n'* ]]; then
    echo "$teams"
  fi
}

install_frontend_dependencies() {
  if [[ ! -d node_modules ]]; then
    pnpm install --frozen-lockfile
  fi
}

# $1: "universal" or "native"
build_dmg() {
  local build_args=(--bundles app,dmg)
  local bundle_dir="src-tauri/target/release/bundle/dmg"
  if [[ "$1" == universal ]]; then
    build_args+=(--target universal-apple-darwin)
    bundle_dir="src-tauri/target/universal-apple-darwin/release/bundle/dmg"
    require rustup "Install Rust from https://rustup.rs"
    rustup target add aarch64-apple-darwin x86_64-apple-darwin
  fi
  install_frontend_dependencies

  rm -f "$bundle_dir"/*.dmg
  pnpm tauri build "${build_args[@]}"

  echo
  echo "DMG ready:"
  ls -1 "$PWD/$bundle_dir"/*.dmg

  local built_app="$PWD/${bundle_dir%/dmg}/macos/DictationApp.app"
  if [[ ! -d "$built_app" ]]; then
    printf 'error: app bundle not found: %s\n' "$built_app" >&2
    return 1
  fi

  rm -fr /Applications/DictationApp.app

  /usr/bin/osascript \
    -e 'on run argv' \
    -e '  set appBundle to (POSIX file (item 1 of argv)) as alias' \
    -e '  set installDir to (POSIX file "/Applications") as alias' \
    -e '  tell application "Finder" to duplicate appBundle to installDir with replacing' \
    -e 'end run' \
    "$built_app"
  echo "Installed: /Applications/DictationApp.app"
}

# $1: "device" or "simulator"
build_ios() {
  require xcodebuild "Install Xcode from the App Store."
  require pod "Install CocoaPods: brew install cocoapods"
  require xcodegen "Install XcodeGen: brew install xcodegen"
  require rustup "Install Rust from https://rustup.rs"
  if ! xcrun simctl list runtimes 2>/dev/null | grep -q "^iOS "; then
    echo "error: the iOS platform is not installed. Install it with: xcodebuild -downloadPlatform iOS" >&2
    exit 1
  fi

  local tauri_target rust_target
  if [[ "$1" == device ]]; then
    export APPLE_DEVELOPMENT_TEAM="${APPLE_DEVELOPMENT_TEAM:-$(signing_team)}"
    if [[ -z "$APPLE_DEVELOPMENT_TEAM" ]]; then
      echo "error: cannot tell which Apple team to sign for. Set APPLE_DEVELOPMENT_TEAM to your team ID," \
        "shown in Xcode > Settings > Accounts." >&2
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
  rustup component add llvm-tools
  install_frontend_dependencies

  if [[ ! -d src-tauri/gen/apple ]]; then
    pnpm tauri ios init --ci
  fi

  local output_dir="src-tauri/gen/apple/build"
  rm -rf "$output_dir"
  if [[ "$1" == device ]]; then
    pnpm tauri ios build --ci --target "$tauri_target" \
      --export-method "${APPLE_EXPORT_METHOD:-debugging}"
    echo
    echo "IPA ready:"
    find "$PWD/$output_dir" -name "*.ipa"

    rm -f "$HOME/Library/Mobile Documents/com~apple~CloudDocs/DictationApp.ipa"

    cp "$PWD/$output_dir"/arm64/DictationApp.ipa "$HOME/Library/Mobile Documents/com~apple~CloudDocs"
  else
    pnpm tauri ios build --ci --target "$tauri_target" --no-sign
    echo
    echo "Simulator app ready (open the Simulator, then: xcrun simctl install booted <app>):"
    find "$PWD/$output_dir" -maxdepth 4 -name "*.app"
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: DictationApp is packaged on macOS only." >&2
  exit 1
fi

cd "$(dirname "$0")"
require node "Install Node.js 20+ from https://nodejs.org"
require pnpm "Install pnpm: corepack enable pnpm"
require cargo "Install Rust from https://rustup.rs"

case "${1:-}" in
  "")
    build_dmg universal
    build_ios device
    ;;
  --native) build_dmg native ;;
  --ios) build_ios device ;;
  --ios-simulator) build_ios simulator ;;
  -h | --help) usage ;;
  *)
    usage >&2
    exit 1
    ;;
esac
