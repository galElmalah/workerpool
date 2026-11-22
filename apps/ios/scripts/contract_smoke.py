#!/usr/bin/env python3
"""Replay IntegrationTests.swift's request sequence with Python, for machines without Swift.

    python3 apps/ios/scripts/contract_smoke.py --base http://localhost:5241 --passphrase cadence-demo

Same paths, query strings and JSON bodies the Swift `Endpoints` build (bodies use sorted keys and
omit nil fields, like JSONCoding.encode). Request bodies that echo server objects back (undo via
POST /api/calendar/restore) are first projected onto the Swift model's declared fields
(CadenceKit/models.manifest.json), which is exactly what a decode → encode round trip in Swift sends.
Every response is checked against its Swift root type with check_fixtures.Checker.

It performs the suite's reversible writes (day note set/clear, workout create → move → key → skip →
unskip → delete → restore → delete, quick add + delete, activity RPE set/restore, wellness check-in
re-write) — use a dev/demo server.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_fixtures as cf  # noqa: E402

STRUCTS, ENUMS = cf.parse_models()


def project(value, type_name):
    """What Swift would re-encode after decoding `value` as `type_name` (drops unmodelled keys)."""
    t = cf.parse_type(type_name)
    return _project(value, t)


def _project(v, t):
    if v is None:
        return None
    if t[0] == 'opt':
        return _project(v, t[1])
    if t[0] == 'array':
        return [_project(x, t[1]) for x in v]
    if t[0] == 'dict':
        return {k: _project(x, t[1]) for k, x in v.items()}
    name = t[1]
    if name in STRUCTS:
        s = STRUCTS[name]
        out = {}
        fields = dict(s['fields'])
        if s['flatten']:
            fields.update(STRUCTS[s['flatten']]['fields'])
        for k, fd in fields.items():
            if k in v and v[k] is not None:
                out[k] = _project(v[k], cf.parse_type(fd['type']))
        return out
    return v


class Client:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.token = None
        self.calls = 0
        self.failures: list[str] = []

    def req(self, method, path, body=None, expect_type=None, expect_status=(200, 201, 204)):
        self.calls += 1
        data = None if body is None else json.dumps(body, sort_keys=True, separators=(',', ':')).encode()
        r = urllib.request.Request(self.base + path, data=data, method=method)
        r.add_header('Accept', 'application/json')
        r.add_header('X-Cadence-Client', 'ios/contract-smoke')
        if data is not None:
            r.add_header('Content-Type', 'application/json')
        if self.token:
            r.add_header('Authorization', 'Bearer ' + self.token)
        try:
            with urllib.request.urlopen(r, timeout=60) as res:
                status, raw = res.status, res.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        parsed = json.loads(raw) if raw else None
        label = f'{method} {path}'
        if status not in expect_status:
            self.failures.append(f'{label}: HTTP {status} {raw[:200]!r}')
            return status, parsed
        if expect_type and status != 204:
            ch = cf.Checker(STRUCTS, ENUMS)
            ch.check(parsed, cf.parse_type(expect_type), label)
            self.failures.extend(ch.errors)
        print(f'  {status} {label}')
        return status, parsed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default=os.environ.get('CADENCE_BASE_URL', 'http://localhost:5240'))
    ap.add_argument('--passphrase', default=os.environ.get('CADENCE_PASSPHRASE', 'cadence-demo'))
    a = ap.parse_args()
    c = Client(a.base)

    st, dev = c.req('POST', '/api/auth/devices', {'name': 'CadenceKit tests', 'passphrase': a.passphrase, 'platform': 'ios'}, 'DeviceTokenResponse')
    if st != 201:
        print('\n'.join(c.failures))
        return 1
    c.token = dev['token']
    try:
        # ── testReadEndpoints ──
        _, status = c.req('GET', '/api/auth/status', None, 'AuthStatus')
        if not (status or {}).get('authenticated'):
            c.failures.append('auth/status: bearer token not authenticated')
        _, devs = c.req('GET', '/api/auth/devices', None, 'DeviceList')
        if not any(d['name'] == 'CadenceKit tests' for d in (devs or {}).get('devices', [])):
            c.failures.append('devices: own device missing')
        _, snap = c.req('GET', '/api/mobile/snapshot', None, 'MobileSnapshot')
        _, today = c.req('GET', '/api/today', None, 'TodayResponse')
        day = dt.date.fromisoformat(snap['today'])
        iso = lambda d: d.isoformat()
        week = lambda d: f'{d.isocalendar()[0]}-W{d.isocalendar()[1]:02d}'
        mon = day - dt.timedelta(days=day.weekday())
        _, cal = c.req('GET', f'/api/calendar?from={iso(mon - dt.timedelta(days=7))}&to={iso(mon + dt.timedelta(days=6))}', None, 'CalendarResponse')
        if len(cal['weeks']) != 2:
            c.failures.append(f'calendar: expected 2 weeks, got {len(cal["weeks"])}')
        c.req('GET', f'/api/workouts?from={iso(mon)}&to={iso(mon + dt.timedelta(days=6))}', None, '[PlannedWorkout]')
        if cal['workouts']:
            c.req('GET', f"/api/workouts/{cal['workouts'][0]['id']}", None, 'PlannedWorkout')
        _, page = c.req('GET', '/api/activities?limit=5', None, 'ActivityPage')
        if page['items']:
            act = page['items'][0]
            c.req('GET', f"/api/activities/{act['id']}", None, 'ActivityDetail')
            if act['hasStreams']:
                _, s = c.req('GET', f"/api/activities/{act['id']}/streams?maxPoints=100", None, 'ActivityStreams')
                if len(s['t']) > 100:
                    c.failures.append('streams: maxPoints ignored')
        c.req('GET', f'/api/trends/fitness?from={iso(day - dt.timedelta(days=30))}&to={iso(day + dt.timedelta(days=14))}', None, 'FitnessTrend')
        c.req('GET', '/api/trends/weekly?weeks=4', None, '[WeekSummary]')
        c.req('GET', '/api/trends/intensity?weeks=4', None, 'IntensityTrend')
        c.req('GET', '/api/trends/peaks?sport=bike&ranges=42d,season', None, 'PeaksTrend')
        c.req('GET', '/api/trends/peaks?sport=run&ranges=42d', None, 'PeaksTrend')
        c.req('GET', f'/api/trends/wellness?from={iso(day - dt.timedelta(days=6))}&to={iso(day)}', None, 'WellnessTrend')
        c.req('GET', '/api/trends/consistency?days=30', None, 'ConsistencyTrend')
        c.req('GET', f'/api/weeks/{week(day - dt.timedelta(days=7))}', None, 'WeekReview')
        c.req('GET', '/api/journal?limit=10', None, 'JournalPage')
        c.req('GET', f'/api/day-notes/{iso(day)}', None, 'DayNote?')
        c.req('GET', f'/api/week-notes/{week(day)}', None, 'WeekNote?')
        c.req('GET', f'/api/wellness/{iso(day)}', None, 'WellnessDay')
        c.req('GET', '/api/events', None, '[Event]')
        c.req('GET', '/api/phases', None, '[Phase]')
        c.req('GET', '/api/settings', None, 'AthleteSettings')
        c.req('GET', '/api/garmin/status', None, 'GarminStatus')
        c.req('GET', '/api/sync/log?limit=5', None, 'SyncLogPage')
        c.req('GET', '/api/search?q=ride', None, 'SearchResponse')
        c.req('GET', '/api/search?q=tomorrow', None, 'SearchResponse')

        # ── testReversibleWrites ──
        future = iso(day + dt.timedelta(days=60))
        _, before = c.req('GET', f'/api/day-notes/{future}', None, 'DayNote?')
        _, note = c.req('PUT', f'/api/day-notes/{future}', {'body': 'CadenceKit integration test'}, 'DayNote?')
        if (note or {}).get('body') != 'CadenceKit integration test':
            c.failures.append('day note not saved')
        c.req('PUT', f'/api/day-notes/{future}', {'body': (before or {}).get('body', '')}, 'DayNote?')

        _, w = c.req('POST', '/api/workouts', {'date': future, 'plannedDurationSec': 2700, 'sport': 'run', 'title': 'CadenceKit test run'}, 'PlannedWorkout')
        wid = w['id']
        _, moved = c.req('PATCH', f'/api/workouts/{wid}', {'date': iso(day + dt.timedelta(days=61))}, 'PlannedWorkout')
        if moved['date'] != iso(day + dt.timedelta(days=61)):
            c.failures.append('move did not change the date')
        _, keyed = c.req('PATCH', f'/api/workouts/{wid}', {'isKey': True}, 'PlannedWorkout')
        _, noted = c.req('PATCH', f'/api/workouts/{wid}', {'preNote': None}, 'PlannedWorkout')
        _, skipped = c.req('POST', f'/api/workouts/{wid}/skip', {'reason': 'travel'}, 'PlannedWorkout')
        if skipped['status'] != 'skipped':
            c.failures.append('skip failed')
        _, unskipped = c.req('DELETE', f'/api/workouts/{wid}/skip', None, 'PlannedWorkout')
        _, deleted = c.req('DELETE', f'/api/workouts/{wid}', None, 'DeletedWorkouts')
        restore_body = {'workouts': [project(x, 'PlannedWorkout') for x in deleted['deleted']]}
        _, restored = c.req('POST', '/api/calendar/restore', restore_body, 'RestoredWorkouts')
        if not restored or restored['restored'][0]['id'] != wid:
            c.failures.append('restore did not bring the workout back')
        c.req('DELETE', f'/api/workouts/{wid}', None, 'DeletedWorkouts')
        _, quick = c.req('POST', '/api/workouts/quick', {'date': future, 'text': 'bike 60m endurance'}, 'QuickAddResponse')
        c.req('DELETE', f"/api/workouts/{quick['workout']['id']}", None, 'DeletedWorkouts')
        c.req('POST', f'/api/workouts/{quick["workout"]["id"]}/duplicate', {'date': future}, expect_status=(404,))

        if page['items']:
            act = page['items'][0]
            _, upd = c.req('PATCH', f"/api/activities/{act['id']}", {'rpe': 7}, 'Activity')
            if upd.get('rpe') != 7:
                c.failures.append('rpe not saved')
            c.req('PATCH', f"/api/activities/{act['id']}", {'rpe': act.get('rpe')}, 'Activity')
            c.req('PATCH', f"/api/activities/{act['id']}", {'feel': act.get('feel'), 'postNote': act.get('postNote')}, 'Activity')

        _, wd = c.req('GET', f'/api/wellness/{iso(day)}', None, 'WellnessDay')
        _, checked = c.req('PUT', f'/api/wellness/{iso(day)}', {'feel': wd.get('feel'), 'soreness': wd.get('soreness')}, 'WellnessDay')
        if checked.get('feel') != wd.get('feel'):
            c.failures.append('check-in changed feel')

        # ── errors ──
        c.req('GET', '/api/workouts/wk_does_not_exist', None, 'APIErrorEnvelope', expect_status=(404,))
    finally:
        # ── testRevokedTokenIsUnauthorized ──
        c.req('DELETE', '/api/auth/devices/current', expect_status=(204,))
        st, body = c.req('GET', '/api/mobile/snapshot', None, 'APIErrorEnvelope', expect_status=(401,))
        if (body or {}).get('error', {}).get('code') != 'unauthorized':
            c.failures.append(f'revoked token: expected code unauthorized, got {body}')

    print(f'\n{c.calls} requests, {len(c.failures)} failure(s)')
    for f in c.failures:
        print('FAIL: ' + f)
    return 1 if c.failures else 0


if __name__ == '__main__':
    sys.exit(main())
