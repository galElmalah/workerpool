# Cadence for iOS

Native iPhone app and widgets for Cadence. It talks to the same Cloudflare Worker as the web app,
authenticated with a revocable **device token** (docs/MOBILE_API.md). iOS 17+, SwiftUI, WidgetKit,
no third-party dependencies.

```
apps/ios/
  project.yml            XcodeGen spec (app "Cadence" + widget extension "CadenceWidgets")
  Config/Cadence.xcconfig  team, bundle id, App Group, keychain group — the one file you edit
  CadenceKit/            Swift package: models, API client, storage, formatting, widget view-models, tests
  App/                   app target (placeholder screens for now) + Assets.xcassets (accents, app icon)
  Widgets/               widget extension (one placeholder Today widget) + Assets.xcassets
  Shared/                compiled into both targets: Theme (design tokens), small components, palette
  scripts/               fixture capture / cross-check / contract smoke test / asset generation (Python)
  ENGINEERING.md         API surface and conventions for the engineers building screens and widgets
```

## Open and run on a Mac

1. Xcode 15 or newer (Swift 5.9), then `brew install xcodegen`.
2. Edit `Config/Cadence.xcconfig`: `CADENCE_TEAM_ID` (your team), `CADENCE_BUNDLE_ID`,
   `CADENCE_APP_GROUP` (must start with `group.`), `CADENCE_KEYCHAIN_GROUP`.
3. `cd apps/ios && xcodegen && open Cadence.xcodeproj`
4. Pick the **Cadence** scheme and an iPhone simulator or your device; Run.
   With automatic signing and a team set, Xcode registers the App Group and keychain group for
   both bundle ids. Without a team the app still runs in the simulator (the keychain falls back to
   the app's own group), but the widget cannot read the token until signing is set up.
5. Widgets: long-press the Home Screen → ＋ → Cadence → "Today". To debug, run the
   **CadenceWidgets** scheme (Xcode asks which app hosts it).

Re-run `xcodegen` after pulling changes to `project.yml` or adding files. Info.plists and
entitlements are generated (see `.gitignore`).

## Connect to your server

On first launch enter the server address and your Cadence passphrase:

- Production: your Worker's origin, e.g. `cadence.example.workers.dev` (https is added).
- Local development: run the web app (`cd apps/web && pnpm dev`, or the seeded demo on
  `http://localhost:5240`, passphrase `cadence-demo`). The simulator reaches the Mac as
  `localhost`; a device needs the Mac's LAN address, e.g. `http://192.168.1.20:5240`
  (plain HTTP is allowed only for localhost, `*.local` and private-network addresses — both in code
  and in the ATS settings).

The app exchanges the passphrase for a device token (`POST /api/auth/devices`) and keeps it in the
shared keychain; the passphrase is not stored. Sign out (menu ⋯) revokes the token on the server.
Revoking the device from the web app, or changing the passphrase, signs the phone out on its next
request.

## CadenceKit on its own

```
cd apps/ios/CadenceKit
swift build && swift test                       # unit tests: formatting, decoding every fixture, widget models, client
CADENCE_BASE_URL=http://localhost:5240 CADENCE_PASSPHRASE=cadence-demo swift test --filter IntegrationTests
```

Works on macOS and on Linux (swift.org toolchain; networking via FoundationNetworking). The
integration suite creates its own device, reads every endpoint, performs reversible writes and
revokes the token — run it against a dev/demo server.

Tools that need only Python 3 (no Swift):

| script | what it does |
|---|---|
| `scripts/capture_fixtures.py --base URL [--writes]` | logs in (device token, cookie fallback), saves trimmed real responses of every endpoint to `CadenceKit/Tests/CadenceKitTests/Fixtures/` (`--writes` only on a throwaway DB) |
| `scripts/check_fixtures.py [--strict]` | parses the Swift models into `CadenceKit/models.manifest.json` and checks every fixture field by field (required vs optional, JSON types, integer fields, enum values, unmodelled keys) |
| `scripts/contract_smoke.py --base URL` | replays the integration suite's 53 requests with the exact paths and bodies `Endpoints` builds and checks each response against the Swift types |
| `scripts/make_assets.py` | converts the web OKLCH tokens (apps/web/src/styles/app.css) to sRGB colour sets, `Shared/Palette.generated.swift` and the app icon (Pillow) |

## Verified vs unverified

This foundation was written on Linux without Xcode or a Swift toolchain.

Verified here:
- Every fixture is a real response from the seeded dev server (device-token flow on port 5240,
  writes on a private copy): 50 fixtures, 0 errors / 0 warnings in `check_fixtures.py` against all
  118 model structs (786 fields) and 45 enums.
- `contract_smoke.py`: all 53 requests of the integration suite pass against a live server,
  including undo (`POST /api/calendar/restore`) with bodies re-encoded from the Swift models, and
  401 for a revoked token.
- Date arithmetic (ISO weeks, weekdays, epoch days) cross-checked against Python's calendar.
- `project.yml` parses as YAML; the colour conversion and icon were generated and inspected.

Not verified (needs a Swift toolchain / Xcode):
- That CadenceKit compiles and its unit tests pass (`swift test`). Written for Swift 5.9 with no
  experimental features; expected values in the tests were computed by hand / in Python.
- The SwiftUI in `App/`, `Widgets/`, `Shared/`, `xcodegen` itself, signing, the keychain sharing
  between app and widget, and how the widgets look on device.
