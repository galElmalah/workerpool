#!/usr/bin/env bash
# Build and test CadenceKit on Linux (or macOS) with a swift.org toolchain, plus the Python checks.
#
#   SWIFT_BIN=/path/to/swift-6.2.1-RELEASE-ubuntu24.04/usr/bin apps/ios/scripts/linux-test.sh
#   CADENCE_BASE_URL=http://localhost:5240 CADENCE_PASSPHRASE=cadence-demo apps/ios/scripts/linux-test.sh   # + live suite
#
# SWIFT_BIN defaults to the directory of `swift` on PATH. Without CADENCE_BASE_URL/CADENCE_PASSPHRASE
# the IntegrationTests are skipped. The SwiftUI targets (App/, Widgets/, Shared/) cannot be type-checked
# on Linux (no SwiftUI/WidgetKit); they are only parsed here — build them in Xcode.
set -euo pipefail

IOS="$(cd "$(dirname "$0")/.." && pwd)"
SWIFT_BIN="${SWIFT_BIN:-$(dirname "$(command -v swift)")}"
SWIFT="$SWIFT_BIN/swift"
SWIFTC="$SWIFT_BIN/swiftc"
SCRATCH="${TMPDIR:-/tmp}/cadencekit-swift6"

echo "== fixtures vs Swift models (no compiler needed)"
python3 "$IOS/scripts/check_fixtures.py" --strict

cd "$IOS/CadenceKit"
echo "== swift build (package language mode: Swift 5, tools 5.9)"
"$SWIFT" build

echo "== swift build in Swift 6 language mode with complete concurrency checking (warnings = errors)"
"$SWIFT" build --scratch-path "$SCRATCH" -Xswiftc -swift-version -Xswiftc 6 -Xswiftc -strict-concurrency=complete -Xswiftc -warnings-as-errors

echo "== swift test (IntegrationTests run only when CADENCE_BASE_URL and CADENCE_PASSPHRASE are set)"
"$SWIFT" test

echo "== parse SwiftUI sources (syntax only)"
cd "$IOS"
find App Widgets Shared -name '*.swift' -print0 | xargs -0 -n1 "$SWIFTC" -parse
"$SWIFTC" -typecheck -I CadenceKit/.build/debug/Modules Shared/Palette.generated.swift

if [[ -n "${CADENCE_BASE_URL:-}" && -n "${CADENCE_PASSPHRASE:-}" ]]; then
  echo "== Python contract smoke test against $CADENCE_BASE_URL"
  python3 "$IOS/scripts/contract_smoke.py" --base "$CADENCE_BASE_URL" --passphrase "$CADENCE_PASSPHRASE"
fi
echo "== all good"
