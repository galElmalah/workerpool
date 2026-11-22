import SwiftUI
import CadenceKit

// Colour for DATA (docs/DESIGN_V2.md §8): sport identity, intensity zones, status and the three chart
// series. The chrome stays neutral and the accent keeps its job (primary action, today, selection).
// Rules: text is never tinted with these (the coloured mark sits beside the fg-* text); fills behind
// text are soft tints (≤ 14 %, `DataColor.tint`); glyphs, dots, bars and lines carry the full colour;
// no coloured edge stripes. Every colour adapts to light/dark (values: dark / light).

enum DataColor {
    // MARK: Palette (dark, light)

    private static let blue = Color.adaptive(light: RGBA(0x2A78D6), dark: RGBA(0x3987E5))
    private static let orange = Color.adaptive(light: RGBA(0xEB6834), dark: RGBA(0xD95926))
    private static let aqua = Color.adaptive(light: RGBA(0x1BAF7A), dark: RGBA(0x199E70))
    private static let yellow = Color.adaptive(light: RGBA(0xEDA100), dark: RGBA(0xC98500))
    private static let zoneYellow = Color.adaptive(light: RGBA(0xEDA100), dark: RGBA(0xCF9A00))
    private static let magenta = Color.adaptive(light: RGBA(0xE87BA4), dark: RGBA(0xD55181))
    private static let green = Color.adaptive(light: RGBA(0x008300), dark: RGBA(0x0CA30C))
    private static let violet = Color.adaptive(light: RGBA(0x6250D6), dark: RGBA(0x9085E9))
    private static let red = Color.adaptive(light: RGBA(0xE34948), dark: RGBA(0xE66767))
    private static let zoneRed = Color.adaptive(light: RGBA(0xE34948), dark: RGBA(0xE2554F))
    /// z1, yoga, other
    private static let grey = Color.adaptive(light: RGBA(0x8E949C), dark: RGBA(0x80868F))

    // MARK: Sport

    /// The sport's identity colour (glyphs, by-sport bars, route lines). Yoga / other are grey.
    static func sport(_ sport: Sport) -> Color {
        switch sport {
        case .bike: return blue
        case .run: return orange
        case .swim: return aqua
        case .walk: return yellow
        case .strength: return magenta
        case .hike: return green
        case .row: return violet
        case .ski: return red
        case .yoga, .other, .unknown: return grey
        }
    }

    /// The soft fill behind a completed session row / chip (12 % of the sport colour).
    static func sportTint(_ sport: Sport) -> Color { self.sport(sport).opacity(0.12) }

    /// A soft fill (≤ 14 %) of any data colour, for areas that sit behind text.
    static func tint(_ color: Color, _ opacity: Double = 0.12) -> Color { color.opacity(min(0.14, opacity)) }

    // MARK: Intensity zones

    /// Zone 1…7: grey, blue, aqua, yellow, red, violet, magenta.
    static func zone(_ zone: Int) -> Color {
        switch min(7, max(1, zone)) {
        case 1: return grey
        case 2: return blue
        case 3: return aqua
        case 4: return zoneYellow
        case 5: return zoneRed
        case 6: return violet
        default: return magenta
        }
    }

    /// recovery z1, endurance z2, tempo z3, threshold z4, high z5, race z6.
    static func intensity(_ c: IntensityClass) -> Color { zone(zoneIndex(c)) }

    /// The zone (1…7) an intensity class is drawn with.
    static func zoneIndex(_ c: IntensityClass) -> Int {
        switch c {
        case .recovery, .unknown: return 1
        case .endurance: return 2
        case .tempo: return 3
        case .threshold: return 4
        case .high: return 5
        case .race: return 6
        }
    }

    // MARK: Status (always with an icon or a word)

    static let good = Color.adaptive(light: RGBA(0x008300), dark: RGBA(0x0CA30C))
    static let warn = Color.adaptive(light: RGBA(0xC98500), dark: RGBA(0xFAB219))
    static let serious = Color.adaptive(light: RGBA(0xD95926), dark: RGBA(0xEC835A))
    static let critical = Color.adaptive(light: RGBA(0xD03B3B), dark: RGBA(0xE05252))

    /// Status colour of a compliance mark; nil = neutral (planned, skipped).
    static func status(_ state: ComplianceState) -> Color? {
        switch state {
        case .onTarget, .unplanned: return good
        case .partialShort, .partialLong: return warn
        case .offShort, .offLong: return serious
        case .missed: return critical
        case .planned, .excused, .unknown: return nil
        }
    }

    /// Status colour of a session state; nil = neutral.
    static func status(_ state: SessionState) -> Color? {
        switch state {
        case .done: return good
        case .missed: return critical
        case .planned, .skipped, .unknown: return nil
        }
    }

    // MARK: Chart series

    /// series-1
    static let fitness = blue
    /// series-2
    static let fatigue = orange
    /// series-3
    static let form = aqua
}
