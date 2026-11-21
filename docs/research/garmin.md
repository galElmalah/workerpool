# Garmin integration reference (Cloudflare Workers, single user)

Status: research reference, written 2026-11-21. It is intended to be sufficient for implementing a
TypeScript Garmin client on Cloudflare Workers (D1, cron triggers) without further research.

Conventions used in this document:

- **VERIFIED (code)**: read directly in library source code or recorded HTTP fixtures (cassettes).
- **VERIFIED (docs)**: stated in a library's maintained docs / changelog as tested against a live account.
- **UNVERIFIED**: from memory, secondary sources, or inference. The implementation must treat it as a
  hypothesis: log the real response the first time and adapt.

Primary sources read (all downloaded and read as source, never executed):

| Source | Version / date | What it gave us |
|---|---|---|
| `garminconnect` (python-garminconnect, PyPI) | 0.3.20, 2026-10-23 | Current login flow (DI OAuth2), headers, 348 endpoint methods, workout schema/enums, `docs/API_ENDPOINTS.md` (web-app endpoint audit, Oct 2026) |
| `garth` (PyPI + GitHub repo incl. test cassettes) | 0.8.0 (final, **deprecated** Mar 2026) | Legacy OAuth1/OAuth2 flow, real recorded responses (activity list/get, HRV, sleep, readiness, token exchange) |
| `garmin/connect-personal-api-python` (Garmin's own, GitHub) | 1.1.0, 2026-11-20 | **Official Personal API**: host, token exchange, endpoint list |
| npm `garmin-connect` | 1.6.2 (Jan 2024, stale) | Legacy garth-style flow in TS |
| npm `@gooin/garmin-connect` | 1.8.8 (Sep 2026, obfuscated build) | Still uses legacy garth OAuth1 (`thegarth` S3 consumer, `preauthorized`, `exchange/user/2.0`); full `IActivity` TS type with sport-specific field names |
| `mkuthan/garmin-workouts`, `harrybrwn/go-garmin` | 2026 | Workout power target encoding; details payload struct |
| GitHub issues: garth #217, discussion #222; python-garminconnect #369, #370, #400, #433, #444, #476 | Mar–Oct 2026 | Breakages, blocking behaviour, workout enum fixes, send-to-device, Personal API |

---

## 0. TL;DR / decisions for the architecture

1. **An official personal-developer option now exists (Oct 21 2026): the Garmin Connect "Personal API".**
   Free, no approval, for your own account. You create an API key in Garmin Connect
   (`https://connect.garmin.com/app/settings/personalApiToken`), exchange it for a 24 h bearer JWT, and call
   `https://personal.connectapi.garmin.com/...` with the *same paths and JSON shapes* as the private API.
   It is **read-only** (GET only, ~26 endpoints) but covers what matters most for sync: activity search,
   activity summary, **original FIT download**, activity→workout link, sleep, HRV, body battery, daily
   summaries, stress, steps, VO2max, HR zones, weight, profile settings.
   It does **not** cover: workout create/schedule (no write scope), calendar, training status/readiness/load,
   lactate threshold, FTP, power zones, activity details JSON/splits endpoints.
2. **Writes (structured workouts → Garmin calendar/watch) still require the unofficial API**, authenticated
   with a "DI" OAuth2 bearer token from `diauth.garmin.com`. Garmin's official Training API (which pushes
   workouts) is Business/Enterprise only.
3. **Recommended auth design (hybrid):**
   - **Reads: Official Personal API** (API key stored as an encrypted secret; Worker exchanges it for a bearer
     daily). This is stable, ToS-sanctioned, and not exposed to SSO bot-blocking.
   - **Writes + extra physiology: unofficial DI token, bootstrapped by a "paste token" flow.** The user runs
     `python-garminconnect` once on their own computer (residential IP, real TLS fingerprint via `curl_cffi`),
     which writes `garmin_tokens.json` `{di_token, di_refresh_token, di_client_id}`; they paste it into the
     platform. The Worker then refreshes the token itself (`POST diauth.garmin.com/.../oauth/token`,
     `grant_type=refresh_token`).
   - **In-Worker username/password login: implement only as an experimental, feature-flagged path.** It is
     very likely to be blocked (see 2.4). Do not make the MVP depend on it.
4. **No webhooks** on either personal path → poll. Use a cheap change detector where available, a rolling
   re-fetch window for edits/deletes, and Queues/Workflows for history backfill.
5. **Prefer the original FIT file over `/details` JSON** for time-series, laps, swim lengths and strength
   sets. Store raw FIT in **R2** (consider adding R2 to the stack; D1 rows are limited to ~2 MB and are a poor
   place for blobs — UNVERIFIED exact D1 limit, check docs).
6. **Main architecture risk:** Garmin may block Cloudflare-Worker egress for the *unofficial* API (Workers
   subrequests to Cloudflare-fronted hosts carry a `CF-Worker` header and Cloudflare egress IPs; users already
   report unofficial-token calls failing from datacenter IPs such as GitHub Actions while working from home).
   Mitigation: keep reads on the official API; design the write path so a tiny "home bridge" (the same local
   helper, run via cron or behind a Cloudflare Tunnel) can execute Garmin write calls if Workers egress is
   refused. Build the Garmin client behind an interface so the transport can be swapped.

---

## 1. Landscape (Nov 2026)

| Path | Who | Auth | Read | Write workouts | Status |
|---|---|---|---|---|---|
| **Garmin Connect Personal API** | any Garmin user, own data only, non-commercial | API key → 24 h bearer JWT, no refresh token | ~26 GET endpoints incl. FIT download | **No** | Official since 2026-10-21 |
| Garmin Connect Developer Program "Business Starter" | companies; free; app review | OAuth2 PKCE per user (24 h access, ~90 d refresh, rotating) | Push-only webhooks, no backfill | Training API (Business only) | Official; not aimed at a solo self-hosted app (UNVERIFIED whether solo devs get approved) |
| Business Enterprise | companies | same | ping/pull + backfill | Training API | $1000 onboarding + per-user fees (from 2027) |
| **Unofficial private API** (what the Connect web/mobile apps use) | anyone | SSO login → service ticket → DI OAuth2 bearer | everything (300+ endpoints) | **Yes** | Works but fragile; garth deprecated Mar 2026; python-garminconnect 0.3.x maintained |

Facts on the Personal API (VERIFIED (code) from Garmin's official package unless noted):
- Base URL `https://personal.connectapi.garmin.com` (overridable via `GARMIN_PERSONAL_API_BASE_URL` in their client).
- Token exchange: `POST /personalapitoken-service/personal-api/personal-api-key/token`, headers
  `Authorization: ApiKey <key>`, `Accept: */*`, empty body. **Response body is the raw JWT text** (not JSON).
  Expiry = JWT `exp` claim. Their client re-exchanges when < 1 h remains.
- Data calls: `Authorization: Bearer <jwt>`, `Accept: application/json` (FIT: `Accept: application/zip, application/x-zip-compressed, application/octet-stream`).
- Key lifetime: user picks 30/90/180/365 days; shown once; cannot be renewed from code (secondary sources —
  UNVERIFIED but consistent across 3 sources). Access token lifetime 24 h, no refresh token (secondary sources).
- Rate limits: not published; Garmin reserves the right to throttle. Treat as "modest polling only".
- Terms: key is "personal to you and may be used only by you"; "not intended for commercial applications
  serving multiple end users" (quoted via third-party summaries — UNVERIFIED wording). A single-user
  self-hosted platform fits.
- `developer.garmin.com` could not be fetched from this environment; the Swagger docs at
  `https://developer.garmin.com/gc-developer-program/personal/swagger-docs/` should be checked by a human for
  the exact endpoint list and response schemas.

Personal API endpoints (all GET, VERIFIED (code) paths from the official client):

| Purpose | Path | Params |
|---|---|---|
| Activity search | `/activitylist-service/activities/search/activities` | `start`, `limit`, `startDate`, `endDate` (YYYY-MM-DD), `activityType`, `activitySubType` |
| Activity summary | `/activity-service/activity/{activityId}` | |
| Workouts linked to an activity | `/activity-service/activity/{activityId}/workouts` | |
| Original file (ZIP containing FIT) | `/download-service/files/activity/{activityId}` | |
| Activity types | `/activity-service/activity/activityTypes/simple` | (cache 48 h) |
| Daily summaries (range) | `/usersummary-service/v2/dailysummaries` | `startDate`, `endDate` |
| Daily stress / steps / hydration | `/usersummary-service/stats/{stress\|steps\|hydration}/daily/{start}/{end}` | |
| Sleep (day) | `/sleep-service/sleep/dailySleep` | `date` |
| Sleep summaries (range) | `/sleep-service/sleep/dailySleepSummariesByDate` | `startDate`, `endDate` |
| Body battery | `/wellness-service/wellness/bodyBattery/reports/daily` | `startDate`, `endDate`, opt `chunks` |
| Daily heart rate | `/wellness-service/wellness/dailyHeartRate` | `date` |
| HRV (day) / (range) | `/hrv-service/hrv/{date}` / `/hrv-service/hrv/daily/{start}/{end}` | |
| VO2max | `/metrics-service/metrics/maxmet/daily/{start}/{end}` | opt `sport` |
| HR zones | `/biometric-service/heartRateZones/v2` | |
| Fitness age | `/fitnessage-service/fitnessage/v2/{date}` | |
| SpO2 | `/wellness-service/wellness/daily/spo2acclimation/{date}` | |
| Weight | `/weight-service/weight/range/{start}/{end}` | `includeAll=true` |
| Weight goal | `/goal-service/goal/user/effective/weightgoal/{start}/{end}` | |
| Food log | `/nutrition-service/food/logs/{date}` | |
| Profile settings | `/userprofile-service/userprofile/settings` | |
| Health snapshots | `/wellnessactivity-service/activity/summary/range/{start}/{end}` | |
| Menstrual summary / day view | `/periodichealth-service/menstrualcycle/summary/{date}`, `/dayview/{date}?todayDate=` | |

Note the Personal API sleep path (`/sleep-service/sleep/dailySleep`) differs from the unofficial one
(`/sleep-service/sleep/dailySleepData`). Whether the Personal API accepts *other* paths beyond its Swagger
list is UNVERIFIED (assume 403/404).

---

## 2. AUTH

### 2.1 Official Personal API (reads)

```
POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token
Authorization: ApiKey <PERSONAL_API_KEY>
Accept: */*
-> 200 text/plain: eyJhbGciOi...   (JWT; read exp from payload)
```
- Cache `{jwt, exp}` in D1 (encrypted). Re-exchange when `exp - now < 3600 s` or on any 401.
- If the exchange itself returns 401/403 → key expired/revoked → set integration state `personal_key_invalid`
  and notify the user. Track the key's chosen expiry date (ask the user at entry) and warn 14 days before.

### 2.2 Unofficial API: hosts and current flow (python-garminconnect 0.3.20, VERIFIED (code))

Hosts (domain `garmin.com`; China accounts use `garmin.cn` everywhere):
- `https://sso.garmin.com` – login (Cloudflare-fronted, bot-protected)
- `https://diauth.garmin.com/di-oauth2-service/oauth/token` – ticket→token exchange and refresh
- `https://connectapi.garmin.com` – all data/write APIs (Bearer token)
- `https://mobile.integration.garmin.com/gcm/ios` – the iOS "service URL" the ticket is issued for
- `https://connect.garmin.com` – web app (JWT_WEB cookie fallback only)

History: until early 2026 everyone used garth's flow (SSO → `oauth-service/oauth/preauthorized` OAuth1 token
valid ~1 year → `oauth-service/oauth/exchange/user/2.0` OAuth2). On ~2026-03-17 SSO logins started returning
429 via Cloudflare; garth was deprecated on 2026-03-27. python-garminconnect 0.3.0+ dropped garth and now
exchanges the SSO ticket directly for a "DI" OAuth2 token. garth-format tokens cannot be converted.

#### Step 1 – SSO login (strategy "mobile", iOS app web-view flow). This is the preferred strategy.

```
GET https://sso.garmin.com/mobile/sso/en_US/sign-in?clientId=GCM_IOS_DARK&service=https%3A%2F%2Fmobile.integration.garmin.com%2Fgcm%2Fios
User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
Accept-Language: en-US,en;q=0.9
```
- Keep **all** `Set-Cookie` cookies (e.g. `SESSION`, `__cf_bm`, …). The 0.3.20 changelog: posting the
  credentials *without* first loading this page (cookies + Referer) gets 429 even when nothing is rate-limited.
- 429 or the non-standard **427** = blocked; 403 = Cloudflare bot challenge.
- Wait a random **2–5 s** before the POST (library constant `MOBILE_DELAY_*`).

```
POST https://sso.garmin.com/mobile/api/login?clientId=GCM_IOS_DARK&locale=en-US&service=https%3A%2F%2Fmobile.integration.garmin.com%2Fgcm%2Fios
User-Agent: <same iOS UA>
Accept: application/json, text/plain, */*
Accept-Language: en-US,en;q=0.9
Content-Type: application/json
Origin: https://sso.garmin.com
Referer: https://sso.garmin.com/mobile/sso/en_US/sign-in?clientId=GCM_IOS_DARK&service=https%3A%2F%2Fmobile.integration.garmin.com%2Fgcm%2Fios
Cookie: <cookies from the GET>

{"username":"<email>","password":"<password>","rememberMe":true,"captchaToken":""}
```
Responses (`responseStatus.type`), VERIFIED (code + cassettes):
- `SUCCESSFUL` → `{"serviceTicketId":"ST-0172640-s7YM...-sso","responseStatus":{"type":"SUCCESSFUL",...},"customerMfaInfo":null}`
- `MFA_REQUIRED` → `{"serviceTicketId":null,"responseStatus":{"type":"MFA_REQUIRED"},"customerMfaInfo":{"mfaLastMethodUsed":"email",...}}`
- `INVALID_USERNAME_PASSWORD` → stop, do not retry.
- `CAPTCHA_REQUIRED` → bot challenge; give up on this path.
- Body `{"error":{"status-code":"429"}}` → rate limited.

