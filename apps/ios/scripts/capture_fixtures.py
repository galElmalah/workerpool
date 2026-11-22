#!/usr/bin/env python3
"""Capture real API responses as trimmed JSON fixtures for CadenceKit's decoding tests.

    python3 apps/ios/scripts/capture_fixtures.py --base http://localhost:5240 --passphrase cadence-demo
    python3 apps/ios/scripts/capture_fixtures.py --base http://localhost:5241 --passphrase cadence-demo --writes

Auth: tries the device-token flow first (POST /api/auth/devices, docs/MOBILE_API.md); when the server
does not have it yet (404) it falls back to the cookie login. The device token it creates is revoked
at the end (DELETE /api/auth/devices/current).

`--writes` also captures responses of mutating endpoints (quick add, patch, skip, notes, wellness,
settings, Garmin sync/push ...). Only use it against a throwaway copy of the database.

Trimming keeps fixtures small but representative: arrays of objects keep the items that together
cover the most distinct keys (max 6), arrays of scalars keep their first 12 values. The fixture ->
Swift type map lives in Fixtures/index.json and is checked by scripts/check_fixtures.py.
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, '..', 'CadenceKit', 'Tests', 'CadenceKitTests', 'Fixtures')

MAX_OBJECTS = 6
MAX_SCALARS = 12
# Arrays kept whole: their length is part of the contract (or widgets need the full series).
KEEP_ALWAYS = {'dailyLoad', 'weekStrip', 'fitnessSeries', 'recentWeeks'}
KEEP_IF_WEEK = {'days'}  # Mon–Sun lists (7 entries); longer `days` series are trimmed


def trim(v, key=None):
    if isinstance(v, dict):
        return {k: trim(x, k) for k, x in v.items()}
    if isinstance(v, list):
        if not v:
            return v
        if key in KEEP_ALWAYS or (key in KEEP_IF_WEEK and len(v) <= 7):
            return [trim(x) for x in v]
        if all(isinstance(x, dict) for x in v):
            chosen, seen = [], set()
            # greedy: items that add the most new keys (one level deep) first, in original order on ties
            rest = list(enumerate(v))
            while rest and len(chosen) < MAX_OBJECTS:
                def gain(item):
                    return len(set(flat_keys(item[1])) - seen)
                best = max(rest, key=lambda it: (gain(it), -it[0]))
                if chosen and gain(best) == 0 and len(chosen) >= 2:
                    break
                chosen.append(best)
                seen |= set(flat_keys(best[1]))
                rest.remove(best)
            chosen.sort(key=lambda it: it[0])
            return [trim(x) for _, x in chosen]
        return [trim(x) for x in v[:MAX_SCALARS]]
    return v


def flat_keys(d, prefix=''):
    out = []
    if isinstance(d, dict):
        for k, x in d.items():
            out.append(prefix + k)
            if isinstance(x, dict):
                out.extend(flat_keys(x, prefix + k + '.'))
            elif isinstance(x, list) and x and isinstance(x[0], dict):
                for item in x[:20]:
                    out.extend(flat_keys(item, prefix + k + '[].'))
    return out


class Client:
    def __init__(self, base: str):
        self.base = base.rstrip('/')
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.token: str | None = None

    def call(self, method: str, path: str, body=None, auth=True):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header('Accept', 'application/json')
        req.add_header('X-Cadence-Client', 'ios/fixture-capture')
        if data is not None:
            req.add_header('Content-Type', 'application/json')
        if auth and self.token:
            req.add_header('Authorization', 'Bearer ' + self.token)
        opener = self.opener if auth else urllib.request.build_opener()
        try:
            with opener.open(req, timeout=60) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw) if raw else None
            except ValueError:
                return e.code, {'raw': raw.decode(errors='replace')[:200]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default=os.environ.get('CADENCE_BASE_URL', 'http://localhost:5240'))
    ap.add_argument('--passphrase', default=os.environ.get('CADENCE_PASSPHRASE', 'cadence-demo'))
    ap.add_argument('--out', default=DEFAULT_OUT)
    ap.add_argument('--writes', action='store_true', help='also capture mutating endpoints (throwaway DB only)')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    c = Client(a.base)
    saved: list[str] = []
    missing: list[str] = []

    def save(name: str, status_body, expect=(200, 201)):
        status, body = status_body
        if status not in expect:
            print(f'  ! {name}: HTTP {status} {json.dumps(body)[:160]}', file=sys.stderr)
            missing.append(name)
            return None
        with open(os.path.join(a.out, name + '.json'), 'w', encoding='utf-8') as f:
            json.dump(trim(body), f, indent=1, ensure_ascii=False)
            f.write('\n')
        saved.append(name)
        return body

    # ── auth ──
    save('error_unauthorized', c.call('GET', '/api/today', auth=False), expect=(401,))
    status, body = c.call('POST', '/api/auth/devices', {'passphrase': a.passphrase, 'name': 'Fixture capture', 'platform': 'ios'})
    if status == 201:
        c.token = body['token']
        body = dict(body, token='cad_' + 'x' * 43)  # never commit a live token
        save('device_create', (201, body))
        save('devices_list', c.call('GET', '/api/auth/devices'))
    else:
        print(f'  device tokens not available (HTTP {status}); using the cookie login', file=sys.stderr)
        missing.append('device_create')
        st, b = c.call('POST', '/api/auth/login', {'passphrase': a.passphrase})
        if st != 200:
            print(f'login failed: {st} {b}', file=sys.stderr)
            return 1
    save('auth_status', c.call('GET', '/api/auth/status'))

    # ── read endpoints ──
    snap = save('snapshot', c.call('GET', '/api/mobile/snapshot'))
    today = save('today', c.call('GET', '/api/today'))
    day = (today or {}).get('date') or (snap or {}).get('today') or '2026-11-21'
    y, m, d = (int(x) for x in day.split('-'))
    import datetime as dt
    t = dt.date(y, m, d)
    iso = lambda x: x.isoformat()
    monday = t - dt.timedelta(days=t.weekday())
    week = f'{t.isocalendar()[0]}-W{t.isocalendar()[1]:02d}'
    prev_week_day = t - dt.timedelta(days=7)
    prev_week = f'{prev_week_day.isocalendar()[0]}-W{prev_week_day.isocalendar()[1]:02d}'

    cal = save('calendar', c.call('GET', f'/api/calendar?from={iso(monday - dt.timedelta(days=7))}&to={iso(monday + dt.timedelta(days=13))}'))
    workouts = save('workouts_list', c.call('GET', f'/api/workouts?from={iso(monday)}&to={iso(monday + dt.timedelta(days=6))}'))
    structured = next((w for w in (cal or {}).get('workouts', []) if w.get('structure') and w.get('sport') == 'bike'), None)
    if structured:
        save('workout_structured', c.call('GET', f"/api/workouts/{structured['id']}"))
    swim = next((w for w in (cal or {}).get('workouts', []) if w.get('structure') and w.get('sport') == 'swim'), None)
    if swim:
        save('workout_swim', c.call('GET', f"/api/workouts/{swim['id']}"))
    strength = next((w for w in (cal or {}).get('workouts', []) if w.get('structure') and w.get('sport') == 'strength'), None)
    if strength:
        save('workout_strength', c.call('GET', f"/api/workouts/{strength['id']}"))

    acts = save('activities_list', c.call('GET', f'/api/activities?limit=40&from={iso(t - dt.timedelta(days=60))}'))
    by_sport, candidates = {}, {}
    for act in (acts or {}).get('items', []):
        by_sport.setdefault(act['sport'], act['id'])
        candidates.setdefault(act['sport'], []).append(act['id'])
    for sport in ('bike', 'run', 'swim', 'strength', 'row'):
        if sport not in by_sport:
            continue
        # the richest of the first few of each sport (facts, swim lengths, location, laps …), so the
        # fixtures exercise every optional field the server can send
        best, best_score = None, -1
        for aid in candidates[sport][:8]:
            st, body = c.call('GET', f'/api/activities/{aid}')
            if st != 200 or not isinstance(body, dict):
                continue
            # outdoor (located) sessions and pool swims (lengths) first, then the most distinct keys
            score = len(set(flat_keys(body))) + 100 * bool(body.get('locationName')) + 100 * bool(body.get('swimLengths'))
            if score > best_score:
                best, best_score = aid, score
        by_sport[sport] = best or by_sport[sport]
        save(f'activity_{sport}', c.call('GET', f'/api/activities/{by_sport[sport]}'))
    if 'bike' in by_sport:
        save('activity_streams', c.call('GET', f"/api/activities/{by_sport['bike']}/streams?maxPoints=40"))

    save('trends_fitness', c.call('GET', f'/api/trends/fitness?from={iso(t - dt.timedelta(days=13))}&to={iso(t + dt.timedelta(days=7))}'))
    save('trends_weekly', c.call('GET', '/api/trends/weekly?weeks=4'))
    save('trends_intensity', c.call('GET', '/api/trends/intensity?weeks=4'))
    save('trends_peaks_bike', c.call('GET', '/api/trends/peaks?sport=bike&ranges=42d,season'))
    save('trends_peaks_run', c.call('GET', '/api/trends/peaks?sport=run&ranges=42d,season'))
    save('trends_wellness', c.call('GET', f'/api/trends/wellness?from={iso(t - dt.timedelta(days=6))}&to={day}'))
    save('trends_consistency', c.call('GET', '/api/trends/consistency?days=14'))
    save('week_review', c.call('GET', f'/api/weeks/{prev_week}'))
    save('journal', c.call('GET', '/api/journal?limit=12'))
    save('events', c.call('GET', '/api/events'))
    save('phases', c.call('GET', '/api/phases'))
    save('day_note_empty', c.call('GET', f'/api/day-notes/{iso(t + dt.timedelta(days=40))}'))
    save('week_note', c.call('GET', f'/api/week-notes/{week}'))
    save('wellness_day', c.call('GET', f'/api/wellness/{day}'))
    save('settings', c.call('GET', '/api/settings'))
    save('garmin_status', c.call('GET', '/api/garmin/status'))
    save('sync_log', c.call('GET', '/api/sync/log?limit=5'))
    save('search_text', c.call('GET', '/api/search?q=ride'))
    save('search_jump', c.call('GET', '/api/search?q=tomorrow'))
    save('error_not_found', c.call('GET', '/api/workouts/wk_does_not_exist'), expect=(404,))

    # ── writes (throwaway DB only) ──
    if a.writes:
        future = iso(t + dt.timedelta(days=30))
        q = save('workout_quick', c.call('POST', '/api/workouts/quick', {'date': future, 'text': 'run 45m easy'}), expect=(201,))
        wid = (q or {}).get('workout', {}).get('id')
        if wid:
            save('workout_patch', c.call('PATCH', f'/api/workouts/{wid}', {'isKey': True, 'preNote': 'Fixture note', 'date': iso(t + dt.timedelta(days=31))}))
            save('workout_duplicate', c.call('POST', f'/api/workouts/{wid}/duplicate', {'date': iso(t + dt.timedelta(days=32))}), expect=(201,))
            save('workout_skip', c.call('POST', f'/api/workouts/{wid}/skip', {'reason': 'travel'}))
            save('workout_delete', c.call('DELETE', f'/api/workouts/{wid}'))
        created = save('workout_create', c.call('POST', '/api/workouts', {'date': future, 'sport': 'bike', 'title': 'Fixture ride', 'plannedDurationSec': 3600}), expect=(201,))
        if created and by_sport.get('bike'):
            pass
        if by_sport.get('run'):
            save('activity_patch', c.call('PATCH', f"/api/activities/{by_sport['run']}", {'rpe': 6, 'feel': 4, 'postNote': 'Felt smooth'}))
        save('day_note_put', c.call('PUT', f'/api/day-notes/{day}', {'body': 'Fixture day note'}))
        save('wellness_put', c.call('PUT', f'/api/wellness/{day}', {'feel': 4, 'soreness': 2}))
        save('settings_patch', c.call('PATCH', '/api/settings', {'accent': 'blue'}))
        save('garmin_sync', c.call('POST', '/api/garmin/sync'), expect=(200,))
        if created:
            save('garmin_push', c.call('POST', f"/api/garmin/push/{created['id']}"))
            c.call('DELETE', f"/api/workouts/{created['id']}")

    if c.token:
        st, _ = c.call('DELETE', '/api/auth/devices/current')
        print(f'  revoked capture device token: HTTP {st}', file=sys.stderr)

    print(f'saved {len(saved)} fixtures to {os.path.relpath(a.out)}')
    if missing:
        print('not captured: ' + ', '.join(missing))
    return 0


if __name__ == '__main__':
    sys.exit(main())
