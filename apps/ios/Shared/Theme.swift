import SwiftUI
import UIKit
import CadenceKit

// Design tokens for the app and the widgets — the iOS side of docs/DESIGN_V2.md:
// calm neutrals, ONE rationed accent (blue default; green and rose from Settings.accent), neutral
// "done" marks, no coloured edge stripes, sentence-case labels, SF Pro with tabular digits.
// Colours come from Palette.generated.swift (scripts/make_assets.py converts the web OKLCH tokens).

extension UIColor {
    convenience init(_ c: RGBA) {
        self.init(red: CGFloat(c.r), green: CGFloat(c.g), blue: CGFloat(c.b), alpha: CGFloat(c.a))
    }
}

extension Color {
    /// A colour that follows the current light/dark appearance (works in widgets too).
    static func adaptive(light: RGBA, dark: RGBA) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
    }
}

/// Semantic colours for one accent; every colour adapts to light/dark by itself.
/// Use: `@Environment(\.cadenceAccent) var accent` → `Theme.colors(accent).fg2`.
struct ThemeColors {
    let accent: Accent

    private func token(_ key: KeyPath<PaletteTokens, RGBA>) -> Color {
        let a = accent == .unknown ? Accent.blue : accent
        return .adaptive(light: GeneratedPalette.tokens(accent: a, dark: false)[keyPath: key],
                         dark: GeneratedPalette.tokens(accent: a, dark: true)[keyPath: key])
    }

    /// page background (soft near-black / light grey — never pure black or white)
    var canvas: Color { token(\.canvas) }
    /// cards: one surface step up, no border
    var surface1: Color { token(\.surface1) }
    /// wells, secondary buttons, "done" fills
    var surface2: Color { token(\.surface2) }
    var surface3: Color { token(\.surface3) }
    /// pressed / selected rows
    var surfaceActive: Color { token(\.surfaceActive) }
    /// primary text and numbers
    var fg1: Color { token(\.fg1) }
    /// supporting text
    var fg2: Color { token(\.fg2) }
    /// labels, units, secondary lines
    var fg3: Color { token(\.fg3) }
    /// disabled, missed, placeholders
    var fg4: Color { token(\.fg4) }
    /// the rare hairline divider
    var line1: Color { token(\.line1) }
    /// outlined controls / inputs
    var line2: Color { token(\.line2) }
    var line3: Color { token(\.line3) }
    /// Rationed: the one primary action, today/now, the current selection, the hero chart series.
    /// Never for "done", Load or other stat numbers, never as an edge stripe.
    var accentColor: Color { token(\.accent) }
    var accentPress: Color { token(\.accentPress) }
    /// accent-coloured text (links, today label)
    var accentInk: Color { token(\.accentInk) }
    /// text on an accent fill
    var onAccent: Color { token(\.onAccent) }

    /// Zone ramp z1…z7 (opaque, single hue, lightness-monotonic). Pair with a label or position.
    func zone(_ index: Int) -> Color {
        switch min(7, max(1, index)) {
        case 1: return token(\.z1)
        case 2: return token(\.z2)
        case 3: return token(\.z3)
        case 4: return token(\.z4)
        case 5: return token(\.z5)
        case 6: return token(\.z6)
        default: return token(\.z7)
        }
    }
}

enum Theme {
    static func colors(_ accent: Accent) -> ThemeColors { ThemeColors(accent: accent) }

    /// 4-pt grid: 4 · 8 · 12 · 16 · 24 · 32 · 48
    enum Space {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let s: CGFloat = 12
        static let m: CGFloat = 16
        static let l: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 48
        /// screen side gutter
        static let gutter: CGFloat = 16
        /// card padding (DESIGN_V2: 20 on mobile)
        static let card: CGFloat = 20
        /// between sections
        static let section: CGFloat = 48
    }

    enum Radius {
        /// cards
        static let card: CGFloat = 14
        static let control: CGFloat = 10
        static let small: CGFloat = 6
    }

    /// SF Pro through Dynamic Type text styles. Hierarchy comes from colour and weight before size;
    /// at most three sizes per card. Every number uses a `stat*` style (tabular digits).
    enum Typography {
        static let title1 = Font.system(.title, design: .default, weight: .semibold)
        static let title2 = Font.system(.title2, design: .default, weight: .semibold)
        /// section and card titles
        static let title3 = Font.system(.headline, design: .default, weight: .semibold)
        static let body = Font.body
        static let bodySmall = Font.subheadline
        /// labels above stats, column headers — sentence case, never uppercase
        static let label = Font.system(.footnote, design: .default, weight: .medium)
        static let caption = Font.caption
        static let statSmall = Font.system(.body, design: .default, weight: .semibold).monospacedDigit()
        static let statMedium = Font.system(.title3, design: .default, weight: .semibold).monospacedDigit()
        static let statLarge = Font.system(.title, design: .default, weight: .semibold).monospacedDigit()
        /// one hero number per screen at most (fixed 44 pt, does not scale)
        static let statDisplay = Font.system(size: 44, weight: .semibold, design: .default).monospacedDigit()
        /// body-size numbers inside text rows (durations, distances)
        static let numeric = Font.subheadline.monospacedDigit()
    }

    /// Calm, short motion. Respect `accessibilityReduceMotion` (use `Theme.Motion.resolved`).
    enum Motion {
        static let fast = Animation.easeOut(duration: 0.14)
        static let base = Animation.easeInOut(duration: 0.24)
        static let slow = Animation.easeInOut(duration: 0.42)
        static let snappy = Animation.spring(response: 0.4, dampingFraction: 0.9)
        static let smooth = Animation.spring(response: 0.5, dampingFraction: 1.0)
        static let gentle = Animation.spring(response: 0.9, dampingFraction: 0.95)

        static func resolved(_ animation: Animation, reduceMotion: Bool) -> Animation? {
            reduceMotion ? nil : animation
        }
    }
}

// MARK: - Accent in the environment

private struct CadenceAccentKey: EnvironmentKey {
    static let defaultValue: Accent = .blue
}

extension EnvironmentValues {
    /// The athlete's accent (Settings.accent, mirrored to `SharedPreferences` for widgets).
    var cadenceAccent: Accent {
        get { self[CadenceAccentKey.self] }
        set { self[CadenceAccentKey.self] = newValue }
    }
}

extension View {
    /// Sets the accent for this subtree (environment + system tint for controls).
    func cadenceAccent(_ accent: Accent) -> some View {
        environment(\.cadenceAccent, accent).tint(Theme.colors(accent).accentColor)
    }

    /// A card: surface-1 fill, 14-pt continuous corners, 20-pt padding. No border, no shadow.
    func cadenceCard(padding: CGFloat = Theme.Space.card) -> some View {
        modifier(CardModifier(padding: padding))
    }
}

private struct CardModifier: ViewModifier {
    @Environment(\.cadenceAccent) private var accent
    let padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.colors(accent).surface1, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }
}

extension ThemePreference {
    /// For `.preferredColorScheme(_:)`; nil follows the system.
    var colorScheme: ColorScheme? {
        switch self {
        case .dark: return .dark
        case .light: return .light
        case .system, .unknown: return nil
        }
    }
}