#### Step 1b – MFA

```
POST https://sso.garmin.com/mobile/api/mfa/verifyCode?clientId=GCM_IOS_DARK&locale=en-US&service=https%3A%2F%2Fmobile.integration.garmin.com%2Fgcm%2Fios
(same headers + same cookie jar as the login POST)
{"mfaMethod":"<customerMfaInfo.mfaLastMethodUsed, e.g. email>","mfaVerificationCode":"123456","rememberMyBrowser":true,"reconsentList":[],"mfaSetup":false}
-> {"serviceTicketId":"ST-...","responseStatus":{"type":"SUCCESSFUL"}}
```
- The library falls back to `https://sso.garmin.com/portal/api/mfa/verifyCode?clientId=GarminConnect&locale=en-US&service=https%3A%2F%2Fconnect.garmin.com%2Fapp` (same cookies) because the two are in different rate-limit buckets.
- Between the login POST and the code entry the **cookie jar must be persisted** (D1, encrypted, short TTL) —
  the user types the code in a later HTTP request. The code arrives by email/SMS/TOTP; for email/SMS the
  code is normally sent during the login POST (the widget flow sometimes needs an explicit request, see below).
- A wrong code leaves the SSO session valid for a retry (library issue #416 fix).

#### Step 2 – exchange the service ticket for a DI token

```
POST https://diauth.garmin.com/di-oauth2-service/oauth/token
Authorization: Basic base64("<CLIENT_ID>:")          # note: client id + colon, empty secret
Content-Type: application/x-www-form-urlencoded
Accept: application/json,text/html;q=0.9,*/*;q=0.8
Cache-Control: no-cache
User-Agent: GCM-Android-5.23
X-Garmin-User-Agent: com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0
X-Garmin-Paired-App-Version: 10861
X-Garmin-Client-Platform: Android
X-App-Ver: 10861
X-Lang: en
X-GCExperience: GC5
Accept-Language: en-US,en;q=0.9

client_id=<CLIENT_ID>&service_ticket=ST-...&grant_type=https%3A%2F%2Fconnectapi.garmin.com%2Fdi-oauth2-service%2Foauth%2Fgrant%2Fservice_ticket&service_url=https%3A%2F%2Fmobile.integration.garmin.com%2Fgcm%2Fios
```
- `CLIENT_ID`: try in order `GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2`, `GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4`,
  `GARMIN_CONNECT_MOBILE_ANDROID_DI`, `GARMIN_CONNECT_MOBILE_IOS_DI`; first 2xx wins.
- `service_url` **must equal the `service` the ticket was issued for** (iOS URL above for the mobile flow;
  `https://connect.garmin.com/app` for the portal flow; `https://sso.garmin.com/sso/embed` for the widget flow).
  CAS tickets are single-use and short-lived (seconds to a minute — UNVERIFIED exact TTL): exchange immediately.
- Response: JSON with at least `access_token` (a JWT) and `refresh_token`. Other fields (`expires_in`,
  `token_type`, `scope`, `jti`, `refresh_token_expires_in`) are UNVERIFIED for diauth; the library ignores them.
- Store `di_client_id` = JWT payload `client_id` claim (fallback: the client id that worked). Refresh must use it.
- 429 → stop (rate limited). Note the library sends this POST via `curl_cffi` with Chrome TLS impersonation when
  available — i.e. diauth may also fingerprint clients (UNVERIFIED whether plain clients are blocked).

#### Step 3 – call the API

```
GET https://connectapi.garmin.com/<path>
Authorization: Bearer <di access_token>
Accept: application/json
User-Agent: GCM-Android-5.23
X-Garmin-User-Agent: com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0
X-Garmin-Paired-App-Version: 10861
X-Garmin-Client-Platform: Android
X-App-Ver: 10861
X-Lang: en
X-GCExperience: GC5
Accept-Language: en-US,en;q=0.9
```
- Do **not** send cookies to connectapi (the library rejects all cookies on its API session).
- 204 → treat as `{}`/empty. 401 → refresh once and retry once. 403 → could be a client/network block rather
  than a bad token (library hint); also beware any default auth (issue #444 was a `.netrc` Basic header
  overriding Bearer). 404 → resource missing (also returned for deleted activities).
- Recommended verification call after obtaining a token: `GET /userprofile-service/socialProfile` (returns
  `displayName`, `userProfileFullName`, `profileId`, …). Several endpoints need `displayName` in the path; cache it.
- Known "Token is not active" 401 (issue #369, June 2026): some strategies yield a token the API tier rejects;
  the library therefore verifies each token and tries the next strategy.

#### Step 4 – refresh

```
POST https://diauth.garmin.com/di-oauth2-service/oauth/token
Authorization: Basic base64("<di_client_id>:")
Content-Type: application/x-www-form-urlencoded
Accept: application/json
Cache-Control: no-cache
<native X-Garmin-* headers as above>

grant_type=refresh_token&client_id=<di_client_id>&refresh_token=<di_refresh_token>
-> {"access_token":"...","refresh_token":"... (may be omitted -> keep old)"}
```
- Refresh when the access JWT `exp` is within **900 s** (library), or on 401.
- **Lifetimes:** access token = JWT `exp` (decode it; don't hardcode). Refresh-token lifetime for DI is
  **UNVERIFIED**; library docs say tokens "auto-refresh indefinitely as long as the refresh token remains valid".
  For comparison, the legacy OAuth2 tokens (garth cassettes, VERIFIED) had `expires_in` 65,481–107,182 s
  (~18–30 h) and `refresh_token_expires_in` 2,591,999 s (30 days); Garmin's partner OAuth2 PKCE docs say
  24 h access / ~90 day refresh. **Design: refresh at least once per day from cron** so a rolling refresh
  token never ages out, and always persist the returned refresh token (rotation is possible).
- Refresh is rate-limited if hammered (another project added a cooldown after Garmin rate-limited refresh —
  garth #217 thread). Never refresh concurrently: serialize (see 2.5).

#### Alternative login strategies in the library (for reference)

- **Widget (HTML form) flow**: `GET https://sso.garmin.com/sso/embed?id=gauth-widget&embedWidget=true&gauthHost=https://sso.garmin.com/sso`
  → `GET https://sso.garmin.com/sso/signin?<same + gauthHost/service/source/redirectAfterAccountLoginUrl/redirectAfterAccountCreationUrl=https://sso.garmin.com/sso/embed>` (Referer: embed URL), regex `name="_csrf"\s+value="(.+?)"`
  → wait 3–8 s → `POST /sso/signin?<same params>` form `username,password,embed=true,_csrf` (Referer: signin URL)
  → page `<title>Success</title>` and ticket via regex `\?ticket=(ST-[^"&\s]+)`; MFA page detected by inline JS
  vars `var mfaMethod = "..."`, `customerGuid`, `clientId`, `codeSentTo`; request code with
  `POST /sso/verifyMFA/mfaCode?clientId=<clientId>` JSON `{customerGuid,mfaMethod,locale}`; verify with
  `POST /sso/verifyMFA/loginEnterMfaCode?<signin params>` form `mfa-code,embed=true,_csrf,fromPage=setupEnterMfaCode`.
  Ticket service URL = `https://sso.garmin.com/sso/embed`. Page titles containing locked/invalid/incorrect →
  bad credentials; "unable to sign in" → child/family account.
- **Portal flow**: `GET /portal/sso/en-US/sign-in?clientId=GarminConnect&service=https://connect.garmin.com/app`
  → wait **10–20 s** → `POST /portal/api/login?clientId=GarminConnect&locale=en-US&service=https://connect.garmin.com/app`
  with the same JSON body, browser UA + `Origin`/`Referer`. Same `responseStatus` handling.
- **JWT_WEB fallback** (if the DI exchange fails): `GET <service_url>?ticket=ST-...` following redirects sets a
  `JWT_WEB` cookie; then call connectapi with headers `Cookie: JWT_WEB=<v>`, `NK: NT`,
  `Origin: https://connect.garmin.com`, `Referer: https://connect.garmin.com/modern/`,
  `DI-Backend: connectapi.garmin.com` (+ `connect-csrf-token` if known). Refresh via re-hitting the SSO sign-in
  page with CAS cookies or `POST https://connect.garmin.com/services/auth/token/di-oauth/refresh`. Not
  recommended for Workers (cookie-session based). UNVERIFIED in practice.

#### Legacy garth OAuth1 path (status UNVERIFIED in Nov 2026; documented because it is Worker-friendly)

- Consumer key/secret: `GET https://thegarth.s3.amazonaws.com/oauth_consumer.json` → `{"consumer_key","consumer_secret"}`
  (the public Android app's consumer; fetch at setup and store; don't hardcode).
- Ticket must be issued for `service=https://mobile.integration.garmin.com/gcm/android` (clientId `GCM_ANDROID_DARK`).
- `GET https://connectapi.garmin.com/oauth-service/oauth/preauthorized?ticket=ST-...&login-url=https://mobile.integration.garmin.com/gcm/android&accepts-mfa-tokens=true`
  OAuth1-signed (HMAC-SHA1, consumer only, empty token secret), `User-Agent: com.garmin.android.apps.connectmobile`
  → form-encoded `oauth_token=...&oauth_token_secret=...[&mfa_token=...&mfa_expiration_timestamp=...]`. OAuth1 lived ~1 year.
- `POST https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0` OAuth1-signed with the token,
  `Content-Type: application/x-www-form-urlencoded`, body `audience=GARMIN_CONNECT_MOBILE_ANDROID_DI[&mfa_token=...]`
  (form params are part of the signature base string) → `{"scope","jti","access_token","token_type":"Bearer","refresh_token","expires_in","refresh_token_expires_in"}`.
- Reports: existing OAuth1 tokens kept working after the March 2026 SSO block (only login broke); `@gooin/garmin-connect`
  1.8.8 (Sep 2026) still ships this flow. Whether `preauthorized` still issues new tokens is UNVERIFIED. If it does,
  a "paste OAuth1 token" option gives a 1-year credential with no rolling-refresh fragility. Treat as optional.

### 2.3 What gets blocked (observed 2026)

- SSO (`sso.garmin.com`) is behind Cloudflare WAF/bot management. Symptoms: HTTP 429 (often *not* real rate
  limiting), 427 on the widget page, 403 bot challenge, HTML challenge pages instead of JSON, `CAPTCHA_REQUIRED`.
- Blocking is **fingerprint-based more than IP-based** (issue #444 tests: the library's iOS UA + safari_ios TLS got
  429 where other clients on the same IP got a normal 401; "follows me across IPs" reports). python-garminconnect
  relies on `curl_cffi` TLS impersonation (safari_ios / safari / chrome120 / edge101 / chrome) and warns that
  plain-`requests` strategies "are usually blocked by Cloudflare".
- Rapid GET→POST sequences are flagged; the library inserts 2–5 s (mobile), 3–8 s (widget), 10–20 s (portal);
  a community report says 30–45 s helped.
- Datacenter IPs: reports of 401s on `connectapi` from GitHub Actions/cloud IPs with tokens that work from home
  (garth #217). Not universal (#369 reproduced the same from both), but a real risk for Workers.
- Repeated failed logins can escalate (account-level throttling, MFA prompts, CAPTCHA). Never loop logins.

### 2.4 Feasibility of logging in from a Cloudflare Worker

Mechanically possible:
- `fetch(url, { redirect: "manual" })` works; read cookies with `response.headers.getSetCookie()` and maintain a
  small cookie jar (name/value/domain/path, ignore expiry); send `Cookie:` manually. No automatic jar exists.
- Delays: `await scheduler.wait(ms)` / `setTimeout` costs wall time, not CPU time.
- JSON/form bodies, Basic auth, JWT decoding: trivial. OAuth1 HMAC-SHA1 (legacy path) via `crypto.subtle.sign("HMAC", key, data)` with `{name:"HMAC", hash:"SHA-1"}`.
- MFA across requests: persist `{flow, cookies, params, headers, mfaMethod}` encrypted in D1 for ≤10 min.

Why it will probably fail in practice (UNVERIFIED until tried, but strongly indicated):
- You cannot control the TLS/HTTP2 fingerprint of Worker `fetch`; the Python library only succeeds because it
  impersonates Safari/Chrome TLS. A Worker looks like neither a browser nor the iOS app.
- Worker subrequests to a Cloudflare-proxied zone carry a `CF-Worker: <your zone>` header and originate from
  Cloudflare egress; a single WAF rule on Garmin's side can (and plausibly does) block that.
- Each failed attempt risks account-level throttling.

Conclusion: ship (a) **paste-token bootstrap** as the primary unofficial auth, with the Worker doing refresh;
(b) in-Worker login as an "Try automatic login" button behind a feature flag that does exactly one attempt of the
mobile flow (no retries) and reports the exact status; (c) official Personal API for reads, independent of both.
Whether `diauth.garmin.com` refresh and `connectapi.garmin.com` calls succeed from Workers is the **first thing to
test** with a pasted token (a 10-minute spike). If they fail, enable the home-bridge transport for writes.

### 2.5 Recommended implementation

Secrets/config:
- `GARMIN_TOKEN_ENC_KEY` (Worker secret, 32 bytes, AES-GCM via WebCrypto) to encrypt everything below at rest.

D1 table `garmin_credentials` (one row per kind):
```
kind TEXT PRIMARY KEY            -- 'personal_api' | 'di' | 'mfa_pending'
ciphertext BLOB, iv BLOB          -- encrypted JSON
version INTEGER NOT NULL          -- optimistic-lock counter
expires_at INTEGER                -- access token exp (epoch s), for scheduling
status TEXT                       -- 'ok' | 'needs_reauth' | 'blocked' | 'key_expired'
last_error TEXT, updated_at INTEGER
```
JSON payloads:
- personal_api: `{apiKey, keyExpiresOn?, bearer?, bearerExp?}`
- di: `{di_token, di_refresh_token, di_client_id, displayName?, profileId?}` — identical to python-garminconnect's
  `garmin_tokens.json`, so the paste flow is "paste the file contents".

Refresh serialization: refresh tokens may rotate, so two concurrent refreshes can invalidate each other. Use a
Durable Object as the single owner of the DI session if DOs are acceptable; otherwise a D1 compare-and-swap:
`UPDATE garmin_credentials SET ciphertext=?, iv=?, version=version+1 WHERE kind='di' AND version=?` and, if 0 rows
changed, re-read and use the other writer's token. Take a lease row (`kind='di_lock'`, `lease_until`) before calling
diauth.

State machine for the unofficial session: `none → (paste | login[→mfa_pending]) → ok → (refresh fails 400/401) → needs_reauth`.
Refresh failure with 429/5xx/network → keep `ok`, back off (exponential, max 6 h), alert after 24 h.

Local helper the user runs (document in the UI; runs on their own machine):
```bash
python3 -m venv gc && . gc/bin/activate && pip install "garminconnect>=0.3.20" curl_cffi
python3 - <<'EOF'
from getpass import getpass
from garminconnect import Garmin
g = Garmin(input("email: "), getpass("password: "), prompt_mfa=lambda: input("MFA code: "))
g.login("./gc_tokens")          # writes ./gc_tokens/garmin_tokens.json
print(open("./gc_tokens/garmin_tokens.json").read())   # paste this JSON into the platform
EOF
```
(`Garmin(...)` constructor kwargs `prompt_mfa`, `return_on_mfa`, `is_cn` exist in 0.3.20.) The same helper can
become the home-bridge: a loop that pulls pending write jobs from the platform and executes them with `garminconnect`.

---

## 3. READ endpoints – activities

All paths below are relative to `https://connectapi.garmin.com` (unofficial, DI bearer). Paths marked **[P]** are
also on the Personal API host with the same shape. All VERIFIED (code) unless noted.

### 3.1 List / search  **[P]**
```
GET /activitylist-service/activities/search/activities?start=0&limit=100&startDate=2026-11-01&endDate=2026-11-21
```
- `start` = offset (0 = newest), `limit` ≤ 1000 (library cap; web uses 20). Default order: newest first by local
  start; `sortOrder=asc` reverses. Other web filters: `activityType` (parent key e.g. `running`),
  `activitySubType` (e.g. `trail_running`), `search`, `favorite=1`, `sortBy`, `minDistance`/`maxDistance` (m),
  `minDuration`/`maxDuration` (s), `minElevation`/`maxElevation`, `eventType`, `excludeChildren` (web sends `false`).
- Paginate until an empty array is returned. Whether `startDate`/`endDate` filter on local or GMT start date is
  UNVERIFIED — query one extra day on each side and filter by `startTimeGMT` yourself.
- Count: `GET /activitylist-service/activities/count`.
- Returns a JSON **array** of activity summaries (sample in §9). Large: includes `userRoles` (≈30 strings) per item.

### 3.2 Activity summary field map

List item field (list endpoint) → detail field (`GET /activity-service/activity/{id}` **[P]**, under `summaryDTO`
unless noted). Units are SI unless stated.

| Concept | List item | Detail (`/activity/{id}`) | Notes |
|---|---|---|---|
| ID | `activityId` | `activityId`, `activityUUID.uuid` | int64 — exceeds 2^31; fine in JS number (< 2^53) |
| Name / notes | `activityName`, `description` | `activityName`, `description` | |
| Type | `activityType.typeKey`, `.typeId`, `.parentTypeId` | `activityTypeDTO.*` | see §3.8 |
| FIT sport | `sportTypeId` | – | = FIT `sport` enum (1 run, 2 bike, 5 swim, 17 hiking, 37 SUP). **Not** the workout sportTypeId! |
| Start | `startTimeGMT` `"2026-01-08 14:10:21"`, `startTimeLocal`, `beginTimestamp` (epoch ms) | `startTimeGMT` `"2026-01-08T14:10:21.0"`, `startTimeLocal` | Different string formats! No `Z` — parse as UTC. Prefer `beginTimestamp`. |
| End | `endTimeGMT` | – | |
| Timezone | `timeZoneId` (Garmin numeric) | `timeZoneUnitDTO.timeZone` (IANA) | |
| Duration (timer) | `duration` (s) | `duration` | |
| Moving / elapsed | `movingDuration`, `elapsedDuration` | same | |
| Distance | `distance` (m) | `distance` | |
| Elevation | `elevationGain`, `elevationLoss`, `minElevation`, `maxElevation` (m) | same | |
| Speed | `averageSpeed`, `maxSpeed` (m/s), `avgGradeAdjustedSpeed` | + `averageMovingSpeed` | |
| HR | `averageHR`, `maxHR` | + `minHR` | |
| Power | `avgPower`, `maxPower`, `normPower`, `max20MinPower`, `maxAvgPower_{1,2,5,10,20,30,60,120,300,600,1200,1800,3600,7200,18000}` | `averagePower`, `maxPower`, `minPower`, `normalizedPower`, `totalWork` | names differ list vs detail |
| TSS / IF | `trainingStressScore`, `intensityFactor` | UNVERIFIED in summaryDTO | present only when the device computed them (power + FTP). Compute ourselves as fallback. |
| Balance | `leftBalance`, `rightBalance`, `avgLeftBalance` | | |
| Training effect | `aerobicTrainingEffect`, `anaerobicTrainingEffect`, `trainingEffectLabel`, `aerobicTrainingEffectMessage` | `trainingEffect` (aerobic!), `anaerobicTrainingEffect` | |
| Training load | `activityTrainingLoad` | `activityTrainingLoad` | Garmin EPOC-based load |
| Calories | `calories`, `bmrCalories` | same | kcal |
| Run cadence | `averageRunningCadenceInStepsPerMinute`, `maxRunningCadenceInStepsPerMinute`, `avgDoubleCadence`, `maxDoubleCadence` | `averageRunCadence`, `maxRunCadence` | values are *single-leg* in some fields (fixture: avg 111.7 vs maxDouble 184) — prefer double cadence |
| Run dynamics | `avgVerticalOscillation` (cm), `avgGroundContactTime` (ms), `avgStrideLength` (cm), `avgVerticalRatio` (%), `avgGroundContactBalance` | `verticalOscillation`, `groundContactTime`, `strideLength`, `verticalRatio` | |
| Bike cadence | `averageBikingCadenceInRevPerMinute`, `maxBikingCadenceInRevPerMinute` | UNVERIFIED (`averageBikeCadence`?) | |
| Swim | `poolLength`, `unitOfPoolLength`, `activeLengths`, `strokes`, `avgStrokes`, `minStrokes`, `averageSwolf`, `averageSwimCadenceInStrokesPerMinute`, `maxSwimCadenceInStrokesPerMinute`, `avgStrokeDistance`, `avgStrokeCadence` | | `poolLength`/`unitOfPoolLength` exact encoding UNVERIFIED (believed `poolLength` in cm with `unitOfPoolLength:{unitId,unitKey:"meter",factor:100.0}` → meters = poolLength/factor). Validate against FIT `session.pool_length`. |
| Strength | `totalSets`, `activeSets`, `totalReps`, `summarizedExerciseSets` | | full sets via `/exerciseSets` |
| Laps | `lapCount`, `minActivityLapDuration`, `hasSplits`, `splitSummaries[]` | `metadataDTO.lapCount` | |
| HR/power zones | `hrTimeInZone_1..5`, `powerTimeInZone_1..5` (s) | – | handy: no extra call needed |
| VO2 / LT | `vO2MaxValue`, `lactateThresholdBpm`, `lactateThresholdSpeed`, `maxFtp` | | |
| Intensity minutes | `moderateIntensityMinutes`, `vigorousIntensityMinutes` | same | |
| Body battery | `differenceBodyBattery` | same | |
| Workout link | `workoutId` | `metadataDTO.associatedWorkoutId`, `summaryDTO.directWorkoutComplianceScore`, `directWorkoutFeel`, `directWorkoutRpe` | see §6.6 |
| Device | `deviceId`, `manufacturer` | `metadataDTO.deviceMetaDataDTO`, `metadataDTO.fileFormat.formatKey` (`fit`) | |
| Flags | `manualActivity`, `parent`, `parentId`, `atpActivity`, `purposeful`, `pr`, `favorite`, `hasPolyline` | `isMultiSportParent`, `metadataDTO.childIds`, `metadataDTO.lastUpdateDate`, `metadataDTO.uploadedDate` | `lastUpdateDate` is the edit detector |
| Location | `startLatitude/Longitude`, `endLatitude/Longitude`, `locationName` | same | |
| Weather / temps | `minTemperature`, `maxTemperature` | `averageTemperature`; `/activity/{id}/weather` | device temp, not air temp |

### 3.3 Detail time-series
```
GET /activity-service/activity/{id}/details?maxChartSize=2000&maxPolylineSize=4000[&maxHeatMapSize=2000]
```
Shape (VERIFIED (code): go-garmin struct + garminconnect parser):
```json
{
  "activityId": 21482825013,
  "measurementCount": 18, "metricsCount": 1987,
  "metricDescriptors": [
    {"metricsIndex": 0, "key": "directTimestamp", "unit": {"id": 120, "key": "gmt", "factor": 0.0}},
    {"metricsIndex": 1, "key": "sumDistance", "unit": {"id": 1, "key": "meter", "factor": 100.0}},
    {"metricsIndex": 4, "key": "directHeartRate", "unit": {"id": 100, "key": "bpm", "factor": 1.0}}
  ],
  "activityDetailMetrics": [ {"metrics": [1767881421000, 0.0, null, null, 122.0, ...]}, ... ],
  "geoPolylineDTO": {"startPoint": {...}, "endPoint": {...}, "minLat":0,"maxLat":0,"minLon":0,"maxLon":0,
                     "polyline": [{"lat":19.31,"lon":-99.31,"altitude":null,"time":1767881421000,"timerStart":false,"timerStop":false,"distanceFromPreviousPoint":null,"distanceInMeters":null,"speed":1.9,"cumulativeAscent":null,"cumulativeDescent":null,"extendedCoordinate":false,"valid":true}]},
  "heartRateDTOs": null, "pendingData": null, "detailsAvailable": true
}
```
- Samples are **positional**; map by `metricsIndex` → `key`. Order and set of channels vary by device/sport.
  Keys `sumDistance`, `directHeartRate`, `sumDuration`, `sumElapsedDuration`, `sumMovingDuration` are VERIFIED (code);
  others commonly seen (UNVERIFIED list): `directTimestamp`, `directSpeed`, `directPower`, `directRunCadence`,
  `directBikeCadence`, `directDoubleCadence`, `directFractionalCadence`, `directElevation`, `directLatitude`,
  `directLongitude`, `directAirTemperature`, `directVerticalOscillation`, `directGroundContactTime`,
  `directStrideLength`, `directVerticalRatio`, `directVerticalSpeed`, `directGradeAdjustedSpeed`,
  `directRespirationRate`, `directPerformanceCondition`, `directBodyBattery`. Unit ids/factors above are UNVERIFIED.
- Data is **downsampled to `maxChartSize` points**. Missing values are `null`.
- Pool swims: the web app calls `/activity-service/activity/{id}/swimDetails?maxChartSize=&maxPolylineSize=` instead.
- Also: `/subseconddetails?maxChartSize=` (only when `metadataDTO.hasSubsecondData`), `/mapdetails`, `/polyline/{id}` (`activity-service/activity/polyline/{id}`), `/powerCurve`.

### 3.4 Laps, splits, zones, sets
| Endpoint | Returns |
|---|---|
| `GET /activity-service/activity/{id}/splits` | `{activityId, lapDTOs:[...]}` (device laps) |
| `GET /activity-service/activity/{id}/laps` | `{lapDTOs:[...]}` |
| `GET /activity-service/activity/{id}/typedsplits` | `{activityId, activityUUID, splits:[{startTimeLocal,startTimeGMT,distance,duration,movingDuration,elapsedDuration,elevationGain,averageSpeed,averageHR,calories,...,type}]}` (RWD_RUN/RWD_WALK/INTERVAL_ACTIVE…) |
| `GET /activity-service/activity/{id}/split_summaries` | aggregated by `splitType` (same as `splitSummaries` in list) |
| `GET /activity-service/activity/{id}/hrTimeInZones` | array of zones; UNVERIFIED shape `[{zoneNumber, secsInZone, zoneLowBoundary}]` |
| `GET /activity-service/activity/{id}/powerTimeInZones` | same idea for power |
| `GET /activity-service/activity/{id}/exerciseSets` | `{activityId, exerciseSets:[{exercises:[{category,name,probability}], repetitionCount, weight, duration, setType:"ACTIVE"/"REST", startTime, wktStepIndex}]}` — only `exercises[].category/name` and replace-all `PUT` semantics VERIFIED (code); other fields UNVERIFIED |
| `GET /activity-service/activity/{id}/stepdetails` | per-workout-step results for structured workouts |
| `GET /activity-service/activity/{id}/rounds` | HIIT/boxing rounds |
| `GET /activity-service/activity/{id}/weather` | weather |
| `GET /activity-service/activity/{id}/workouts` **[P]** | workouts associated with the activity |
| `GET /activity-service/activity/activityTypes` (**[P]** `/activityTypes/simple`) | type catalogue |

### 3.5 Original file download  **[P]**
```
GET /download-service/files/activity/{activityId}        Accept: */*  (Personal API: application/zip,...)
-> ZIP containing one file, typically "{activityId}_ACTIVITY.fit"
```
Exports also exist (unofficial only): `/download-service/export/{tcx|gpx|kml|csv}/activity/{id}`.

**FIT vs details JSON → parse FIT.** FIT gives full-resolution `record` messages (1 s), true `lap` messages,
`length` messages (pool swim per-length stroke type/strokes), `set` messages (strength: reps, weight,
category/exercise), `session` totals (incl. `pool_length`, `training_stress_score`, `intensity_factor`,
`threshold_power` when the device computed them), HRV (`hrv` messages), developer fields, and `workout`/`workout_step`
messages (what workout was executed). It's one request instead of 4–6 JSON calls and the same on both APIs.
Caveat: Connect serves a **re-encoded** FIT (reported ~half the size of the watch's original, not byte-identical) —
fine for analytics. In Workers: unzip with `fflate` (`unzipSync`) or `DecompressionStream("deflate-raw")`, parse with
Garmin's official JS SDK `@garmin/fitsdk` (21.222.0, pure JS):
```ts
import { Decoder, Stream } from "@garmin/fitsdk";
const { messages, errors } = new Decoder(Stream.fromByteArray(fitBytes)).read();
// messages.sessionMesgs, lapMesgs, recordMesgs, lengthMesgs, setMesgs, workoutMesgs, workoutStepMesgs
```
CPU cost for a long ride is likely tens–hundreds of ms (UNVERIFIED) — do it in a Queue consumer, store the raw
ZIP/FIT in R2 keyed `garmin/{activityId}.fit`, and store derived streams compactly.
Keep the JSON summary as the source of Garmin-specific metrics (training effect, activityTrainingLoad, body battery,
HR zone times) that are not in FIT.

### 3.6 Uploading activities (manual fallback)
`POST /upload-service/upload` multipart field `file` (web app uses `/upload-service/upload/.fit` field `userfile`).
Duplicate → 409 "Duplicate Activity.". Import variant `POST /upload-service/upload/{fit|gpx|tcx}` with
headers `NK: NT`, `origin: https://sso.garmin.com` (not re-exported to Strava).

### 3.7 Edits from our side (optional)
`PUT /activity-service/activity/{id}` body `{"activityId": id, "activityName"?, "description"?, "activityTypeDTO"?: {"typeKey": "..."}, "eventTypeDTO"?, "metadataDTO"?: {"favorite": true}}` (partial update). `DELETE /activity-service/activity/{id}`.

### 3.8 Activity type keys

Do not hardcode IDs: fetch `/activity-service/activity/activityTypes` (or **[P]** `/activityTypes/simple`) at setup,
cache for 48 h, and map by `typeKey` + walk `parentTypeId` to the root. VERIFIED from fixtures:
`trail_running` (typeId 6, parent 1 = `running`), `hiking` (3, parent 17), `open_water_swimming` (28, parent 26 =
`swimming`), `stand_up_paddleboarding_v2` (239, parent 228). Mapping table for our canonical sports (keys
UNVERIFIED unless in the previous sentence; confirm against the live catalogue):

| Our sport | Garmin typeKeys |
|---|---|
| run | `running`, `street_running`, `track_running`, `trail_running`, `treadmill_running`, `indoor_running`, `virtual_run`, `ultra_run`, `obstacle_run` |
| bike | `cycling`, `road_biking`, `gravel_cycling`, `mountain_biking`, `cyclocross`, `track_cycling`, `recumbent_cycling`, `downhill_biking`, `bmx`, `e_bike_fitness`, `e_bike_mountain`, `handcycling` |
| bike_indoor | `indoor_cycling`, `virtual_ride`, `indoor_handcycling` |
| swim_pool | `lap_swimming` |
| swim_open | `open_water_swimming` |
| row | `rowing_v2` (also legacy `rowing`), `indoor_rowing` |
| strength | `strength_training` |
| cardio/hiit | `hiit`, `indoor_cardio`, `fitness_equipment` (parent), `elliptical`, `stair_climbing`, `floor_climbing` |
| mobility | `yoga`, `pilates`, `breathwork`, `mobility` |
| walk | `walking`, `casual_walking`, `speed_walking` |
| hike | `hiking` |
| multisport | `multi_sport`, `triathlon` (UNVERIFIED), transitions (`transition*`) — parent has `parent:true`, children `parentId` |
| ski/snow | `resort_skiing_snowboarding_ws`, `resort_skiing`, `resort_snowboarding`, `backcountry_skiing`, `cross_country_skiing_ws`, `skate_skiing_ws`, `snow_shoe_ws` |
| paddle | `kayaking_v2`, `stand_up_paddleboarding_v2`, `paddling` |
| other | `other` and anything unmapped (keep raw typeKey) |

Multisport: the parent and each leg are separate activities; store legs, mark parent as container.

---

## 4. WELLNESS / physiology endpoints

Unofficial unless marked **[P]** (Personal API path may differ; table §1). `{dn}` = `displayName` from
`/userprofile-service/socialProfile`. Dates `YYYY-MM-DD`, evaluated in the **user's Garmin profile timezone**
(get it from `/userprofile-service/userprofile/personal-information/{dn}` → IANA tz; do not use the Worker's UTC "today").

| Data | Request | Key response fields (VERIFIED from fixtures/models unless noted) |
|---|---|---|
| Daily summary | `GET /usersummary-service/usersummary/daily/{dn}?calendarDate=D`; range **[P]** `GET /usersummary-service/v2/dailysummaries?startDate&endDate` | `calendarDate, totalSteps, totalKilocalories, activeKilocalories, bmrKilocalories, restingHeartRate, minHeartRate, maxHeartRate, lastSevenDaysAvgRestingHeartRate, averageStressLevel, maxStressLevel, bodyBatteryHighestValue, bodyBatteryLowestValue, bodyBatteryAtWakeTime, moderateIntensityMinutes, vigorousIntensityMinutes, sleepingSeconds, floorsAscended` |
| Sleep | `GET /sleep-service/sleep/dailySleepData?date=D[&nonSleepBufferMinutes=60]` (web app); **[P]** `/sleep-service/sleep/dailySleep?date=D`; range stats `GET /sleep-service/stats/sleep/daily/{s}/{e}` (≤28 days per call) → `individualStats[]` | `dailySleepDTO{calendarDate, sleepTimeSeconds, deepSleepSeconds, lightSleepSeconds, remSleepSeconds, awakeSleepSeconds, sleepStartTimestampGMT, sleepEndTimestampGMT, avgSleepHRV, averageRespirationValue, sleepScores{overall{value}}}`, top-level `restingHeartRate, bodyBatteryChange, avgSkinTempDeviationC, sleepLevels[]`. Use GMT timestamps (local ones reported double-offset for UTC+8). |
| HRV | **[P]** `GET /hrv-service/hrv/{D}`; range **[P]** `/hrv-service/hrv/daily/{s}/{e}` | `hrvSummary{calendarDate, weeklyAvg, lastNightAvg, lastNight5MinHigh, status:"BALANCED", feedbackPhrase, baseline{lowUpper, balancedLow, balancedUpper, markerValue}}, hrvReadings[{hrvValue, readingTimeGMT, readingTimeLocal}]`; may return empty/null |
| Resting HR | `GET /userstats-service/wellness/daily/{dn}?fromDate=S&untilDate=E&metricId=60` (range ≤ ~1 yr); or `/usersummary-service/stats/heartRate/daily/{s}/{e}` | per-day values |
| Body battery | **[P]** `GET /wellness-service/wellness/bodyBattery/reports/daily?startDate&endDate`; events `/wellness-service/wellness/bodyBattery/events/{D}` | `bodyBatteryValuesArray`, `charged`, `drained` |
| Stress | `GET /wellness-service/wellness/dailyStress/{D}`; **[P]** `/usersummary-service/stats/stress/daily/{s}/{e}` | |
| Training readiness | `GET /metrics-service/metrics/trainingreadiness/{D}` (range `/{s}/{e}`) | **array** of snapshots: `score, level ("MODERATE"), feedbackShort, sleepScore, recoveryTime (minutes), acuteLoad, hrvWeeklyAverage, *FactorPercent, inputContext ("AFTER_WAKEUP_RESET" = morning value), timestamp` |
| Training status (aggregated) | `GET /metrics-service/metrics/trainingstatus/aggregated/{D}` | nested; UNVERIFIED keys: `mostRecentTrainingStatus.latestTrainingStatusData{<deviceId>:{trainingStatus, trainingStatusFeedbackPhrase, acuteTrainingLoadDTO{acwrPercent, acwrStatus, dailyTrainingLoadAcute, dailyTrainingLoadChronic, dailyAcuteChronicWorkloadRatio}}}`, `mostRecentVO2Max`, `mostRecentTrainingLoadBalance` |
| Daily training status / ACWR | `GET /metrics-service/metrics/trainingstatus/daily/{D}`; weekly `/metrics-service/metrics/trainingstatus/weekly/{dn}?fromCalendarDate&toCalendarDate` | garth model fields: `trainingStatus, weeklyTrainingLoad, loadTunnelMin/Max, acwrPercent, acwrStatus, dailyTrainingLoadAcute, dailyTrainingLoadChronic, dailyAcuteChronicWorkloadRatio, fitnessTrend` |
| Load balance (focus) | `GET /metrics-service/metrics/trainingloadbalance/latest/{D}` | |
| Per-activity training load list | `GET /fitnessstats-service/activity/all?startDate&endDate&...` | |
| VO2max | **[P]** `GET /metrics-service/metrics/maxmet/daily/{s}/{e}[?sport=]`; latest `/metrics-service/metrics/maxmet/latest/{D}` | `generic` (running), `cycling`, `heatAltitudeAcclimation` |
| Lactate threshold | `GET /biometric-service/biometric/latestLactateThreshold` (list; HR may be under typo key `hearRate`); ranges `/biometric-service/stats/lactateThresholdSpeed/range/{s}/{e}?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST`, `.../lactateThresholdHeartRate/range/...` | `speed`, `heartRate` |
| Running power-to-weight / LT power | `GET /biometric-service/biometric/powerToWeight/latest/{D}?sport=Running` | |
| Cycling FTP | `GET /biometric-service/biometric/latestFunctionalThresholdPower/CYCLING` | `functionalThresholdPower` |
| Current biometrics (all in one) | `GET /userprofile-service/biometric/current/{dn}` | height, weight, VO2max, LT speed/HR, FTP |
| HR zones | **[P]** `GET /biometric-service/heartRateZones/v2[?generateDefaults=false]`; v1 `/biometric-service/heartRateZones` | per sport; `PUT /biometric-service/heartRateZones/` to update |
| Power zones | `GET /biometric-service/powerZones/sports/all`; `/biometric-service/powerZones/sport/{sport}`; `PUT /biometric-service/powerZones/all` | |
| Critical swim speed | `GET /biometric-service/criticalSwimSpeed/latest/{D}` | |
| Weight / body comp | `GET /weight-service/weight/dateRange?startDate&endDate`; **[P]** `/weight-service/weight/range/{s}/{e}?includeAll=true`; day `/weight-service/weight/dayview/{D}`; latest `/weight-service/weight/latest?date=D&ignorePriority=true` | weight in **grams** |
| User settings | `GET /userprofile-service/userprofile/user-settings` | `userData{gender, weight (g, e.g. 83000.0), height (cm), birthDate, measurementSystem ("metric"), powerFormat{formatKey:"watt"}, heartRateFormat{formatKey:"bpm"}, firstDayOfWeek, vo2MaxRunning, vo2MaxCycling, lactateThresholdSpeed (fixture 0.3472 — appears to be in units of 10 m/s → 3.47 m/s ≈ 4:48/km, UNVERIFIED), lactateThresholdHeartRate, thresholdHeartRateAutoDetected, ftpAutoDetected}`, `userSleep{sleepTime, wakeTime}` |
| Profile settings | **[P]** `GET /userprofile-service/userprofile/settings` | display name, locale, prefs |
| Social profile (identity) | `GET /userprofile-service/socialProfile` | `displayName, profileId, userProfileFullName` |
| Personal info / timezone | `GET /userprofile-service/userprofile/personal-information/{dn}?includeBiometric=true&includeVO2Max=true` | `userInfo`, `biometricProfile`, timezone |
| Devices | `GET /device-service/deviceregistration/devices`; last used `/device-service/deviceservice/mylastused` (UNVERIFIED path; library `get_device_last_used` returns `userDeviceId`) | |
| Last device sync time (change detector) | `GET /wellness-service/wellness/syncTimestamp` | UTC timestamp string (VERIFIED (docs)) |
| Race predictions | `GET /metrics-service/metrics/racepredictions/...` | |
| GraphQL | `POST /graphql-gateway/graphql` | 53 dashboard operations documented in python-garminconnect `docs/graphql_operations.md` |

---

## 5. WRITE endpoints (unofficial API only)

### 5.1 Workout CRUD
| Action | Request | Response |
|---|---|---|
| Create | `POST /workout-service/workout` JSON workout (no ids) | full workout incl. `workoutId`, `ownerId`, `createdDate`, assigned `stepId`s |
| Read | `GET /workout-service/workout/{workoutId}` | workout |
| List | `GET /workout-service/workouts?start=0&limit=100[&myWorkoutsOnly=true&orderBy=UPDATE_DATE&orderSeq=DESC&sportTypeKey=running]` | array (summaries) |
| Update (replace) | `PUT /workout-service/workout/{workoutId}` full JSON with `workoutId` set | Keeps id, so schedules stay valid. Garmin replaces the whole workout. |
| Delete | `DELETE /workout-service/workout/{workoutId}` | 204 |
| Copy | `POST /workout-service/workout/copy/{workoutId}` body = new name, `Content-Type: text/plain` | new workout |
| FIT of workout | `GET /workout-service/workout/FIT/{workoutId}` | FIT bytes |
| Type dictionaries | `GET /workout-service/workout/types` | `workoutSportTypes`, step types, condition types, target types, stroke types, equipment types — **call once at setup and validate our enums against it** |
| Strength benchmarks | `GET /workout-service/benchmarks` | for 1RM targets |

### 5.2 Workout JSON schema (VERIFIED (code) from python-garminconnect 0.3.20 models/tests + sample fixture)

```ts
interface Workout {
  workoutId?: number;                 // server-assigned; required in PUT body
  workoutName: string;
  description?: string;
  sportType: SportType;               // must match segment sportType for single-sport workouts
  estimatedDurationInSecs?: number;   // informational
  estimatedDistanceInMeters?: number; // UNVERIFIED field name, optional
  author?: {};                        // library sends {}
  workoutSegments: WorkoutSegment[];  // single sport: exactly one segment
  // swim only (UNVERIFIED field names): poolLength?: number; poolLengthUnit?: {unitId:number; unitKey:"meter"|"yard"; factor:number}
}
interface SportType { sportTypeId: number; sportTypeKey: string; displayOrder?: number }
interface WorkoutSegment { segmentOrder: number; sportType: SportType; workoutSteps: Step[] }
type Step = ExecutableStep | RepeatGroup;
interface ExecutableStep {
  type: "ExecutableStepDTO";
  stepId?: number;                    // server-assigned
  stepOrder: number;                  // unique, depth-first, 1-based across the whole segment
  childStepId?: number;               // set on steps inside a repeat (same value as the parent repeat's childStepId)
  stepType: { stepTypeId: number; stepTypeKey: string; displayOrder?: number };
  description?: string;               // per-step note (VERIFIED live per changelog 0.3.18)
  endCondition: { conditionTypeId: number; conditionTypeKey: string; displayOrder?: number; displayable?: boolean };
  endConditionValue?: number;         // seconds | meters | reps | calories | bpm | watts — per condition
  preferredEndConditionUnit?: { unitKey: "kilometer"|"mile"|"meter"|"yard" }; // UNVERIFIED, display only
  targetType: { workoutTargetTypeId: number; workoutTargetTypeKey: string; displayOrder?: number };
  targetValueOne?: number | null;     // custom range low  (see units below)
  targetValueTwo?: number | null;     // custom range high
  zoneNumber?: number | null;         // instead of values: user's configured zone N
  secondaryTargetType?: {...same as targetType};
  secondaryTargetValueOne?: number; secondaryTargetValueTwo?: number; secondaryZoneNumber?: number;
  strokeType?: { strokeTypeId: number; strokeTypeKey?: string; displayOrder?: number };       // swim; {strokeTypeId:0} = none
  equipmentType?: { equipmentTypeId: number; equipmentTypeKey?: string; displayOrder?: number }; // swim; {equipmentTypeId:0} = none
  category?: string; exerciseName?: string;                    // strength (e.g. "BENCH_PRESS", "")
  weightValue?: number; weightUnit?: { unitId: 8; unitKey: "kilogram"; factor: 1000.0 }; // strength; weightValue in GRAMS
}
interface RepeatGroup {
  type: "RepeatGroupDTO";
  stepOrder: number; childStepId?: number;
  stepType: { stepTypeId: 6; stepTypeKey: "repeat"; displayOrder: 6 };
  numberOfIterations: number;
  endCondition: { conditionTypeId: 7; conditionTypeKey: "iterations"; displayOrder: 7; displayable: false };
  endConditionValue: number;          // = numberOfIterations
  smartRepeat: false;
  skipLastRestStep?: boolean;         // newer watches only (≈FR955+)
  workoutSteps: Step[];               // nesting a repeat in a repeat: UNVERIFIED whether allowed; avoid
}
```

Enums (python-garminconnect 0.3.20, pinned by regression tests against `/workout-service/workout/types`; the
ConditionType/TargetType IDs were *wrong* in older library versions — issue #370 fixed June 2026):

| sportType (workout) | id | key |
|---|---|---|
| | 1 | `running` |
| | 2 | `cycling` |
| | 3 | `other` |
| | 4 | `swimming` |
| | 5 | `strength_training` |
| | 6 | `cardio_training` |
| | 7 | `yoga` |
| | 8 | `pilates` |
| | 9 | `hiit` |
| | 10 | `multi_sport` |
| | 11 | `mobility` |

There is **no walking, hiking or rowing workout sport type** (walking/hiking VERIFIED (docs): uploads with ids 17/18 were
stored without a sport; rowing absent from the enum). Model rowing/erg workouts as `cardio_training` (6) or `other` (3)
with time/distance steps (UNVERIFIED how the watch presents them). Note one library sample file still uses
`sportTypeId: 3` for swimming — that is stale; 4 is correct.

| stepType | id | key | | conditionType | id | key | value unit |
|---|---|---|---|---|---|---|---|
| | 1 | `warmup` | | | 1 | `lap.button` | none (omit value) |
| | 2 | `cooldown` | | | 2 | `time` | seconds |
| | 3 | `interval` | | | 3 | `distance` | meters |
| | 4 | `recovery` | | | 4 | `calories` | kcal |
| | 5 | `rest` | | | 5 | `power` | watts (end when above/below — semantics UNVERIFIED) |
| | 6 | `repeat` | | | 6 | `heart.rate` | bpm (UNVERIFIED semantics) |
| | 7 | `other` | | | 7 | `iterations` | count (repeat groups) |
| | 8 | `main` | | | 8 | `fixed.rest` | seconds (swim send-off rest) — key UNVERIFIED |
| | | | | | 9 | `fixed.repetition` | — key UNVERIFIED |
| | | | | | 10 | `reps` | count (strength) |

| targetType | id | key | targetValueOne / Two |
|---|---|---|---|
| | 1 | `no.target` | – |
| | 2 | `power.zone` | custom: watts low/high (VERIFIED by mkuthan/garmin-workouts tests: 95/105, 114/126); or `zoneNumber` 1..N with values null |
| | 3 | `cadence` | rpm / spm low/high (often used as secondary) |
| | 4 | `heart.rate.zone` | custom: bpm low/high; or `zoneNumber` |
| | 5 | `speed.zone` | m/s low/high |
| | 6 | `pace.zone` | **m/s**, `targetValueOne` = slower (lower m/s), `targetValueTwo` = faster. Convert pace: `1000 / secPerKm`. (library maintainer: "almost certainly m/s"; used in live demo uploads) |
| | 7 | `grade` | % (UNVERIFIED) |
| | 8 | `heart.rate.lap` | (UNVERIFIED) |
| | 9 | `power.lap` | (UNVERIFIED) |
| | 15 | `resistance` | (UNVERIFIED) |
| | 17 | `swim.css.offset` | **secondary target only**: `secondaryTargetValueOne` = signed offset seconds/100 m vs CSS (+ = slower), `secondaryTargetValueTwo` = 0 (VERIFIED live per changelog 0.3.18) |

- `displayOrder` inside type objects is mirrored from Garmin's dictionary; the library sends `1` for every primary
  target and `2` for secondary and Garmin accepts it — it appears to be ignored on input.
- Power targets as **% FTP**: the JSON API takes watts; compute watts from our FTP at upload time. (FIT workout files
  encode `value > 1000` as watts+1000 and ≤1000 as %FTP — that is a FIT convention, not this JSON API.)
- Swim stroke/equipment ids (UNVERIFIED — take from `/workout/types`): strokes ≈ `any_stroke`, `backstroke`,
  `breaststroke`, `drill`, `fly`, `free`, `individual_medley`, `mixed`; equipment ≈ `fins`, `kickboard`, `paddles`,
  `pull_buoy`, `snorkel`. `{strokeTypeId: 0}` / `{equipmentTypeId: 0}` = none (VERIFIED in fixture).
- Strength: `category` + `exerciseName` from Garmin's FIT exercise enums (47 categories, 1527 exercises in
  `garminconnect/exercises.py`): `BANDED_EXERCISES BATTLE_ROPE BENCH_PRESS BIKE_OUTDOOR CALF_RAISE CARDIO CARRY CHOP CORE
  CRUNCH CURL DEADLIFT ELLIPTICAL FLOOR_CLIMB FLYE HIP_RAISE HIP_STABILITY HIP_SWING HYPEREXTENSION INDOOR_BIKE LADDER
  LATERAL_RAISE LEG_CURL LEG_RAISE LUNGE OLYMPIC_LIFT PLANK PLYO PULL_UP PUSH_UP ROW RUN RUN_INDOOR SANDBAG SHOULDER_PRESS
  SHOULDER_STABILITY SHRUG SIT_UP SLED SLEDGE_HAMMER SQUAT STAIR_STEPPER SUSPENSION TIRE TOTAL_BODY TRICEPS_EXTENSION
  WARM_UP`. A set = RepeatGroup{ExecutableStep interval with `reps` (10) or `time` end condition, then `rest` step}.
  `exerciseName: ""` shows only the category. Copy the catalogue into our repo as data.
- Multisport (triathlon) workouts: `sportType` `multi_sport` (10) with one segment per leg, each segment with its own
  `sportType` (UNVERIFIED segment rules).

### 5.3 Example payloads

Step ordering rule used below: `stepOrder` unique and depth-first; repeat group and its children share a
`childStepId` (1 for the first repeat, 2 for the next…), as in Garmin's own stored workouts.

**A. Run: 15' WU, 5 × (1 km @ 4:10–4:20/km, 2' jog), 10' CD**
```json
{
  "workoutName": "5x1k @ T pace",
  "description": "Threshold kilometres",
  "sportType": {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
  "estimatedDurationInSecs": 3300,
  "workoutSegments": [{
    "segmentOrder": 1,
    "sportType": {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
    "workoutSteps": [
      {"type": "ExecutableStepDTO", "stepOrder": 1,
       "stepType": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
       "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
       "endConditionValue": 900.0,
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}},
      {"type": "RepeatGroupDTO", "stepOrder": 2, "childStepId": 1,
       "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
       "numberOfIterations": 5, "smartRepeat": false,
       "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": false},
       "endConditionValue": 5.0,
       "workoutSteps": [
         {"type": "ExecutableStepDTO", "stepOrder": 3, "childStepId": 1,
          "stepType": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
          "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": true},
          "endConditionValue": 1000.0,
          "targetType": {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone", "displayOrder": 6},
          "targetValueOne": 3.8462, "targetValueTwo": 4.0,
          "description": "4:20 -> 4:10 /km"},
         {"type": "ExecutableStepDTO", "stepOrder": 4, "childStepId": 1,
          "stepType": {"stepTypeId": 4, "stepTypeKey": "recovery", "displayOrder": 4},
          "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
          "endConditionValue": 120.0,
          "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}}
       ]},
      {"type": "ExecutableStepDTO", "stepOrder": 5,
       "stepType": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
       "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
       "endConditionValue": 600.0,
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}}
    ]
  }]
}
```
(4:20/km = 260 s → 1000/260 = 3.8462 m/s; 4:10/km = 250 s → 4.0 m/s.)

**B. Bike: 10' WU (HR zone 2), 4 × (8' @ 250–265 W + 85–95 rpm, 4' @ zone 1 power), lap-button CD**
```json
{
  "workoutName": "4x8 sweet spot",
  "sportType": {"sportTypeId": 2, "sportTypeKey": "cycling", "displayOrder": 2},
  "estimatedDurationInSecs": 3480,
  "workoutSegments": [{
    "segmentOrder": 1,
    "sportType": {"sportTypeId": 2, "sportTypeKey": "cycling", "displayOrder": 2},
    "workoutSteps": [
      {"type": "ExecutableStepDTO", "stepOrder": 1,
       "stepType": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
       "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
       "endConditionValue": 600.0,
       "targetType": {"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone", "displayOrder": 4},
       "zoneNumber": 2},
      {"type": "RepeatGroupDTO", "stepOrder": 2, "childStepId": 1,
       "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
       "numberOfIterations": 4, "smartRepeat": false,
       "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": false},
       "endConditionValue": 4.0,
       "workoutSteps": [
         {"type": "ExecutableStepDTO", "stepOrder": 3, "childStepId": 1,
          "stepType": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
          "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
          "endConditionValue": 480.0,
          "targetType": {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone", "displayOrder": 2},
          "targetValueOne": 250, "targetValueTwo": 265,
          "secondaryTargetType": {"workoutTargetTypeId": 3, "workoutTargetTypeKey": "cadence", "displayOrder": 3},
          "secondaryTargetValueOne": 85, "secondaryTargetValueTwo": 95},
         {"type": "ExecutableStepDTO", "stepOrder": 4, "childStepId": 1,
          "stepType": {"stepTypeId": 4, "stepTypeKey": "recovery", "displayOrder": 4},
          "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
          "endConditionValue": 240.0,
          "targetType": {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone", "displayOrder": 2},
          "zoneNumber": 1}
       ]},
      {"type": "ExecutableStepDTO", "stepOrder": 5,
       "stepType": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
       "endCondition": {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": true},
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}}
    ]
  }]
}
```

**C. Pool swim (25 m): 400 easy, 8 × 100 free @ CSS+3 s with 15 s rest, 200 pull with buoy, 100 easy**
```json
{
  "workoutName": "CSS 8x100",
  "sportType": {"sportTypeId": 4, "sportTypeKey": "swimming", "displayOrder": 4},
  "poolLength": 25.0,
  "poolLengthUnit": {"unitId": 1, "unitKey": "meter", "factor": 100.0},
  "estimatedDurationInSecs": 2700,
  "workoutSegments": [{
    "segmentOrder": 1,
    "sportType": {"sportTypeId": 4, "sportTypeKey": "swimming", "displayOrder": 4},
    "workoutSteps": [
      {"type": "ExecutableStepDTO", "stepOrder": 1,
       "stepType": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
       "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": true},
       "endConditionValue": 400.0,
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
       "strokeType": {"strokeTypeId": 0, "displayOrder": 0},
       "equipmentType": {"equipmentTypeId": 0, "displayOrder": 0}},
      {"type": "RepeatGroupDTO", "stepOrder": 2, "childStepId": 1,
       "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
       "numberOfIterations": 8, "smartRepeat": false,
       "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": false},
       "endConditionValue": 8.0,
       "workoutSteps": [
         {"type": "ExecutableStepDTO", "stepOrder": 3, "childStepId": 1,
          "stepType": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
          "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": true},
          "endConditionValue": 100.0,
          "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
          "secondaryTargetType": {"workoutTargetTypeId": 17, "workoutTargetTypeKey": "swim.css.offset", "displayOrder": 2},
          "secondaryTargetValueOne": 3.0, "secondaryTargetValueTwo": 0.0,
          "strokeType": {"strokeTypeId": 6, "strokeTypeKey": "free"},
          "equipmentType": {"equipmentTypeId": 0, "displayOrder": 0}},
         {"type": "ExecutableStepDTO", "stepOrder": 4, "childStepId": 1,
          "stepType": {"stepTypeId": 5, "stepTypeKey": "rest", "displayOrder": 5},
          "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
          "endConditionValue": 15.0,
          "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}}
       ]},
      {"type": "ExecutableStepDTO", "stepOrder": 5,
       "stepType": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
       "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": true},
       "endConditionValue": 200.0,
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
       "strokeType": {"strokeTypeId": 6, "strokeTypeKey": "free"},
       "equipmentType": {"equipmentTypeId": 4, "equipmentTypeKey": "pull_buoy"},
       "description": "pull"},
      {"type": "ExecutableStepDTO", "stepOrder": 6,
       "stepType": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
       "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": true},
       "endConditionValue": 100.0,
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
       "strokeType": {"strokeTypeId": 0, "displayOrder": 0},
       "equipmentType": {"equipmentTypeId": 0, "displayOrder": 0}}
    ]
  }]
}
```
UNVERIFIED in C: `poolLength`/`poolLengthUnit` field names/encoding, stroke id 6 = free, equipment id 4 = pull_buoy,
and the swim "rest" step (Garmin's editor may prefer `rest` with `lap.button` or a `fixed.rest` condition). Implement:
on first use, `GET /workout-service/workout/types`, build lookup tables from it, upload, then `GET` the workout back and
diff — log any field Garmin dropped or rewrote. The library's own swim examples are time-based and set no pool length.

**D. Strength step (snippet)**: `{"type":"ExecutableStepDTO","stepOrder":2,"childStepId":1,"stepType":{"stepTypeId":3,"stepTypeKey":"interval","displayOrder":3},"endCondition":{"conditionTypeId":10,"conditionTypeKey":"reps","displayOrder":10,"displayable":true},"endConditionValue":8.0,"targetType":{"workoutTargetTypeId":1,"workoutTargetTypeKey":"no.target","displayOrder":1},"category":"SQUAT","exerciseName":"BARBELL_BACK_SQUAT","weightValue":80000.0,"weightUnit":{"unitId":8,"unitKey":"kilogram","factor":1000.0}}` inside a RepeatGroup with a `rest` step; workout `sportType` `{5,"strength_training"}`. (`BARBELL_BACK_SQUAT` must exist in the catalogue — check `exercises.py`.)

### 5.4 Scheduling, calendar, delivery to the watch
| Action | Request |
|---|---|
| Schedule on a date | `POST /workout-service/schedule/{workoutId}` body `{"date": "2026-11-24"}` → schedule entry incl. its id (field name likely `workoutScheduleId` — UNVERIFIED; also accept `scheduleId`/`id`) |
| Get one schedule | `GET /workout-service/schedule/{scheduleId}` → `{..., "workout": {...}, "calendarDate": "..."}` |
| Unschedule | `DELETE /workout-service/schedule/{scheduleId}` (keeps the workout template) |
| Reschedule | `PUT /workout-service/schedule/{scheduleId}` body = existing entry with `calendarDate` changed and `workout: {workoutId}` |
| Scheduled in a period (incl. Garmin Coach/adaptive plans) | `GET /workout-service/schedule/workoutScheduleByPeriod?startDate&endDate` |
| Calendar month | `GET /calendar-service/year/{yyyy}/month/{m0}` — **month is 0-based** (Nov = 10) → `{calendarItems:[{id, itemType:"workout"\|"activity"\|"weight"\|..., date:"YYYY-MM-DD", title, ...}]}` (other item fields UNVERIFIED) |
| Calendar week | `GET /calendar-service/year/{y}/month/{m0}/day/{d}/start/{firstDayOfWeek}` |
| Calendar year | `GET /calendar-service/year/{y}` |
| Race events | `GET /calendar-service/events?startDate&endDate`, `/calendar-service/event/primary`, CRUD `POST/PUT/DELETE /calendar-service/event[/{id}]` |
| Notes | `POST /calendar-service/note` `{"noteName","content","date"}`; `PUT/DELETE /calendar-service/note/{id}` |
| Push to device now | `POST /device-service/devicemessage/messages` body is an **array**: `[{"deviceId":<userDeviceId>,"messageUrl":"workout-service/workout/FIT/<workoutId>","messageType":"workouts","messageName":"<workoutName>","groupName":null,"priority":1,"fileType":"FIT","metaDataId":<workoutId>}]` (bare object → 500). Queue visible via `GET /device-service/devicemessage/messages` (`messageStatus:"new"` until the watch syncs). Web app now posts a single object to `devicemessage-service/devicemessage/messages` (UNVERIFIED variant). |
| Send all scheduled to devices | `PUT /workout-service/schedule/sendtodevices` (UNVERIFIED body; not live-tested) |

How workouts reach the watch: scheduled workouts appear in the watch's training calendar after the next phone/Wi-Fi
sync (Garmin syncs upcoming scheduled workouts — window size UNVERIFIED, typically ~1 week). **Edits to a workout
that has already synced do not reach the watch on a normal sync** (issue #400): after changing a workout, either
queue a device message (above) or delete+recreate+reschedule (new workoutId). Simplest robust policy for our
platform: treat Garmin workouts as immutable — on plan edit, create a new workout, schedule it, unschedule+delete the
old one, store the new ids.

---

## 6. SYNC STRATEGY for Workers

### 6.1 Cadence (no webhooks on personal paths)
- **Activities**: cron every 10 min. Cheap gate first (unofficial): `GET /wellness-service/wellness/syncTimestamp`;
  only if it changed since last run (or every 60 min regardless) fetch page 1 of the activity list
  (`limit=20`). With only the Personal API, just poll page 1 every 15 min (≈100 calls/day — modest).
- **Wellness**: twice in the morning after the user's usual wake time (sleep, HRV, readiness, RHR, body battery are
  finalised after wake + sync), once mid-day, once late evening for daily summary; always re-fetch *yesterday* and
  *today* (values fill in late).
- **Physiology** (VO2max, LT, FTP, zones, training status): once daily.
- **Token upkeep**: daily cron refreshes the DI token (keeps refresh token rolling) and re-exchanges the Personal API
  bearer; also refresh lazily when `exp < now + 15 min`.
- **Etiquette**: one request in flight at a time to Garmin, ≥300–500 ms between calls, exponential backoff with
  jitter on 429/5xx (start 30 s, cap 1 h), honour `Retry-After` if present (often absent). Never retry 4xx other than
  401(once after refresh)/429. Use a single global "garmin_backoff_until" in D1 consulted by all jobs. If you see SSO
  429/427 or connectapi 403 bursts, stop everything for hours, not minutes.

### 6.2 Incremental sync
- Watermark: `max(beginTimestamp)` seen + set of `activityId`s from the last 14 days. Each poll: fetch list pages until
  an item's `beginTimestamp` < watermark − 2 days (overlap handles late uploads from devices that sync days later).
- New activity → enqueue `{activityId}` to a **Queue**; consumer does: `GET /activity-service/activity/{id}` (summary
  JSON, store raw), `GET /download-service/files/activity/{id}` (ZIP→FIT to R2, parse), optional `/exerciseSets` for
  strength, `/hrTimeInZones` if not in summary. ~3 subrequests per activity.
- Idempotency: `activityId` is the natural key (`INSERT … ON CONFLICT(activity_id) DO UPDATE`). For writes, store our
  own `planned_session_id → garmin_workout_id, garmin_schedule_id`; before creating, look up the mapping; tag the
  Garmin `workoutName`/`description` with a short id suffix (e.g. `[tp:abc123]`) so we can re-associate after a crash
  between "create" and "store id" (list `/workout-service/workouts?myWorkoutsOnly=true&orderBy=UPDATE_DATE` and match).

### 6.3 Backfill
- Page the list with `limit=100` from `start=0` until empty (or until the desired start date). Store summaries first
  (cheap), then enqueue FIT downloads at a throttled rate (e.g. Queue with `max_batch_size=5`, consumer sleeps 1–2 s
  per item, `max_concurrency=1`). 1,000 activities ≈ 10 list calls + 1,000 FIT downloads ≈ a few hours at gentle pace.
- Workers limits to respect (check current docs; numbers here are UNVERIFIED as of 2026): free plan 50 subrequests per
  invocation; paid plan ≥1,000 (configurable); CPU time per invocation default 30 s (paid, configurable up to minutes).
  A cron invocation should do at most one list page + enqueue work; never loop a whole backfill in one invocation.
- **Workflows** are a good fit for backfill: one step per list page / per batch of 10 activities, `step.sleep()` between
  batches, durable retries, resumable after errors.
- Wellness backfill: use range endpoints (HRV range, sleep stats ≤28 days per call, RHR up to ~1 year per call,
  `v2/dailysummaries` range, body battery range).

### 6.4 Detecting edits and deletes
- No change feed. On each poll, re-fetch the list for a rolling **14-day** window and compare a hash of
  `{activityName, activityType.typeKey, distance, duration, calories, manualActivity, description}`; on change,
  re-fetch the detail (`metadataDTO.lastUpdateDate` confirms).
- Deletes: an id present in our DB within the window but absent from the list → `GET /activity-service/activity/{id}`;
  404 ⇒ mark deleted (soft delete). Weekly job: reconcile 90 days. Monthly: reconcile all-time by paging ids only.
- Trimmed / type-changed activities change the summary and FIT; re-download FIT when `lastUpdateDate` changes.

### 6.5 Workout calendar reconciliation
- Our platform is the source of truth for plans. Nightly: `GET /workout-service/schedule/workoutScheduleByPeriod` (or
  calendar months for the next 4 weeks; remember 0-based month) and compare to our mapping: missing → reschedule;
  extra Garmin-scheduled items created by us (tagged) but deleted in our plan → unschedule; untagged items (user's own
  or Garmin Coach) → import read-only.

### 6.6 Linking a completed activity to a planned workout
1. Strong link: activity `workoutId` (list) / `metadataDTO.associatedWorkoutId` (detail) / **[P]**
   `/activity-service/activity/{id}/workouts` equals a `garmin_workout_id` we created → link. Also FIT `workout`
   message `wkt_name` contains our tag. (Fixture caveat: in the sanitized garth cassette `workoutId` equals `deviceId`,
   so verify these fields on real data.)
2. Weak link: same local calendar date as a planned session, same sport family, duration/distance within ±30 %.
3. Show Garmin's `directWorkoutComplianceScore` (0–100) when present; compute our own compliance from FIT laps vs steps
   (`/activity-service/activity/{id}/stepdetails` gives per-step results).

---

## 7. Alternatives / fallbacks

**Manual FIT/TCX/GPX upload.** Always provide an upload endpoint in our app (FIT preferred) that parses with
`@garmin/fitsdk` and dedups by FIT `file_id` (serial + time_created) and start time. This is the zero-dependency path
when all Garmin access fails, and also the recovery path for history. Garmin Connect lets the user export single
activities ("Export Original") from the web UI.

**Garmin bulk export (account data request).** Garmin's privacy "Export Your Data" produces a ZIP (days later) with
all original FIT files plus JSON for wellness. Ideal one-shot history backfill: user uploads the ZIP to R2, a Workflow
unpacks and imports. No API risk at all. (Exact ZIP layout UNVERIFIED; build the importer against a real export.)

**Strava API.** Official OAuth2, stable, webhooks (push events for create/update/delete) — attractive for change
detection. But: it only has what Garmin auto-uploads to Strava; no Garmin-specific metrics (training effect, load,
HRV, sleep, readiness); no original FIT (streams only, downsampled); rate limits (~100 req/15 min, 1,000/day read
class — check current numbers); Strava cannot write workouts to Garmin; restrictive API agreement. Possible use: as a
webhook "doorbell" that triggers our Garmin poll. Not a replacement.

**intervals.icu as a bridge.** intervals.icu has an *official* Garmin partnership: it receives Garmin activities via
Garmin's push API and can upload planned workouts to the Garmin Connect calendar (user enables "upload planned
workouts" on the Garmin connection). Its own API is open to individuals (API key, Basic auth `API_KEY:<key>`;
events via `/api/v1/athlete/{id}/events`, bulk upsert `/events/bulk?upsert=true`; activities incl. original FIT).
This is the **saner path for writes** if the unofficial workout API breaks: our platform → intervals.icu events (in
their workout text/JSON format) → Garmin calendar → watch, all on sanctioned rails. Costs: a third-party dependency,
their workout-format translation, sync latency, and intervals.icu only pushes workouts it could parse into structured
steps. Recommend implementing it as the second write transport behind the same interface.

---

## 8. Risks / ToS

The unofficial API is not a public interface: Garmin's Connect terms prohibit automated access outside sanctioned
APIs, and it can change or block without notice (as in March 2026), so the integration must degrade gracefully and
keep manual upload and the official Personal API as fallbacks. Accessing *your own* data on *your own* account at
human-like volumes is low-risk in practice, but credentials/tokens are full-account secrets (the DI refresh token
grants persistent access): encrypt at rest, never log them, and offer a "disconnect" that deletes them (logout does
not revoke tokens server-side; revoke via Garmin account security settings). The official Personal API terms restrict
the key to personal use by the account owner, which matches a single-user self-hosted platform; do not share the
deployment with other users on the same key.

---

## 9. Mock server spec (Miniflare, offline)

Implement a fake Garmin as a Worker (or a `fetch` stub injected into the client) that routes by host+path. All
responses `application/json` unless noted. Enforce `Authorization: Bearer mock-*` (401 otherwise) so token handling is
exercised. Provide a control endpoint (`POST /__mock/scenario`) to switch scenarios: `ok`, `expired_token` (first call
401 then OK after refresh), `rate_limited` (429), `sso_blocked` (429/427 HTML), `mfa_required`, `deleted_activity`
(404), `refresh_invalid` (400 `{"error":"invalid_grant"}`).

### 9.1 Endpoints to emulate (minimum)

| Host | Method + path | Behaviour |
|---|---|---|
| personal.connectapi | `POST /personalapitoken-service/personal-api/personal-api-key/token` | header `Authorization: ApiKey good-key` → 200 text JWT (`header.payload.sig` with base64url payload `{"exp": now+86400}`); else 401 |
| personal.connectapi & connectapi | `GET /activitylist-service/activities/search/activities` | honour `start`, `limit`, `startDate`, `endDate`, `activityType`; newest first; `[]` past the end |
| both | `GET /activity-service/activity/{id}` | detail (§9.3) or 404 |
| both | `GET /download-service/files/activity/{id}` | `application/zip` containing `{id}_ACTIVITY.fit` (commit a small real FIT test file, e.g. garth's `tests/12129115726_ACTIVITY.fit`, or generate one with `@garmin/fitsdk` Encoder) |
| both | `GET /activity-service/activity/{id}/workouts` | `[]` or `[{workoutId, workoutName}]` (UNVERIFIED shape) |
| connectapi | `GET /activity-service/activity/{id}/details` | §9.4 |
| connectapi | `GET /activity-service/activity/{id}/splits`, `/hrTimeInZones`, `/exerciseSets` | small fixtures |
| both | `GET /hrv-service/hrv/{date}`, sleep (both paths), `/metrics-service/metrics/trainingreadiness/{date}`, `/usersummary-service/usersummary/daily/{dn}`, `/userprofile-service/userprofile/user-settings`, `/userprofile-service/socialProfile` | fixtures from §4 field lists |
| connectapi | `GET /wellness-service/wellness/syncTimestamp` | `"2026-11-21T07:12:44.0"` (string; exact format UNVERIFIED) |
| connectapi | `POST /workout-service/workout` | validate required fields (`workoutName`, `sportType.sportTypeId`, `workoutSegments[].workoutSteps[].type`, ids in enums); assign `workoutId` (incrementing), `stepId`s, `ownerId`, `createdDate`; echo back |
| connectapi | `GET/PUT/DELETE /workout-service/workout/{id}` | store in memory; PUT requires `workoutId` in body |
| connectapi | `GET /workout-service/workout/types` | enums from §5.2 |
| connectapi | `POST /workout-service/schedule/{workoutId}` | body `{"date"}` → `{"workoutScheduleId": n, "workout": {...}, "calendarDate": date}` |
| connectapi | `DELETE /workout-service/schedule/{scheduleId}` | 204 |
| connectapi | `GET /calendar-service/year/{y}/month/{m0}` | `{"year":y,"month":m0,"calendarItems":[{"id":n,"itemType":"workout","date":"...","title":"...","workoutId":n}]}` |
| connectapi | `POST /device-service/devicemessage/messages` | array body required (object → 500) |
| diauth | `POST /di-oauth2-service/oauth/token` | `grant_type=refresh_token` with known refresh token → `{"access_token":"mock-<jwt>","refresh_token":"r2","token_type":"Bearer","expires_in":86400}` and invalidate the old refresh token (tests rotation); service-ticket grant → same |
| sso | `GET /mobile/sso/en_US/sign-in`, `POST /mobile/api/login`, `POST /mobile/api/mfa/verifyCode` | set a `SESSION` cookie on GET; POST without it → 429; JSON responses per §2.2 |

### 9.2 Sample activity-list items

Run — real item from garth's recorded cassette (`tests/data/cassettes/test_activity_list.yaml`), trimmed of PII/`userRoles`:
```json
{
  "activityId": 21482825013, "activityName": "Cuajimalpa de Morelos - Base",
  "startTimeLocal": "2026-01-08 08:10:21", "startTimeGMT": "2026-01-08 14:10:21",
  "activityType": {"typeId": 6, "typeKey": "trail_running", "parentTypeId": 1, "isHidden": false, "restricted": false, "trimmable": true},
  "eventType": {"typeId": 9, "typeKey": "uncategorized", "sortOrder": 10},
  "distance": 4261.18994140625, "duration": 2223.326904296875, "elapsedDuration": 2225.44091796875, "movingDuration": 2216.0,
  "elevationGain": 151.0, "elevationLoss": 147.0, "averageSpeed": 1.9170000553131106, "maxSpeed": 2.76200008392334,
  "startLatitude": 19.312051674351096, "startLongitude": -99.31236407719553, "hasPolyline": true, "hasImages": false,
  "ownerId": 2591602, "calories": 390.0, "bmrCalories": 55.0, "averageHR": 142.0, "maxHR": 162.0,
  "averageRunningCadenceInStepsPerMinute": 111.734375, "maxRunningCadenceInStepsPerMinute": 184.0, "steps": 5310,
  "privacy": {"typeId": 2, "typeKey": "private"}, "userPro": false, "hasVideo": false, "timeZoneId": 150,
  "beginTimestamp": 1767881421000, "sportTypeId": 1, "avgPower": 194.0, "maxPower": 587.0,
  "aerobicTrainingEffect": 2.700000047683716, "anaerobicTrainingEffect": 0.0, "normPower": 226.0,
  "avgVerticalOscillation": 7.95, "avgGroundContactTime": 338.29998779296875, "avgStrideLength": 82.47999877929688,
  "vO2MaxValue": 45.0, "avgVerticalRatio": 9.770000457763672, "workoutId": 3618356072, "deviceId": 3618356072,
  "minTemperature": 17.0, "maxTemperature": 24.0, "minElevation": 2999.800048828125, "maxElevation": 3145.39990234375,
  "maxDoubleCadence": 184.0, "maxVerticalSpeed": 0.8000488281250001, "manufacturer": "GARMIN",
  "locationName": "Cuajimalpa de Morelos", "lapCount": 2, "endLatitude": 19.311103597283363, "endLongitude": -99.31316941045225,
  "waterEstimated": 382.0, "trainingEffectLabel": "AEROBIC_BASE", "activityTrainingLoad": 50.886444091796875,
  "minActivityLapDuration": 3.3269999027252197, "aerobicTrainingEffectMessage": "MAINTAINING_AEROBIC_BASE_7",
  "anaerobicTrainingEffectMessage": "NO_ANAEROBIC_BENEFIT_0",
  "splitSummaries": [{"noOfSplits": 1, "totalAscent": 151.0, "duration": 2223.326904296875, "splitType": "INTERVAL_ACTIVE", "numClimbSends": 0, "maxElevationGain": 151.0, "averageElevationGain": 151.0, "maxDistance": 4261, "distance": 4261.18994140625, "averageSpeed": 1.9170000553131104, "maxSpeed": 2.76200008392334, "numFalls": 0, "elevationLoss": 147.0}],
  "hasSplits": true, "moderateIntensityMinutes": 1, "vigorousIntensityMinutes": 35, "avgGradeAdjustedSpeed": 2.2239999771118164,
  "differenceBodyBattery": -9, "hasHeatMap": false, "fastestSplit_1000": 395.3139953613281, "fastestSplit_1609": 664.5800170898438,
  "hrTimeInZone_1": 376.545, "hrTimeInZone_2": 1601.888, "hrTimeInZone_3": 233.231, "hrTimeInZone_4": 10.999, "hrTimeInZone_5": 0.0,
  "powerTimeInZone_1": 518.883, "powerTimeInZone_2": 93.008, "powerTimeInZone_3": 40.999, "powerTimeInZone_4": 73.002, "powerTimeInZone_5": 39.998,
  "endTimeGMT": "2026-01-08 14:47:26", "qualifyingDive": false, "autoCalcCalories": false, "favorite": false, "decoDive": false,
  "elevationCorrected": false, "atpActivity": false, "purposeful": false, "manualActivity": false, "pr": false, "parent": false
}
```

Ride with power — **synthesized**: field names from `@gooin/garmin-connect` `IActivity` type and the run fixture;
values illustrative (no recorded ride exists in the library fixtures):
```json
{
  "activityId": 21500000001, "activityName": "Sweet spot 4x8",
  "startTimeLocal": "2026-01-10 07:02:11", "startTimeGMT": "2026-01-10 13:02:11",
  "activityType": {"typeId": 10, "typeKey": "road_biking", "parentTypeId": 2, "isHidden": false, "restricted": false, "trimmable": true},
  "eventType": {"typeId": 9, "typeKey": "uncategorized", "sortOrder": 10},
  "distance": 61234.5, "duration": 7260.2, "elapsedDuration": 7590.0, "movingDuration": 7201.0,
  "elevationGain": 612.0, "elevationLoss": 605.0, "averageSpeed": 8.434, "maxSpeed": 17.9,
  "calories": 1450.0, "bmrCalories": 160.0, "averageHR": 141.0, "maxHR": 171.0,
  "averageBikingCadenceInRevPerMinute": 88.0, "maxBikingCadenceInRevPerMinute": 117.0,
  "beginTimestamp": 1768050131000, "sportTypeId": 2,
  "avgPower": 212.0, "maxPower": 812.0, "normPower": 236.0, "max20MinPower": 262.0,
  "maxAvgPower_1": 812, "maxAvgPower_5": 720, "maxAvgPower_60": 402, "maxAvgPower_300": 284, "maxAvgPower_1200": 262, "maxAvgPower_3600": 238,
  "leftBalance": 49.0, "rightBalance": 51.0, "avgLeftBalance": 49.2,
  "trainingStressScore": 112.4, "intensityFactor": 0.84, "maxFtp": 280,
  "aerobicTrainingEffect": 3.6, "anaerobicTrainingEffect": 1.2, "trainingEffectLabel": "TEMPO", "activityTrainingLoad": 168.2,
  "vO2MaxValue": 54.0, "workoutId": 1300000001, "deviceId": 3618356072, "manufacturer": "GARMIN", "lapCount": 11,
  "hrTimeInZone_1": 900.0, "hrTimeInZone_2": 2400.0, "hrTimeInZone_3": 2900.0, "hrTimeInZone_4": 1000.0, "hrTimeInZone_5": 60.0,
  "powerTimeInZone_1": 1500.0, "powerTimeInZone_2": 1700.0, "powerTimeInZone_3": 2100.0, "powerTimeInZone_4": 1900.0, "powerTimeInZone_5": 60.0,
  "endTimeGMT": "2026-01-10 15:08:41", "manualActivity": false, "parent": false
}
```
(typeId 10 / parent 2 for `road_biking`/`cycling` is UNVERIFIED.)

Pool swim — **synthesized** from the real open-water fixture (`open_water_swimming`, typeId 28, parent 26,
`sportTypeId` 5) plus pool fields from `IActivity` (`poolLength`, `unitOfPoolLength`, `activeLengths`, `avgStrokes`;
their encoding is UNVERIFIED):
```json
{
  "activityId": 21500000002, "activityName": "Pool Swim",
  "startTimeLocal": "2026-01-11 06:30:05", "startTimeGMT": "2026-01-11 12:30:05",
  "activityType": {"typeId": 27, "typeKey": "lap_swimming", "parentTypeId": 26, "isHidden": false, "restricted": false, "trimmable": true},
  "eventType": {"typeId": 9, "typeKey": "uncategorized", "sortOrder": 10},
  "distance": 2500.0, "duration": 2950.4, "elapsedDuration": 3302.0, "movingDuration": 2830.0,
  "averageSpeed": 0.847, "maxSpeed": 1.21, "calories": 512.0, "bmrCalories": 45.0, "averageHR": 128.0, "maxHR": 156.0,
  "averageSwimCadenceInStrokesPerMinute": 28.0, "maxSwimCadenceInStrokesPerMinute": 41.0,
  "averageSwolf": 39.0, "strokes": 1650.0, "avgStrokes": 16.5, "minStrokes": 13.0, "activeLengths": 100,
  "avgStrokeDistance": 1.52,
  "poolLength": 2500.0, "unitOfPoolLength": {"unitId": 1, "unitKey": "meter", "factor": 100.0},
  "beginTimestamp": 1768134605000, "sportTypeId": 5,
  "aerobicTrainingEffect": 2.9, "anaerobicTrainingEffect": 0.9, "trainingEffectLabel": "AEROBIC_BASE", "activityTrainingLoad": 61.0,
  "deviceId": 3618356072, "manufacturer": "GARMIN", "lapCount": 14, "hasPolyline": false,
  "hrTimeInZone_1": 600.0, "hrTimeInZone_2": 1500.0, "hrTimeInZone_3": 700.0, "hrTimeInZone_4": 30.0, "hrTimeInZone_5": 0.0,
  "endTimeGMT": "2026-01-11 13:25:07", "manualActivity": false, "parent": false
}
```
Real open-water swim swim-specific fields (recorded): `"averageSwimCadenceInStrokesPerMinute": 23.0, "maxSwimCadenceInStrokesPerMinute": 46.0, "averageSwolf": 47.0, "strokes": 106.0, "avgStrokeDistance": 248.00000190734863` — note `avgStrokeDistance` 248 here is in **cm**.

### 9.3 Activity detail excerpt (real, garth `test_activity_get.yaml`, trimmed)
```json
{
  "activityId": 21482825013, "activityUUID": {"uuid": "44fa794a-5bd9-4fbc-927e-7677ab38b5fe"},
  "activityName": "Cuajimalpa de Morelos - Base", "userProfileId": 2591602, "isMultiSportParent": false,
  "activityTypeDTO": {"typeId": 6, "typeKey": "trail_running", "parentTypeId": 1, "isHidden": false, "restricted": false, "trimmable": true},
  "eventTypeDTO": {"typeId": 9, "typeKey": "uncategorized", "sortOrder": 10},
  "accessControlRuleDTO": {"typeId": 2, "typeKey": "private"},
  "timeZoneUnitDTO": {"unitId": 150, "unitKey": "America/Costa_Rica", "factor": 0.0, "timeZone": "America/Costa_Rica"},
  "metadataDTO": {"isOriginal": true, "fileFormat": {"formatId": 7, "formatKey": "fit"},
    "lastUpdateDate": "2026-01-08T15:15:04.0", "uploadedDate": "2026-01-08T15:15:03.0",
    "hasPolyline": true, "hasChartData": true, "hasHrTimeInZones": true, "hasPowerTimeInZones": true,
    "childIds": [], "childActivityTypes": [], "manufacturer": "GARMIN", "lapCount": 2, "associatedWorkoutId": 3618356072,
    "deviceMetaDataDTO": {"deviceId": "3618356072", "deviceTypePk": 37229, "deviceVersionPk": 1003399},
    "hasSplits": true, "personalRecord": false, "manualActivity": false, "trimmed": false, "favorite": false},
  "summaryDTO": {"startTimeLocal": "2026-01-08T08:10:21.0", "startTimeGMT": "2026-01-08T14:10:21.0",
    "distance": 4261.19, "duration": 2223.327, "movingDuration": 2216.0, "elapsedDuration": 2225.441,
    "elevationGain": 151.0, "elevationLoss": 147.0, "averageSpeed": 1.9170000553131106, "averageMovingSpeed": 1.9229196486490299,
    "maxSpeed": 2.76200008392334, "calories": 390.0, "bmrCalories": 55.0, "averageHR": 142.0, "maxHR": 162.0, "minHR": 122.0,
    "averageRunCadence": 111.734375, "maxRunCadence": 184.0, "averagePower": 194.0, "maxPower": 587.0, "normalizedPower": 226.0,
    "totalWork": 103.10213316404219, "trainingEffect": 2.700000047683716, "anaerobicTrainingEffect": 0.0,
    "trainingEffectLabel": "AEROBIC_BASE", "activityTrainingLoad": 50.886444091796875,
    "directWorkoutFeel": 25, "directWorkoutRpe": 30, "directWorkoutComplianceScore": 92,
    "moderateIntensityMinutes": 1, "vigorousIntensityMinutes": 35, "steps": 5310, "differenceBodyBattery": -9, "impactLoad": 4890.0},
  "locationName": "Cuajimalpa de Morelos"
}
```

### 9.4 Details payload excerpt (structure VERIFIED; descriptor keys beyond `sumDistance`/`directHeartRate`/`sum*Duration` and unit objects UNVERIFIED)
```json
{
  "activityId": 21482825013, "measurementCount": 6, "metricsCount": 3, "detailsAvailable": true,
  "metricDescriptors": [
    {"metricsIndex": 0, "key": "directTimestamp", "unit": {"id": 120, "key": "gmt", "factor": 0.0}},
    {"metricsIndex": 1, "key": "sumDistance", "unit": {"id": 1, "key": "meter", "factor": 100.0}},
    {"metricsIndex": 2, "key": "directSpeed", "unit": {"id": 20, "key": "mps", "factor": 10.0}},
    {"metricsIndex": 3, "key": "sumDuration", "unit": {"id": 40, "key": "second", "factor": 1000.0}},
    {"metricsIndex": 4, "key": "directHeartRate", "unit": {"id": 100, "key": "bpm", "factor": 1.0}},
    {"metricsIndex": 5, "key": "directPower", "unit": {"id": 30, "key": "watt", "factor": 1.0}}
  ],
  "activityDetailMetrics": [
    {"metrics": [1767881421000.0, 0.0, 0.0, 0.0, 122.0, null]},
    {"metrics": [1767881422000.0, 1.9, 1.9, 1.0, 123.0, 180.0]},
    {"metrics": [1767881423000.0, 3.9, 2.0, 2.0, 125.0, 205.0]}
  ],
  "geoPolylineDTO": {"minLat": 19.31, "maxLat": 19.32, "minLon": -99.32, "maxLon": -99.31,
    "startPoint": {"lat": 19.312051674351096, "lon": -99.31236407719553, "altitude": null, "time": 1767881421000, "timerStart": false, "timerStop": false, "distanceFromPreviousPoint": null, "distanceInMeters": null, "speed": 0.0, "cumulativeAscent": null, "cumulativeDescent": null, "extendedCoordinate": false, "valid": true},
    "endPoint": {"lat": 19.311103597283363, "lon": -99.31316941045225, "altitude": null, "time": 1767883646000, "timerStart": false, "timerStop": false, "distanceFromPreviousPoint": null, "distanceInMeters": null, "speed": 0.0, "cumulativeAscent": null, "cumulativeDescent": null, "extendedCoordinate": false, "valid": true},
    "polyline": []},
  "heartRateDTOs": null, "pendingData": null
}
```
Client code must map by `metricsIndex`, tolerate shorter `metrics` arrays and `null`s, and keep `sumDuration`,
`sumElapsedDuration`, `sumMovingDuration` distinct.

### 9.5 Other real fixtures worth copying into tests
- HRV (`/hrv-service/hrv/2023-07-20`): `{"userProfilePk":2591602,"hrvSummary":{"calendarDate":"2023-07-20","weeklyAvg":39,"lastNightAvg":42,"lastNight5MinHigh":66,"baseline":{"lowUpper":36,"balancedLow":39,"balancedUpper":52,"markerValue":0.25},"status":"BALANCED","feedbackPhrase":"HRV_BALANCED_7","createTimeStamp":"2023-07-20T12:14:11.898"},"hrvReadings":[{"hrvValue":54,"readingTimeGMT":"2023-07-20T05:29:48.0","readingTimeLocal":"2023-07-19T23:29:48.0"}]}`
- Training readiness (`/metrics-service/metrics/trainingreadiness/2025-07-07`): array; first item `{"userProfilePK":2591602,"calendarDate":"2025-07-07","timestamp":"2025-07-08T03:50:17.0","timestampLocal":"2025-07-07T21:50:17.0","deviceId":3469703076,"level":"MODERATE","feedbackLong":"MOD_RT_MOD_SS_GOOD_WORKOUT_COMPLETED","feedbackShort":"RECOVERY_IN_PROGRESS","score":50,"sleepScore":83,"sleepScoreFactorPercent":76,"recoveryTime":2004,"recoveryTimeFactorPercent":45,"acwrFactorPercent":70,"acuteLoad":583,"stressHistoryFactorPercent":84,"hrvFactorPercent":99,"hrvWeeklyAverage":42,"sleepHistoryFactorPercent":80,"validSleep":true,"inputContext":"UPDATE_REALTIME_VARIABLES","primaryActivityTracker":true}`
- Legacy token exchange response: `{"scope":"... CONNECT_READ CONNECT_WRITE ...","jti":"...","access_token":"...","token_type":"Bearer","refresh_token":"...","expires_in":107182,"refresh_token_expires_in":2591999}`
- SSO login: `{"serviceTicketId":"ST-097904-maMLPBSRdODkj7WJmO8o-sso","responseStatus":{"type":"SUCCESSFUL"},"customerMfaInfo":null}` and MFA variant `{"serviceTicketId":null,"responseStatus":{"type":"MFA_REQUIRED"},"customerMfaInfo":{"mfaLastMethodUsed":"email"}}`.
- Source files (MIT): garth repo `tests/data/cassettes/*.yaml` (activity list/get/pagination incl. an open-water swim and a SUP item; sleep, HRV, readiness, body battery, weight, daily summary), `tests/cassettes/*.yaml` (SSO/MFA/exchange), `tests/12129115726_ACTIVITY.fit` (real FIT file). python-garminconnect `test_data/sample_workout.json` (a stored workout with `stepId`s, `childStepId`, repeat groups).

---

## 10. Client implementation checklist (TypeScript)

- `GarminTransport` interface: `request(method, path, {query, json, body, accept})` with implementations
  `PersonalApiTransport` (personal host), `ConnectApiTransport` (DI bearer + native headers), `BridgeTransport`
  (home helper) and `MockTransport`.
- Parse timestamps: list `"YYYY-MM-DD HH:mm:ss"`, detail `"YYYY-MM-DDTHH:mm:ss.0"`, both without zone → `GMT` fields are
  UTC, `Local` fields are wall-clock in `timeZoneUnitDTO.timeZone`. Prefer `beginTimestamp` (ms).
- IDs are integers up to ~2.2e10 — safe as JS numbers, store as INTEGER in D1.
- Units: distance m, speed m/s, duration s, weight g (user settings/weight service), stroke distance cm in list,
  `lactateThresholdSpeed` scaled (verify), pace targets m/s.
- Dates for wellness: compute "today" in the profile timezone.
- 204 → empty; 404 on activity → deleted; 401 → refresh+retry once; 403 → stop & flag "blocked?"; 429/427 → global backoff.
- Never log tokens, tickets (`ST-…` in URLs), cookies or the Personal API key.

---

## 11. Open questions to resolve with a real account (first spike, in order)

1. From a deployed Worker: Personal API token exchange + activity list + FIT download (expected to work).
2. From a deployed Worker with a pasted DI token: `GET connectapi …/socialProfile`, then a `diauth` refresh.
   If either is blocked (403/429/HTML), switch writes to BridgeTransport or intervals.icu.
3. DI `access_token` `exp` and whether `refresh_token` rotates / its lifetime (decode JWTs, log `expires_in` fields).
4. Upload example C (swim), GET it back, diff fields (pool length, stroke/equipment ids, rest step).
5. Schedule response field name for the schedule id; calendar item fields for workouts (`workoutId`?).
6. `workoutId`/`associatedWorkoutId` on an activity executed from a scheduled workout we created.
7. One in-Worker SSO mobile login attempt (single try) to record how it is blocked.
