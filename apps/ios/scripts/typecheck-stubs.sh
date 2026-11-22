#!/usr/bin/env bash
# Type-checks the SwiftUI app and widget targets on Linux against stub SDK modules.
#
#   SWIFT_BIN=/path/to/swift-6.2.1-RELEASE-ubuntu24.04/usr/bin apps/ios/scripts/typecheck-stubs.sh
#
# SwiftUI, WidgetKit, AppIntents, Charts and MapKit do not exist on Linux. scripts/stubs/*.swift
# declares the parts of them Cadence uses, written from the iOS 17 SDK signatures (see the header of
# stubs/SwiftUI.swift). This script
#   1. builds CadenceKit (the real module) with `swift build`,
#   2. compiles the stubs into modules,
#   3. runs `swiftc -typecheck` (Swift 5 language mode, like project.yml) over each target with the
#      same source membership as project.yml:
#        app     = App/** + Shared/**                                   (module Cadence)
#        widgets = Widgets/** + Shared/** minus Shared/Intents/AppOnly/** (module CadenceWidgets)
#   4. checks that every iOS 18-only API is used under `@available(iOS 18` / `#available(iOS 18`
#      (Linux ignores availability, so this is a textual check),
#   5. checks that every Swift file under App/, Widgets/, Shared/ belongs to a target.
#
# What a pass means: the targets are internally consistent (names, labels, types, optionality,
# async/throws, CadenceKit usage, result-builder shapes) against declarations that mirror Apple's.
# It does not prove the stubs match the real SDK, and it says nothing about runtime behaviour.
# Warnings fail the check too. STRICT_CONCURRENCY=1 adds -strict-concurrency=complete (Swift 6 diagnostics).
set -euo pipefail

IOS="$(cd "$(dirname "$0")/.." && pwd)"
SWIFT_BIN="${SWIFT_BIN:-$(dirname "$(command -v swift)")}"
SWIFTC="$SWIFT_BIN/swiftc"
WORK="${TYPECHECK_WORK:-${TMPDIR:-/tmp}/cadence-typecheck}"
STUBS="$IOS/scripts/stubs"
MODS="$WORK/modules"

echo "== build CadenceKit"
(cd "$IOS/CadenceKit" && "$SWIFT_BIN/swift" build >/dev/null)
CK="$(cd "$IOS/CadenceKit" && "$SWIFT_BIN/swift" build --show-bin-path)/Modules"

echo "== compile stub SDK modules"
rm -rf "$WORK"; mkdir -p "$MODS"
for mod in Combine UIKit CoreLocation BackgroundTasks SwiftUI Charts MapKit AppIntents WidgetKit; do
  "$SWIFTC" -emit-module -parse-as-library -swift-version 5 -suppress-warnings -module-name "$mod" -I "$MODS" \
    -emit-module-path "$MODS/$mod.swiftmodule" "$STUBS/$mod.swift"
done

# Linux-only shim: KeychainTokenStore is compiled only where `Security` exists (Apple platforms).
SHIM="$WORK/shim"; mkdir -p "$SHIM"
cat > "$SHIM/_LinuxShim.swift" <<'EOF'
import CadenceKit
// Same public API as CadenceKit's KeychainTokenStore (TokenStore.swift, `#if canImport(Security)`).
public final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    public init(service: String = "app.cadence.device", account: String = "credentials", accessGroup: String?) {}
    public func load() -> DeviceCredentials? { nil }
    public func save(_ credentials: DeviceCredentials) throws {}
    public func clear() {}
}
EOF

status=0
typecheck() {
  local name="$1" module="$2"; shift 2
  local dir="$WORK/$name"
  local n
  n=$(python3 "$STUBS/prepare_sources.py" "$dir" "$IOS" "$@")
  echo "== type-check $name target ($n files, module $module)"
  local extra=()
  if [[ "${STRICT_CONCURRENCY:-0}" == 1 ]]; then extra=(-strict-concurrency=complete); fi
  if ! "$SWIFTC" -typecheck -continue-building-after-errors -parse-as-library -swift-version 5 -module-name "$module" \
      -I "$MODS" -I "$CK" "${extra[@]}" "$dir"/*.swift "$SHIM/_LinuxShim.swift" 2>"$WORK/$name.log"; then
    status=1
  fi
  # map flattened names back to repo paths
  sed -E "s#$dir/([^:]+)#\1#; s#__#/#g" "$WORK/$name.log" | grep -E "error:|warning:" | sort -u || true
  # the targets are kept warning-free too
  if grep -q "warning:" "$WORK/$name.log"; then status=1; fi
}

typecheck app Cadence App Shared
typecheck widgets CadenceWidgets Widgets Shared --exclude Shared/Intents/AppOnly/

echo "== iOS 18 APIs only behind availability checks"
python3 - "$IOS" <<'EOF' || status=1
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
ios18 = r'\b(navigationTransition|matchedTransitionSource|ControlWidget\w*|StaticControlConfiguration|OpenURLIntent|ControlCenter|promptsForUserConfiguration|widgetAccentedRenderingMode|URLRepresentableIntent|ControlConfigurationIntent)\b'
bad = 0
for f in sorted(list(root.glob('App/**/*.swift')) + list(root.glob('Widgets/**/*.swift')) + list(root.glob('Shared/**/*.swift'))):
    lines = f.read_text().splitlines()
    for i, line in enumerate(lines):
        code = line.split('//')[0]
        if not re.search(ios18, code):
            continue
        # walk back to find an enclosing iOS 18 guard (an @available on the declaration or an if #available)
        depth, ok = 0, False
        for j in range(i, -1, -1):
            l = lines[j].split('//')[0]
            if j < i:
                depth += l.count('}') - l.count('{')
            if re.search(r'[@#]available\(iOS(ApplicationExtension)? 18', l) and depth <= 0:
                ok = True; break
            if depth < -8: break
        if not ok:
            bad += 1
            print(f'{f.relative_to(root)}:{i+1}: iOS 18 API without an iOS 18 availability guard: {line.strip()}')
print('ok' if bad == 0 else f'{bad} unguarded use(s)')
sys.exit(1 if bad else 0)
EOF

echo "== every Swift file belongs to a target (project.yml: App, Shared → app; Widgets, Shared − AppOnly → widgets)"
orphans=$(cd "$IOS" && find . -name '*.swift' -not -path './CadenceKit/*' -not -path './scripts/*' \
  | grep -vE '^\./(App|Widgets|Shared)/' || true)
if [[ -n "$orphans" ]]; then echo "not in any target:"; echo "$orphans"; status=1; else echo ok; fi

if [[ $status == 0 ]]; then echo "== stub type-check passed"; else echo "== stub type-check FAILED"; fi
exit $status
