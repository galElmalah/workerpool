#!/usr/bin/env python3
"""Generate the iOS colour assets, the Swift palette and the app icon from the web tokens.

    python3 apps/ios/scripts/make_assets.py

Source of truth: apps/web/src/styles/app.css (OKLCH tokens, DESIGN_V2 §2). This script converts them
to sRGB (OKLCH → OKLab → linear sRGB → gamma; out-of-gamut channels are clipped) and writes
  App/Assets.xcassets/{AccentColor,AccentBlue,AccentGreen,AccentRose}.colorset   (light + dark)
  App/Assets.xcassets/AppIcon.appiconset                                      (1024 px, needs Pillow)
  Widgets/Assets.xcassets/{AccentColor,WidgetBackground}.colorset
  Shared/Palette.generated.swift                                              (every token × accent × scheme)
Re-run it whenever app.css changes. The app icon is a plain lowercase "c" (a geometric open ring)
in the off-white text colour on the soft near-black canvas — no artwork, per the owner.
"""
from __future__ import annotations

import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))

HUES = {'blue': 252, 'green': 160, 'rose': 8}

# Accent tokens per accent and scheme: (L, C) at the accent hue — copied from app.css.
ACCENTS = {
    'dark': {
        'blue': {'accent': (0.72, 0.12), 'accentHover': (0.77, 0.11), 'accentPress': (0.67, 0.12), 'accentInk': (0.78, 0.10), 'onAccent': (0.20, 0.012)},
        'green': {'accent': (0.76, 0.11), 'accentHover': (0.81, 0.10), 'accentPress': (0.71, 0.11), 'accentInk': (0.80, 0.10), 'onAccent': (0.20, 0.010)},
        'rose': {'accent': (0.76, 0.10), 'accentHover': (0.81, 0.09), 'accentPress': (0.71, 0.10), 'accentInk': (0.80, 0.085), 'onAccent': (0.20, 0.010)},
    },
    'light': {
        'blue': {'accent': (0.53, 0.14), 'accentHover': (0.49, 0.135), 'accentPress': (0.45, 0.125), 'accentInk': (0.50, 0.135), 'onAccent': (1.0, 0.0)},
        'green': {'accent': (0.50, 0.10), 'accentHover': (0.46, 0.095), 'accentPress': (0.42, 0.09), 'accentInk': (0.48, 0.10), 'onAccent': (1.0, 0.0)},
        'rose': {'accent': (0.54, 0.14), 'accentHover': (0.50, 0.14), 'accentPress': (0.46, 0.13), 'accentInk': (0.51, 0.14), 'onAccent': (1.0, 0.0)},
    },
}

# Neutral ramp gray-1..12 (L, C) at the accent hue.
GRAYS = {
    'dark': [(0.165, 0.006), (0.195, 0.006), (0.225, 0.006), (0.260, 0.006), (0.290, 0.006), (0.330, 0.006),
             (0.380, 0.006), (0.440, 0.006), (0.500, 0.006), (0.660, 0.006), (0.780, 0.006), (0.930, 0.004)],
    'light': [(1.0, 0.0), (0.974, 0.004), (0.952, 0.006), (0.930, 0.006), (0.906, 0.006), (0.885, 0.006),
              (0.860, 0.006), (0.790, 0.006), (0.660, 0.006), (0.520, 0.009), (0.430, 0.009), (0.220, 0.009)],
}
# semantic → gray index (1-based)
NEUTRALS = {
    'dark': {'canvas': 1, 'surface1': 2, 'surface2': 3, 'surface3': 4, 'surfaceActive': 5, 'fg1': 12, 'fg2': 11, 'fg3': 10, 'fg4': 9},
    'light': {'canvas': 2, 'surface1': 1, 'surface2': 3, 'surface3': 4, 'surfaceActive': 5, 'fg1': 12, 'fg2': 11, 'fg3': 10, 'fg4': 9},
}
LINES = {'dark': ((1, 1, 1), (0.06, 0.10, 0.16)), 'light': ((0, 0, 0), (0.07, 0.11, 0.17))}
# zone ramp: (L, chroma rule) — rule k means C = 0.030 + (c − 0.030)·k; 'c' = accent chroma; 'c*0.8'
ZONES = {
    'dark': [(0.340, 0.0), (0.423, 0.233), (0.507, 0.467), (0.590, 0.700), (0.673, 0.933), (0.757, 'c'), (0.840, 'c*0.8')],
    'light': [(0.930, 0.0), (0.845, 0.233), (0.760, 0.467), (0.675, 0.700), (0.590, 0.933), (0.505, 'c'), (0.420, 'c')],
}


