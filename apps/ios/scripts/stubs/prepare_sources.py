#!/usr/bin/env python3
"""Copies one target's Swift sources into a flat directory for `swiftc -typecheck` against the stubs.

Only change made to the code: each `#Preview` macro (needs Xcode's DeveloperToolsSupport plugin) is
rewritten into a private function that calls a stub with the same shape, so the preview bodies are
type-checked too:

    #Preview("x") { V() }                          -> func __preview_N() { __previewView("x") { V() } }
    #Preview("x", as: .systemSmall) { W() } timeline: { e }
                                                   -> func __preview_N() { __previewWidget("x", as: .systemSmall) { W() } timeline: { e } }

usage: prepare_sources.py OUT_DIR ROOT include1 [include2 …] [--exclude pattern …]
"""
import pathlib
import re
import sys


def skip_string(s, i):
    """s[i] is the opening quote; returns the index after the closing quote (handles \\( … ) nesting)."""
    if s.startswith('"""', i):
        end = s.find('"""', i + 3)
        return end + 3
    i += 1
    while i < len(s):
        c = s[i]
        if c == '\\':
            if i + 1 < len(s) and s[i + 1] == '(':
                i = skip_balanced(s, i + 1, '(', ')')
                continue
            i += 2
            continue
        if c == '"':
            return i + 1
        i += 1
    return i


def skip_balanced(s, i, open_c, close_c):
    """s[i] == open_c; returns the index after the matching close_c."""
    depth = 0
    while i < len(s):
        c = s[i]
        if c == '"':
            i = skip_string(s, i)
            continue
        if s.startswith('//', i):
            i = s.find('\n', i)
            continue
        if c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError('unbalanced')


def rewrite_previews(src):
    out = []
    pos = 0
    n = 0
    for m in re.finditer(r'^#Preview\b', src, flags=re.M):
        if m.start() < pos:
            continue
        out.append(src[pos:m.start()])
        i = m.end()
        args = ''
        if src[i] == '(':
            j = skip_balanced(src, i, '(', ')')
            args = src[i:j]
            i = j
        # trailing closures: `{ … }` then optional `label: { … }` repeated
        k = src.index('{', i)
        k = skip_balanced(src, k, '{', '}')
        while True:
            mm = re.match(r'\s*([A-Za-z_]\w*)\s*:\s*\{', src[k:])
            if not mm:
                break
            k = skip_balanced(src, k + mm.end() - 1, '{', '}')
        body = src[i:k]
        func = '__previewWidget' if re.search(r'\bas:', args) else '__previewView'
        out.append(f'@MainActor private func __preview_{n}() {{ {func}{args}{body} }}')
        n += 1
        pos = k
    out.append(src[pos:])
    return ''.join(out)


def main():
    argv = sys.argv[1:]
    excludes = []
    if '--exclude' in argv:
        idx = argv.index('--exclude')
        excludes = argv[idx + 1:]
        argv = argv[:idx]
    out_dir, root, includes = pathlib.Path(argv[0]), pathlib.Path(argv[1]), argv[2:]
    out_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for inc in includes:
        for f in sorted((root / inc).rglob('*.swift')):
            rel = f.relative_to(root).as_posix()
            if any(rel.startswith(e) for e in excludes):
                continue
            text = rewrite_previews(f.read_text())
            # flat names keep swiftc happy; a header maps diagnostics back to the real file
            (out_dir / rel.replace('/', '__')).write_text(text)
            count += 1
    print(count)


if __name__ == '__main__':
    main()
