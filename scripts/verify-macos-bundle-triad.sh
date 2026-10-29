#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?}"
test "$#" -eq 3
app="$1"
dmg="$2"
updater="$3"
test -d "$app"
test -f "$dmg"
test -f "$updater"
test -f "$updater.sig"

proof_dir="$RUNNER_TEMP/edupi-macos-bundle-triad"
test ! -e "$proof_dir"
mkdir -m 700 "$proof_dir"
mkdir -m 700 "$proof_dir/updater" "$proof_dir/dmg"
mounted=0
on_exit() {
  if [ "$mounted" -eq 1 ]; then hdiutil detach "$proof_dir/dmg" > /dev/null || true; fi
}
trap on_exit EXIT

tar -tzf "$updater" > "$proof_dir/updater-members.txt"
while IFS= read -r member; do
  normalized="${member#./}"
  case "$normalized" in EduPi.app|EduPi.app/*) ;; *) echo "Unexpected updater member" >&2; exit 1 ;; esac
  case "/$normalized/" in */../*|*/./../*) echo "Unsafe updater member" >&2; exit 1 ;; esac
done < "$proof_dir/updater-members.txt"
COPYFILE_DISABLE=1 tar -xzf "$updater" -C "$proof_dir/updater"
hdiutil attach -readonly -nobrowse -mountpoint "$proof_dir/dmg" "$dmg" > /dev/null
mounted=1

for candidate in "$app" "$proof_dir/updater/EduPi.app" "$proof_dir/dmg/EduPi.app"; do
  test -d "$candidate"
  codesign --verify --deep --strict --verbose=2 "$candidate"
  node scripts/validate-macos-staple.mjs "$candidate"
  spctl --assess --type execute --verbose=2 "$candidate"
done
for relative in \
  Contents/Info.plist \
  Contents/MacOS/pi-agent-desktop \
  Contents/CodeResources \
  Contents/_CodeSignature/CodeResources \
  Contents/Resources/resources/server/contracts/edupi-core-compat.json; do
  expected="$(shasum -a 256 "$app/$relative" | awk '{print $1}')"
  test "$(shasum -a 256 "$proof_dir/updater/EduPi.app/$relative" | awk '{print $1}')" = "$expected"
  test "$(shasum -a 256 "$proof_dir/dmg/EduPi.app/$relative" | awk '{print $1}')" = "$expected"
done

hdiutil detach "$proof_dir/dmg" > /dev/null
mounted=0
echo "Verified one stapled, signed App identity in the local bundle, updater archive, and DMG."
