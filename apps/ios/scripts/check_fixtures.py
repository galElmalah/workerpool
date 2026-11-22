#!/usr/bin/env python3
"""Cross-check the JSON fixtures against the Swift models — without a Swift compiler.

    python3 apps/ios/scripts/check_fixtures.py            # errors fail, warnings are listed
    python3 apps/ios/scripts/check_fixtures.py --strict   # warnings fail too
    python3 apps/ios/scripts/check_fixtures.py --quiet    # summary only

1. Parses every `public struct` / `public enum … TolerantEnum` in CadenceKit/Sources/CadenceKit/Models
   (the files follow the one-property-per-line convention documented in Models/Common.swift) and writes
   the machine-readable manifest CadenceKit/models.manifest.json: for each struct its fields with type
   and required/optional, for each enum its raw values.
2. For every entry of Fixtures/index.json ("file.json": "SwiftType"), walks the JSON against that type:
   - ERROR   a required (non-optional) field is missing or null; a value has the wrong JSON type
             (string/number/bool/array/object); an Int field holds a non-integral number; a value
             of a non-tolerant enum is unknown; a struct field references an undeclared type.
   - WARNING a JSON key the struct does not declare (silently dropped by JSONDecoder) unless listed
             in a `fixture-ignore:` doc comment; an unknown value of a TolerantEnum (decodes as
             .unknown); a fixture missing from disk.
3. Checks FixtureDecodingTests.swift has a decoder entry for every root type in index.json.
"""
from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.normpath(os.path.join(HERE, '..', 'CadenceKit'))
MODELS = os.path.join(KIT, 'Sources', 'CadenceKit', 'Models')
FIXTURES = os.path.join(KIT, 'Tests', 'CadenceKitTests', 'Fixtures')
TESTS = os.path.join(KIT, 'Tests', 'CadenceKitTests', 'FixtureDecodingTests.swift')
MANIFEST = os.path.join(KIT, 'models.manifest.json')

PRIMITIVES = {'String', 'Int', 'Double', 'Bool', 'JSONValue', 'EmptyResponse'}
ALIASES = {'LocalDate': 'String', 'IsoWeek': 'String', 'IsoInstant': 'String'}

STRUCT_RE = re.compile(r'^public struct (\w+)\b[^{]*\{')
ENUM_RE = re.compile(r'^public enum (\w+)\s*:\s*String\s*,?\s*([\w, ]*)\{')
FIELD_RE = re.compile(r'^    public (?:var|let) (`?\w+`?)\s*:\s*([^{=]+?)\s*$')
CASE_RE = re.compile(r'^    case (.+)$')


def parse_models():
    structs, enums = {}, {}
    for fn in sorted(os.listdir(MODELS)):
        if not fn.endswith('.swift'):
            continue
        lines = open(os.path.join(MODELS, fn), encoding='utf-8').read().split('\n')
        doc: list[str] = []
        cur = None
        for line in lines:
            if cur is None:
                if line.startswith('///'):
                    doc.append(line[3:].strip())
                    continue
                if line.startswith('@'):
                    continue
                m = STRUCT_RE.match(line)
                if m:
                    text = ' '.join(doc)
                    ign = re.search(r'fixture-ignore:\s*([\w ,]+)', text)
                    flat = re.search(r'fixture-flatten:\s*(\w+)', text)
                    cur = ('struct', m.group(1))
                    structs[m.group(1)] = {
                        'file': fn,
                        'fields': {},
                        'ignore': [s.strip() for s in ign.group(1).split(',')] if ign else [],
                        'flatten': flat.group(1) if flat else None,
                    }
                else:
                    m = ENUM_RE.match(line)
                    if m:
                        cur = ('enum', m.group(1))
                        enums[m.group(1)] = {'file': fn, 'tolerant': 'TolerantEnum' in m.group(2), 'values': []}
                doc = []
                continue
            if line.startswith('}'):
                cur = None
                continue
            kind, name = cur
            if kind == 'struct':
                m = FIELD_RE.match(line)
                if m:
                    fname = m.group(1).strip('`')
                    ftype = m.group(2).strip()
                    structs[name]['fields'][fname] = {'type': ftype, 'required': not ftype.endswith('?')}
            else:
                m = CASE_RE.match(line)
                if m:
                    for item in m.group(1).split(','):
                        item = item.strip()
                        if not item:
                            continue
                        mm = re.match(r'(`?\w+`?)(?:\s*=\s*"([^"]*)")?', item)
                        case = mm.group(1).strip('`')
                        raw = mm.group(2) if mm.group(2) is not None else case
                        if case != 'unknown':
                            enums[name]['values'].append(raw)
    return structs, enums


