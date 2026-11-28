#!/bin/sh
set -eu

# Helper commands are restricted to an authorized USB-connected physical phone.

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
frontend_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
min_api=29
module_task=:ipv6ftp-voice-engine

require_adb() {
  command -v adb >/dev/null 2>&1 || { echo 'adb not found on PATH; install Android SDK platform-tools' >&2; exit 2; }
}

resolve_serial() {
  require_adb
  if [ -n "${ANDROID_SERIAL:-}" ]; then
    printf '%s' "$ANDROID_SERIAL"
    return 0
  fi
  devices=$(adb devices -l | awk 'NR>1 && $2=="device" && $1 !~ /^emulator-/ && $1 !~ /:/ {print $1}')
  count=$(printf '%s\n' "$devices" | grep -c . || true)
  if [ "$count" -eq 0 ]; then
    echo 'No authorized Android device found. Enable USB debugging, accept the RSA prompt, then retry.' >&2
    exit 3
  fi
  if [ "$count" -gt 1 ]; then
    echo "Multiple devices attached; set ANDROID_SERIAL to one of:" >&2
    printf '%s\n' "$devices" >&2
    exit 4
  fi
  printf '%s' "$devices"
}

validate_usb_serial() {
  serial=$1
  state=$(adb devices -l | awk -v s="$serial" '$1==s {print $2, $0}')
  case "$serial" in
    emulator-*|*:* ) echo "Device $serial is not a USB-connected physical device" >&2; exit 7 ;;
  esac
  case "$state" in
    "device "*) ;;
    "unauthorized "*) echo "Device $serial is unauthorized; accept the USB debugging prompt" >&2; exit 3 ;;
    "offline "*) echo "Device $serial is offline" >&2; exit 7 ;;
    *) echo "Device $serial is not an authorized USB device" >&2; exit 7 ;;
  esac
}

check_api_level() {
  serial=$1
  api=$(adb -s "$serial" shell getprop ro.build.version.sdk | tr -d '[:space:]')
  case "$api" in
    ''|*[!0-9]*) echo "Could not read API level from device $serial" >&2; exit 5 ;;
  esac
  if [ "$api" -lt "$min_api" ]; then
    echo "Device $serial reports API $api; this module requires API $min_api or later" >&2
    exit 6
  fi
  printf '%s' "$api"
}

cmd_check() {
  serial=$(resolve_serial)
  validate_usb_serial "$serial"
  api=$(check_api_level "$serial")
  echo "Device OK: serial=$serial api=$api"
}

cmd_connect() {
  serial=$(resolve_serial)
  validate_usb_serial "$serial"
  check_api_level "$serial" >/dev/null
  mappings=$(adb -s "$serial" reverse --list)
  if printf '%s\n' "$mappings" | grep -q 'tcp:8080'; then
    printf '%s\n' "$mappings" | grep -q 'tcp:8080 tcp:8080' || { echo "Conflicting reverse mapping exists on $serial; refusing to replace it" >&2; exit 8; }
    echo "Reversed device:8080 -> host:8080 on $serial (already present). Backend URL: http://127.0.0.1:8080"
    return 0
  fi
  adb -s "$serial" reverse tcp:8080 tcp:8080
  echo "Reversed device:8080 -> host:8080 on $serial. Backend URL: http://127.0.0.1:8080"
}

cmd_teardown() {
  serial=$(resolve_serial)
  validate_usb_serial "$serial"
  mappings=$(adb -s "$serial" reverse --list)
  exact_mapping=$(printf '%s\n' "$mappings" | awk -v serial="$serial" '$1 == serial && $2 == "tcp:8080" && $3 == "tcp:8080" { found=1 } END { if (found) print "yes" }')
  if [ "$exact_mapping" != yes ]; then
    echo "No exact host/device port-8080 reverse mapping on $serial."
    return 0
  fi
  adb -s "$serial" reverse --remove tcp:8080
  echo "Removed host/device port-8080 reverse on $serial."
}

cmd_module_tests() {
  serial=$(resolve_serial)
  validate_usb_serial "$serial"
  check_api_level "$serial" >/dev/null
  ( cd "$frontend_dir/android" && ANDROID_SERIAL="$serial" ./gradlew "${module_task}:connectedDebugAndroidTest" )
}

cmd_install() {
  serial=$(resolve_serial)
  validate_usb_serial "$serial"
  check_api_level "$serial" >/dev/null
  ( cd "$frontend_dir" && npm run android -- --device "$serial" )
}

case "${1:-}" in
  check) cmd_check ;;
  connect) cmd_connect ;;
  teardown) cmd_teardown ;;
  module-tests) cmd_module_tests ;;
  install) cmd_install ;;
  *)
    echo "Usage: $0 {check|connect|teardown|module-tests|install}" >&2
    exit 1
    ;;
esac
