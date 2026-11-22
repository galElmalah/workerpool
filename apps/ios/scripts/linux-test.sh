#!/usr/bin/env bash
# Build and test CadenceKit on Linux (or macOS) with a swift.org toolchain, plus the Python checks.
#
#   SWIFT_BIN=/path/to/swift-6.2.1-RELEASE-ubuntu24.04/usr/bin apps/ios/scripts/linux-test.sh
#   CADENCE_BASE_URL=http://localhost:5240 CADENCE_PASSPHRASE=cadence-demo apps/ios/scripts/linux-test.sh   # + live suite
#
# SWIFT_BIN defaults to the directory of `swift` on PATH. Without CADENCE_BASE_URL/CADENCE_PASSPHRASE
# the IntegrationTests are skipped. SwiftUI/WidgetKit/AppIntents/Charts/MapKit do not exist on Linux:
# the app and widget targets are type-checked against stub SDK modules (scripts/typecheck-stubs.sh,
# scripts/stubs/) — that proves internal consistency, not SDK correctness; build them in Xcode.
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

echo "== type-check the app and widget targets against the stub SDK (Swift 5 mode + complete concurrency checking)"
SWIFT_BIN="$SWIFT_BIN" STRICT_CONCURRENCY=1 "$IOS/scripts/typecheck-stubs.sh"

if [[ -n "${CADENCE_BASE_URL:-}" && -n "${CADENCE_PASSPHRASE:-}" ]]; then
  echo "== Python contract smoke test against $CADENCE_BASE_URL"
  python3 "$IOS/scripts/contract_smoke.py" --base "$CADENCE_BASE_URL" --passphrase "$CADENCE_PASSPHRASE"
fi
echo "== all good"