def parse_type(t: str):
    t = t.strip()
    if t.endswith('?'):
        return ('opt', parse_type(t[:-1]))
    m = re.fullmatch(r'Nullable<(.+)>', t)
    if m:
        return ('opt', parse_type(m.group(1)))
    if t.startswith('[') and t.endswith(']'):
        inner = t[1:-1]
        depth = 0
        for i, ch in enumerate(inner):
            if ch in '[<':
                depth += 1
            elif ch in ']>':
                depth -= 1
            elif ch == ':' and depth == 0:
                return ('dict', parse_type(inner[i + 1:]))
        return ('array', parse_type(inner))
    return ('name', ALIASES.get(t, t))


class Checker:
    def __init__(self, structs, enums):
        self.structs, self.enums = structs, enums
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.unmodelled: dict[tuple[str, str], int] = {}
        self.enum_unknown: dict[tuple[str, str], int] = {}

    def check(self, v, t, path):
        kind = t[0]
        if kind == 'opt':
            if v is None:
                return
            return self.check(v, t[1], path)
        if v is None:
            self.errors.append(f'{path}: null for non-optional {fmt(t)}')
            return
        if kind == 'array':
            if not isinstance(v, list):
                self.errors.append(f'{path}: expected array, got {jtype(v)}')
                return
            for i, x in enumerate(v):
                self.check(x, t[1], f'{path}[{i}]')
            return
        if kind == 'dict':
            if not isinstance(v, dict):
                self.errors.append(f'{path}: expected object (dictionary), got {jtype(v)}')
                return
            for k, x in v.items():
                self.check(x, t[1], f'{path}.{k}')
            return
        name = t[1]
        if name == 'String':
            if not isinstance(v, str):
                self.errors.append(f'{path}: expected string, got {jtype(v)}')
        elif name == 'Bool':
            if not isinstance(v, bool):
                self.errors.append(f'{path}: expected bool, got {jtype(v)}')
        elif name == 'Int':
            if isinstance(v, bool) or not isinstance(v, int):
                self.errors.append(f'{path}: expected integer, got {jtype(v)} {v!r}')
        elif name == 'Double':
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                self.errors.append(f'{path}: expected number, got {jtype(v)}')
        elif name in ('JSONValue', 'EmptyResponse'):
            pass
        elif name in self.enums:
            e = self.enums[name]
            if not isinstance(v, str):
                self.errors.append(f'{path}: expected {name} string, got {jtype(v)}')
            elif v not in e['values']:
                if e['tolerant']:
                    self.enum_unknown[(name, v)] = self.enum_unknown.get((name, v), 0) + 1
                else:
                    self.errors.append(f'{path}: "{v}" is not a {name} value')
        elif name in self.structs:
            if not isinstance(v, dict):
                self.errors.append(f'{path}: expected {name} object, got {jtype(v)}')
                return
            s = self.structs[name]
            fields = dict(s['fields'])
            ignore = set(s['ignore'])
            if s['flatten']:
                fields = {k: x for k, x in fields.items() if parse_type(x['type']) != ('name', s['flatten'])}
                f = self.structs[s['flatten']]
                for k, x in f['fields'].items():
                    fields.setdefault(k, x)
                ignore |= set(f['ignore'])
            for fname, fd in fields.items():
                ft = parse_type(fd['type'])
                if fname not in v:
                    if ft[0] != 'opt':
                        self.errors.append(f'{path}.{fname}: required {name}.{fname} ({fd["type"]}) missing')
                    continue
                self.check(v[fname], ft, f'{path}.{fname}')
            for k in v:
                if k not in fields and k not in ignore:
                    self.unmodelled[(name, k)] = self.unmodelled.get((name, k), 0) + 1
        else:
            self.errors.append(f'{path}: unknown Swift type {name}')


