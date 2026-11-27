#!/bin/sh
# Offline harness tests: all external tools are fakes; never contacts a device.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/bin" "$tmp/frontend/scripts" "$tmp/frontend/android"
cp "$script_dir/android-device.sh" "$tmp/frontend/scripts/android-device.sh"
cat >"$tmp/bin/adb" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" >>"$ADB_LOG"
case "$*" in
  'devices -l') printf 'List of devices attached\n%b' "${ADB_DEVICES:-}" ;;
  *'shell getprop ro.build.version.sdk') printf '%s\n' "${ADB_API_LEVEL:-29}" ;;
  *'reverse --list') [ "${ADB_LIST_STATUS:-0}" -eq 0 ] || exit "$ADB_LIST_STATUS"; printf '%b' "${ADB_MAPPINGS:-}" ;; 
  *'reverse tcp:8080 tcp:8080') exit "${ADB_REVERSE_STATUS:-0}" ;;
  *'reverse --remove tcp:8080') exit "${ADB_TEARDOWN_STATUS:-0}" ;;
  *) exit 0 ;;
esac
FAKE
cat >"$tmp/bin/npm" <<'FAKE'
#!/bin/sh
printf 'npm %s\n' "$*" >>"$FORWARD_LOG"
FAKE
cat >"$tmp/frontend/android/gradlew" <<'FAKE'
#!/bin/sh
printf 'gradle serial=%s args=%s\n' "$ANDROID_SERIAL" "$*" >>"$FORWARD_LOG"
FAKE
chmod +x "$tmp/bin/adb" "$tmp/bin/npm" "$tmp/frontend/android/gradlew"
export PATH="$tmp/bin:$PATH" ADB_LOG="$tmp/adb.log" FORWARD_LOG="$tmp/forward.log"
# Fake adb runs as a child process, so fixture assignments below must be exported.
export ADB_DEVICES ADB_API_LEVEL ADB_MAPPINGS ADB_REVERSE_STATUS ADB_TEARDOWN_STATUS ADB_LIST_STATUS
run() {
  : >"$ADB_LOG"; : >"$FORWARD_LOG"
  set +e
  sh "$tmp/frontend/scripts/android-device.sh" "$@" >"$tmp/out" 2>"$tmp/err"
  status=$?
  set -e
}
assert_status() { [ "$status" -eq "$1" ] || { echo "expected exit $1, got $status ($*)" >&2; cat "$tmp/err" >&2; exit 1; }; }

unset ANDROID_SERIAL || true
ADB_DEVICES=''
run check; assert_status 3
ADB_DEVICES='serial-x unauthorized usb:1\n'
run check; assert_status 3
ADB_DEVICES='serial-a device usb:1\nserial-b device usb:2\n'
run check; assert_status 4
grep -q serial-a "$tmp/err"
ANDROID_SERIAL=serial-b; export ANDROID_SERIAL
ADB_DEVICES='test-device-001 device product:synthetic_product model:synthetic_model device:synthetic_device transport_id:1\n'
unset ANDROID_SERIAL
run check; assert_status 0
grep -q 'serial=test-device-001' "$tmp/out"
ANDROID_SERIAL=test-device-001; export ANDROID_SERIAL
run check; assert_status 0
grep -q 'serial=test-device-001' "$tmp/out"
ANDROID_SERIAL=serial-b; ADB_DEVICES='serial-b device usb:2\n'
run check; assert_status 0
grep -q serial-b "$tmp/out"
ANDROID_SERIAL=emulator-5554
ADB_DEVICES='emulator-5554 device product:sdk\n'
run check; assert_status 7
ANDROID_SERIAL=wifi:host:5555; ADB_DEVICES='wifi:host:5555 device product:test\n'
run check; assert_status 7
ANDROID_SERIAL=offline-phone; ADB_DEVICES='offline-phone offline usb:1\n'
run check; assert_status 7
ANDROID_SERIAL=unauthorized-phone; ADB_DEVICES='unauthorized-phone unauthorized usb:1\n'
run check; assert_status 3
ANDROID_SERIAL=emulator-5554
run check; assert_status 7
ANDROID_SERIAL=serial-b
ADB_DEVICES='serial-b device usb:2\n'
ADB_API_LEVEL=bad; run check; assert_status 5
ADB_API_LEVEL=28; run check; assert_status 6
ADB_API_LEVEL=29

# Transport types other than an attached USB device are refused.
ANDROID_SERIAL=wifi:host:5555; ADB_DEVICES='wifi:host:5555 device product:test\n'
run check; assert_status 7
ANDROID_SERIAL=serial-b; ADB_DEVICES='serial-b device usb:2\n'
ADB_REVERSE_STATUS=1; run connect; [ "$status" -ne 0 ]
unset ADB_REVERSE_STATUS
ADB_MAPPINGS='serial-b tcp:8080 tcp:9090\n'; run connect; assert_status 8
ADB_MAPPINGS=''; run connect; assert_status 0
grep -qx -- '-s serial-b reverse tcp:8080 tcp:8080' "$ADB_LOG"
ADB_MAPPINGS='serial-b tcp:8080 tcp:8080\n'; run connect; assert_status 0
! grep -q -- 'reverse tcp:8080 tcp:8080' "$ADB_LOG" || { echo 'existing reverse mapping was unnecessarily replaced' >&2; exit 1; }
run teardown; assert_status 0
ADB_MAPPINGS='serial-b tcp:8080 tcp:8080\n'; run teardown; assert_status 0
grep -qx -- '-s serial-b reverse --remove tcp:8080' "$ADB_LOG"
ADB_MAPPINGS='serial-b tcp:9090 tcp:8080\n'; run teardown; assert_status 0
! grep -q -- 'reverse --remove' "$ADB_LOG" || { echo 'device-only port 8080 mapping was removed' >&2; exit 1; }
ADB_MAPPINGS='serial-b tcp:8080 tcp:9090\n'; run teardown; assert_status 0
! grep -q -- 'reverse --remove' "$ADB_LOG" || { echo 'host-only port 8080 mapping was removed' >&2; exit 1; }
ADB_MAPPINGS='serial-b tcp:9090 tcp:9090\n'; run teardown; assert_status 0
! grep -q -- 'reverse --remove' "$ADB_LOG" || { echo 'unrelated mapping was removed' >&2; exit 1; }
ADB_MAPPINGS=''; run teardown; assert_status 0
! grep -q -- 'reverse --remove' "$ADB_LOG" || { echo 'absent mapping was removed' >&2; exit 1; }
ADB_LIST_STATUS=1; run teardown; [ "$status" -ne 0 ]; unset ADB_LIST_STATUS
ADB_MAPPINGS='serial-b tcp:8080 tcp:8080\n'; ADB_TEARDOWN_STATUS=1
run teardown; [ "$status" -ne 0 ]
unset ADB_TEARDOWN_STATUS
run teardown; assert_status 0

# Verify arguments and serial reach the Windows-capable wrapper entry points.
run module-tests; assert_status 0
grep -q 'gradle serial=serial-b args=:ipv6ftp-voice-engine:connectedDebugAndroidTest' "$FORWARD_LOG"
run install; assert_status 0
grep -qx 'npm run android -- --device serial-b' "$FORWARD_LOG"
echo 'Android device harness offline tests passed.'