def oklch_to_srgb(L: float, C: float, h: float) -> tuple[float, float, float]:
    a = C * math.cos(math.radians(h))
    b = C * math.sin(math.radians(h))
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    def gamma(x: float) -> float:
        x = min(1.0, max(0.0, x))
        return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055

    return gamma(r), gamma(g), gamma(bl)


def hexof(rgb) -> str:
    return '#' + ''.join(f'{round(c * 255):02X}' for c in rgb)


def palette(scheme: str, accent: str) -> dict[str, tuple[tuple[float, float, float], float]]:
    hue = HUES[accent]
    out = {}
    for name, idx in NEUTRALS[scheme].items():
        L, C = GRAYS[scheme][idx - 1]
        out[name] = (oklch_to_srgb(L, C, hue), 1.0)
    base, alphas = LINES[scheme]
    for i, a in enumerate(alphas, 1):
        out[f'line{i}'] = (base, a)
    acc = ACCENTS[scheme][accent]
    for name, (L, C) in acc.items():
        out[name] = (oklch_to_srgb(L, C, hue), 1.0)
    c = acc['accent'][1]
    for i, (L, rule) in enumerate(ZONES[scheme], 1):
        if rule == 'c':
            zc = c
        elif rule == 'c*0.8':
            zc = c * 0.8
        else:
            zc = 0.030 + (c - 0.030) * rule
        out[f'z{i}'] = (oklch_to_srgb(L, zc, hue), 1.0)
    return out