def fmt(t):
    if t[0] == 'opt':
        return fmt(t[1]) + '?'
    if t[0] == 'array':
        return '[' + fmt(t[1]) + ']'
    if t[0] == 'dict':
        return '[String: ' + fmt(t[1]) + ']'
    return t[1]


def jtype(v):
    return {dict: 'object', list: 'array', str: 'string', bool: 'bool', int: 'number', float: 'number'}.get(type(v), 'null')


def referenced_names(t):
    if t[0] in ('opt', 'array', 'dict'):
        return referenced_names(t[1])
    return [t[1]]


def main() -> int:
    strict = '--strict' in sys.argv
    quiet = '--quiet' in sys.argv
    structs, enums = parse_models()
    known = PRIMITIVES | set(structs) | set(enums)
    c = Checker(structs, enums)

    # 0. every field type resolves
    for sname, s in structs.items():
        for fname, fd in s['fields'].items():
            for n in referenced_names(parse_type(fd['type'])):
                if n not in known:
                    c.errors.append(f'model {sname}.{fname}: type {n} is not declared in Models/')
        if s['flatten'] and s['flatten'] not in structs:
            c.errors.append(f'model {sname}: fixture-flatten target {s["flatten"]} not found')

    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump({
            '_comment': 'Generated by scripts/check_fixtures.py from CadenceKit/Sources/CadenceKit/Models. Do not edit.',
            'structs': {k: {kk: vv for kk, vv in v.items() if kk != 'file'} | {'file': v['file']} for k, v in sorted(structs.items())},
            'enums': {k: v for k, v in sorted(enums.items())},
        }, f, indent=1, sort_keys=False)
        f.write('\n')

    # 1. fixtures
    index = json.load(open(os.path.join(FIXTURES, 'index.json'), encoding='utf-8'))
    index.pop('_comment', None)
    on_disk = {fn for fn in os.listdir(FIXTURES) if fn.endswith('.json') and fn != 'index.json'}
    checked = 0
    for fn, tname in sorted(index.items()):
        if fn not in on_disk:
            c.warnings.append(f'{fn}: listed in index.json but not captured yet')
            continue
        t = parse_type(tname)
        for n in referenced_names(t):
            if n not in known:
                c.errors.append(f'index.json: {fn} → unknown type {n}')
                break
        else:
            c.check(json.load(open(os.path.join(FIXTURES, fn), encoding='utf-8')), t, fn)
            checked += 1
    for fn in sorted(on_disk - set(index)):
        c.warnings.append(f'{fn}: fixture not listed in index.json (not checked)')

    # 2. the XCTest decoder table covers every root type
    if os.path.exists(TESTS):
        src = open(TESTS, encoding='utf-8').read()
        for tname in sorted(set(index.values())):
            if f'"{tname}"' not in src:
                c.errors.append(f'FixtureDecodingTests.swift has no decoder for "{tname}"')
    else:
        c.warnings.append('FixtureDecodingTests.swift not found')

    for (sname, k), n in sorted(c.unmodelled.items()):
        c.warnings.append(f'unmodelled key {sname}.{k} (seen {n}×) — add it to the struct or to `fixture-ignore:`')
    for (ename, v), n in sorted(c.enum_unknown.items()):
        c.warnings.append(f'unknown {ename} value "{v}" (seen {n}×) — decodes as .unknown')

    nfields = sum(len(s['fields']) for s in structs.values())
    print(f'models: {len(structs)} structs ({nfields} fields), {len(enums)} enums → {os.path.relpath(MANIFEST)}')
    print(f'fixtures: {checked} checked against their Swift root types')
    if not quiet:
        for w in c.warnings:
            print('warning: ' + w)
    for e in c.errors[:200]:
        print('ERROR: ' + e)
    if len(c.errors) > 200:
        print(f'… {len(c.errors) - 200} more errors')
    print(f'{len(c.errors)} error(s), {len(c.warnings)} warning(s)')
    return 1 if c.errors or (strict and c.warnings) else 0


if __name__ == '__main__':
    sys.exit(main())
