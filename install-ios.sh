#!/usr/bin/env bash
# Builds DictationApp for iOS, installs it on the iPhone connected to this Mac and opens it.
#
# Usage: ./install-ios.sh [device]
#   device  name or UDID from `xcrun devicectl list devices`; needed only when several
#           iPhones or iPads are connected.
set -euo pipefail

# Prints the UDID of every iPhone and iPad this Mac can reach right now.
connected_devices() {
  xcrun devicectl list devices --hide-default-columns --hide-headers \
    --columns properties.hardware.udid \
    --filter "properties.hardware.reality = 'physical' AND properties.hardware.platform = 'iOS'
      AND properties.connection.state != 'unavailable'" \
    | grep -E '^[0-9A-Fa-f-]+$' || true
}

only_connected_device() {
  local devices
  devices=$(connected_devices)
  if [[ -z "$devices" ]]; then
    echo "error: no iPhone found. Connect it with a cable, unlock it and tap Trust if it asks." >&2
    exit 1
  fi
  if [[ "$devices" == *$'\n'* ]]; then
    echo "error: several devices are connected; name one: ./install-ios.sh <name or UDID>" >&2
    xcrun devicectl list devices >&2
    exit 1
  fi
  echo "$devices"
}

cd "$(dirname "$0")"
# Picked before the build so a missing iPhone fails in seconds, not after a full build.
device="${1:-$(only_connected_device)}"

./package.sh --ios
ipa=$(find src-tauri/gen/apple/build -name "*.ipa" | head -n 1)
bundle_id=$(plutil -extract identifier raw -o - src-tauri/tauri.conf.json)

echo
echo "Installing on $device..."
xcrun devicectl device install app --device "$device" "$ipa"

if ! xcrun devicectl device process launch --terminate-existing --device "$device" "$bundle_id"; then
  cat >&2 <<'EOF'

Installed, but iOS would not open the app. Unlock the iPhone, then open DictationApp from the
Home Screen. If iOS calls it an untrusted developer, trust your certificate once in
Settings > General > VPN & Device Management.
EOF
  exit 1
fi
echo
echo "DictationApp is installed and open on your iPhone."