def colorset(path: str, light, dark) -> None:
    os.makedirs(path, exist_ok=True)

    def comp(rgba):
        (r, g, b), a = rgba
        return {'color-space': 'srgb', 'components': {'red': f'{r:.3f}', 'green': f'{g:.3f}', 'blue': f'{b:.3f}', 'alpha': f'{a:.3f}'}}

    data = {
        'colors': [
            {'idiom': 'universal', 'color': comp(light)},
            {'idiom': 'universal', 'appearances': [{'appearance': 'luminosity', 'value': 'dark'}], 'color': comp(dark)},
        ],
        'info': {'author': 'xcode', 'version': 1},
    }
    with open(os.path.join(path, 'Contents.json'), 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')


def catalog(path: str) -> None:
    os.makedirs(path, exist_ok=True)
    with open(os.path.join(path, 'Contents.json'), 'w') as f:
        json.dump({'info': {'author': 'xcode', 'version': 1}}, f, indent=2)
        f.write('\n')


def write_swift(pals) -> None:
    order = ['canvas', 'surface1', 'surface2', 'surface3', 'surfaceActive', 'fg1', 'fg2', 'fg3', 'fg4',
             'line1', 'line2', 'line3', 'accent', 'accentHover', 'accentPress', 'accentInk', 'onAccent',
             'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7']
    lines = [
        '// GENERATED by scripts/make_assets.py from apps/web/src/styles/app.css — do not edit by hand.',
        '// sRGB conversions of the web OKLCH tokens (DESIGN_V2 §2), per accent and appearance.',
        '',
        'import CadenceKit',
        '',
        '/// One colour token: sRGB 0…1 + alpha.',
        'struct RGBA: Hashable, Sendable {',
        '    let r: Double, g: Double, b: Double, a: Double',
        '    init(_ hex: UInt32, alpha: Double = 1) {',
        '        r = Double((hex >> 16) & 0xFF) / 255; g = Double((hex >> 8) & 0xFF) / 255; b = Double(hex & 0xFF) / 255; a = alpha',
        '    }',
        '}',
        '',
        '/// Every token for one accent in one appearance.',
        'struct PaletteTokens: Hashable, Sendable {',
    ]
    for k in order:
        lines.append(f'    let {k}: RGBA')
    lines += ['    /// zone ramp z1…z7 (opaque, one hue, lightness-monotonic)', '    var zones: [RGBA] { [z1, z2, z3, z4, z5, z6, z7] }', '}', '',
              'enum GeneratedPalette {', '    static func tokens(accent: Accent, dark: Bool) -> PaletteTokens {',
              '        switch (accent, dark) {']
    for accent in ['blue', 'green', 'rose']:
        for scheme in ['dark', 'light']:
            p = pals[(scheme, accent)]
            lines.append(f'        case (.{accent}, {"true" if scheme == "dark" else "false"}): return {accent}{scheme.capitalize()}')
    lines += ['        default: return dark ? blueDark : blueLight', '        }', '    }', '']
    for accent in ['blue', 'green', 'rose']:
        for scheme in ['dark', 'light']:
            p = pals[(scheme, accent)]
            lines.append(f'    static let {accent}{scheme.capitalize()} = PaletteTokens(')
            args = []
            for k in order:
                rgb, a = p[k]
                h = hexof(rgb)[1:]
                args.append(f'        {k}: RGBA(0x{h}' + (f', alpha: {a:g})' if a < 1 else ')'))
            lines.append(',\n'.join(args))
            lines.append('    )')
    lines.append('}')
    with open(os.path.join(ROOT, 'Shared', 'Palette.generated.swift'), 'w') as f:
        f.write('\n'.join(lines) + '\n')


def app_icon(path: str, bg, fg) -> bool:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print('Pillow not installed: skipped the app icon (pip install pillow, then re-run).')
        return False
    os.makedirs(path, exist_ok=True)
    size, ss = 1024, 4
    big = size * ss
    img = Image.new('RGB', (big, big), tuple(round(c * 255) for c in bg))
    d = ImageDraw.Draw(img)
    color = tuple(round(c * 255) for c in fg)
    # a lowercase "c": open ring, centred, ~44% of the icon wide, opening to the right
    r_outer = big * 0.22
    width = big * 0.085
    cx, cy = big / 2 + big * 0.012, big / 2
    start, end = 42, 318  # degrees, PIL measures clockwise from 3 o'clock
    d.arc([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], start=start, end=end, fill=color, width=round(width))
    # round caps
    r_mid = r_outer - width / 2
    for ang in (start, end):
        x = cx + r_mid * math.cos(math.radians(ang))
        y = cy + r_mid * math.sin(math.radians(ang))
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=color)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(path, 'AppIcon-1024.png'), optimize=True)
    with open(os.path.join(path, 'Contents.json'), 'w') as f:
        json.dump({'images': [{'filename': 'AppIcon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
                   'info': {'author': 'xcode', 'version': 1}}, f, indent=2)
        f.write('\n')
    return True


def main() -> None:
    pals = {(s, a): palette(s, a) for s in ('dark', 'light') for a in HUES}
    app = os.path.join(ROOT, 'App', 'Assets.xcassets')
    widgets = os.path.join(ROOT, 'Widgets', 'Assets.xcassets')
    catalog(app)
    catalog(widgets)
    for accent in HUES:
        colorset(os.path.join(app, f'Accent{accent.capitalize()}.colorset'), pals[('light', accent)]['accent'], pals[('dark', accent)]['accent'])
    colorset(os.path.join(app, 'AccentColor.colorset'), pals[('light', 'blue')]['accent'], pals[('dark', 'blue')]['accent'])
    colorset(os.path.join(widgets, 'AccentColor.colorset'), pals[('light', 'blue')]['accent'], pals[('dark', 'blue')]['accent'])
    colorset(os.path.join(widgets, 'WidgetBackground.colorset'), pals[('light', 'blue')]['surface1'], pals[('dark', 'blue')]['canvas'])
    write_swift(pals)
    icon = app_icon(os.path.join(app, 'AppIcon.appiconset'), pals[('dark', 'blue')]['canvas'][0], pals[('dark', 'blue')]['fg1'][0])
    for s in ('dark', 'light'):
        print(s + ': ' + ', '.join(f'{a} {hexof(pals[(s, a)]["accent"][0])}' for a in HUES) +
              f' · canvas {hexof(pals[(s, "blue")]["canvas"][0])} · fg1 {hexof(pals[(s, "blue")]["fg1"][0])}')
    print('app icon: ' + ('written' if icon else 'skipped'))


if __name__ == '__main__':
    main()
