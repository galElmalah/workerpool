# Training Metrics Engine: Research Specification

Status: research spec, version 1, 2026-11-21
Audience: the engineer building the pure-TypeScript metrics engine, and the architect.
Scope: one multi-sport athlete (cycling, running, swimming, rowing, strength, hiking, yoga, other).

This document defines every formula the engine needs: per-workout load, the longitudinal fitness/fatigue model, zones, peak curves and performance models, threshold history, wellness signals, defaults, and test vectors (Appendix A). The test vectors were computed with a reference script; values are given to 4 decimals unless stated.

Conventions used throughout:

- **UNVERIFIED** marks a value or rule I could not confirm against a primary or authoritative source. Treat these as engineering defaults that must stay configurable.
- **DECISION** marks a choice the architect must make or confirm.
- "Ours" marks a rule this spec defines where no canonical rule exists (for example gap handling). It is deterministic so it can be tested, but it is not an industry standard.

How the formulas were verified: WebFetch could not reach `help.trainingpeaks.com` or `forum.intervals.icu` from this sandbox (DNS blocked). The following were therefore used:
1. **The GoldenCheetah source code** (cloned from GitHub, files `src/Metrics/Coggan.cpp`, `PMCData.cpp`, `TRIMPPoints.cpp`, `GOVSS.cpp`, `WPrime.cpp`, `AerobicDecoupling.cpp`, `Zones.cpp`, `HrZones.cpp`, `PaceZones.cpp`, `SwimScore.cpp`, `DanielsPoints.cpp`). This was read line by line and is the strongest verification in this document.
2. Web search summaries of TrainingPeaks help and blog articles, intervals.icu forum threads, Concept2, and published papers.

Where a fact rests only on (2), the document says so.

---

## 0. Naming, units, rounding

### 0.1 Neutral names (trademark avoidance)

TrainingPeaks owns the terms Training Stress Score (TSS), Normalized Power (NP) and Intensity Factor (IF), and uses CTL/ATL/TSB as its Performance Management Chart terms. GoldenCheetah renamed its own implementations for this reason: in its source the metrics are called `BikeStress` (TSS), `IsoPower` (NP) and `BikeIntensity` (IF) (verified in `Coggan.cpp`). intervals.icu uses Load / Fitness / Fatigue / Form.

| Our UI name | Short | Code identifier | Equivalent to |
|---|---|---|---|
| Load | Load | `load` | TSS / rTSS / sTSS / hrTSS (the concept: 100 = 1 h at threshold) |
| Power Load | — | `loadPower` | TSS (power based) |
| Pace Load | — | `loadPace` | rTSS (run), sTSS (swim) |
| HR Load | — | `loadHr` | hrTSS / HRSS / TRIMP(100) |
| RPE Load | — | `loadRpe` | sRPE-derived estimate |
| Weighted Power | WP | `weightedPower` | NP |
| Intensity | INT | `intensity` | IF |
| Variability | VAR | `variability` | VI |
| Efficiency | EFF | `efficiency` | EF |
| Decoupling | DEC | `decoupling` | Pw:Hr / Pa:Hr |
| Adjusted Pace / Adjusted Speed | ADJ | `adjustedSpeed` | NGP / GAP |
| Fitness | FIT | `fitness` | CTL |
| Fatigue | FAT | `fatigue` | ATL |
| Form | FORM | `form` | TSB |
| Form % | FORM% | `formPct` | TSB / CTL (intervals.icu "Form %") |
| Ramp | RAMP | `ramp` | CTL ramp rate |
| Threshold Power | FTP | `ftp` | FTP. The term is widely used generically, but showing "Threshold Power" is the safest label. |
| Threshold HR | LTHR | `lthr` | LTHR |
| Threshold Pace | TP | `thresholdSpeed` (stored as speed) | FTPa / rFTPw |
| Critical Swim Speed | CSS | `css` (m/s) | CSS |

Help text may say "comparable to TSS®" once to explain the equivalence. Do not use the marks as labels.

### 0.2 Canonical units (internal)

| Quantity | Internal unit | Display |
|---|---|---|
| time, duration | seconds (float) | h:mm:ss |
| distance | metres | km / mi / m / yd |
| speed | m/s | pace: s/km, s/mi (run); s/100 m, s/100 yd (swim); s/500 m (row); km/h (bike) |
| power | W | W, W/kg |
| HR | bpm | bpm |
| mass | kg | kg / lb |
| elevation | m | m / ft |
| energy (work) | J internally, kJ displayed | kJ |
| load | dimensionless points | integer |
| dates | athlete-local calendar date (`YYYY-MM-DD`) of workout start | — |

**Compute in speed, never in pace.** Pace is an inverse and averages incorrectly. Convert to pace only for display: `pace_s_per_km = 1000 / speed`.

### 0.3 Rounding

- Store full IEEE-754 double precision. Never round stored intermediate values.
- Display: Load to 0 dp; Intensity to 2 dp; WP to 0 dp (W); Fitness, Fatigue and Form to 0 dp in the UI (1 dp in tooltips); Ramp to 1 dp; Form % to 0 dp; W/kg to 2 dp; decoupling to 1 dp (%); pace to whole seconds.
- Rounding mode: half away from zero for display. Note that JS `Math.round` rounds half toward +∞, so -2.5 becomes -2. Use a helper.
- Test tolerance: absolute 1e-3 for the Appendix A values, unless a vector says otherwise.

---

## 1. Stream preparation (shared by all sports)

Every per-workout metric runs on a cleaned 1 Hz series. Implement this once. Two series are derived from it:

- **Active series**: recorded, non-paused samples, concatenated. Used for Load, Intensity, time in zone, averages, and decoupling.
- **Elapsed series**: every second from start to end. Pauses are filled with power 0, speed 0 and HR missing. Used for peak curves (MMP, best efforts) and W′bal, so an "effort" can never bridge a pause.

### 1.1 Resampling algorithm (ours)

Input: samples `(t_i, values)` with `t` in seconds from start, possibly irregular (for example Garmin "smart recording").

1. Sort by `t` and drop duplicate timestamps (keep the last).
2. **Pauses.** If the file has timer stop/start events (FIT `event=timer`), those intervals are pauses. Otherwise any gap `t_{i+1} − t_i > MAX_GAP_S` (default **10 s**) is a pause.
3. For each integer second inside a non-pause region, interpolate each channel linearly between neighbours:
   - power, HR, speed, cadence, altitude: linear interpolation;
   - cumulative distance: linear interpolation (it must stay monotonic; clamp any decrease to the previous value).
4. **Invalid values become missing, then are interpolated if inside a gap of 10 s or less:**
   - power `< 0` or `> 2500 W` (DECISION: spike cap; configurable);
   - HR `< 25` or `> 250` bpm;
   - running speed `> 12 m/s`; swim speed `> 3 m/s`.
5. **Stopped-time removal for Load (cycling and rowing, ours).** A run of at least 60 consecutive seconds with power = 0 *and* (speed < 0.5 m/s or speed absent) is a stop. Remove it from the active series. Shorter zero runs (coasting, traffic lights) are kept. Why: by construction `Load ∝ s·WP² = √(s·Σr⁴)`, so padding a ride with recorded zeros *raises* Load. GoldenCheetah users report exactly this inflation when auto-pause is off. TrainingPeaks probably counts all recorded samples (UNVERIFIED).
6. **Running and walking.** Samples with speed < 0.5 m/s are "stopped". Exclude them from the active series used for Pace Load and moving time.
7. **Swimming.** Use the device's length/lap records: a length with stroke type "rest" or distance 0 is rest. Moving time is the sum of active length durations (see §2.4).

Output: `active: {t[], power?[], hr?[], speed?[], dist?[], alt?[], grade?[]}` with dt = 1 s, `elapsed` (same channels), plus the scalars `movingTime_s` (= active length), `elapsedTime_s` (= last t − first t) and `timerTime_s`.

### 1.2 Data-coverage gate

A load method is *eligible* only if its channel covers at least **80 %** of the active series (non-missing samples / active samples) and its threshold exists for the workout date (§5). Otherwise the cascade (§2.0) moves to the next method.

---

## 2. Per-workout Load

### 2.0 Priority cascade

For every workout, compute `load` and `loadMethod` with the first eligible method:

| Priority | Method | Requires |
|---|---|---|
| 0 | Manual override | user-entered load |
| 1 | Power Load (§2.1) | power stream + FTP for that sport |
| 2 | Pace Load (§2.2 run, §2.4 swim, §2.5 row from pace) | speed/distance + threshold speed |
| 3 | HR Load (§2.6) | HR stream + LTHR, rest HR, max HR |
| 4 | RPE Load (§2.7) | session RPE (0–10) + duration |
| 5 | Duration estimate (§2.8) | duration only; flagged `estimated=true` |

The per-sport order differs. For example, running uses Pace before Power by default. See §7. Always store every computable load (`loadPower`, `loadPace`, `loadHr`, `loadRpe`) alongside the chosen `load` so the UI can show alternatives and the user can switch the method per workout or per sport.

### 2.1 Power-based (cycling; rowing with power; running power if opted in)

#### 2.1.1 Weighted Power (NP algorithm)

Coggan's NP algorithm (Allen & Coggan, *Training and Racing with a Power Meter*), as described by TrainingPeaks and implemented in GoldenCheetah `IsoPower`:

1. Take the active 1 Hz power series `p[0..n−1]`. Recorded zeros are included.
2. Compute the 30 s trailing rolling mean `r_i = (1/30)·Σ_{j=i−29..i} p_j`.
3. Raise each `r_i` to the 4th power.
4. Average those 4th powers.
5. Take the 4th root.

**Warm-up window (ours, following Coggan/Allen).** Use only full windows, i = 29 … n−1, so there are `n − 29` values. Coggan's description starts the rolling average 30 s into the data. GoldenCheetah differs: it zero-pads, emitting a value for every sample from i = 0, with the partial-window sum still divided by 30 (verified in `Coggan.cpp`). That slightly lowers WP on short files. Pin our behaviour with TV-2.

```ts
function weightedPower(p: number[]): number | null {
  const n = p.length;
  if (n < 30) return null;              // caller falls back to mean power
  let s = 0;
  for (let i = 0; i < 30; i++) s += p[i];
  let acc = (s / 30) ** 4, c = 1;
  for (let i = 30; i < n; i++) { s += p[i] - p[i - 30]; acc += (s / 30) ** 4; c++; }
  return (acc / c) ** 0.25;
}
```

- **Fewer than 30 samples:** WP = mean power, flagged `wpFallback=true`.
- **Reliability:** TrainingPeaks advises coaches to disregard NP for durations under about 10 minutes. Show WP for intervals or laps shorter than 10 min greyed out, but still compute it.
- **Irregular sampling:** handled by §1.1. Never run the rolling window over raw irregular samples.
- **Numerical precision:** a running sum over 5 h of data has negligible drift in float64. Optionally recompute the window sum every 3600 samples.

#### 2.1.2 Intensity, Load, and related metrics

- `intensity = WP / FTP` (FTP for this sport valid on the workout date).
- `loadPower = (s × WP × intensity) / (FTP × 3600) × 100 = 100 × (s/3600) × intensity²`, where `s` is the active-series length in seconds. This is the GoldenCheetah `BikeStress` formula: `normWork = NP × secs; rawTSS = normWork × IF; TSS = rawTSS / (FTP × 3600) × 100`.
- `variability = WP / meanPower`, with mean power over the active series and zeros included. Variability is about 1.00 for steady efforts and above 1.05 for variable ones.
- `work_kJ = Σ p_i × 1 s / 1000`. Use the elapsed series, but pauses contribute 0, so the result is the same as using the active series.
- `wPerKg = FTP / bodyMass_kg`, with mass valid on the date (§5). Also compute peak W/kg for MMP points.
- `efficiency = WP / meanHR` for cycling (W/bpm), over the active series with valid HR. The run version is in §2.2.5.
- `loadPerHour = load / (s/3600)`.

#### 2.1.3 Aerobic decoupling (Pw:Hr)

GoldenCheetah `AerobicDecoupling.cpp` (verified):

1. Split the active series at the sample midpoint: `half = floor(n/2)`.
2. In each half, average power and HR over samples where HR > 0: `ratio_k = meanP_k / meanHR_k`.
3. `decoupling_% = 100 × (ratio_1 − ratio_2) / ratio_1`.

Positive values mean HR drifted up relative to power. Friel's guideline is that under 5 % indicates good aerobic endurance. Run decoupling (Pa:Hr) uses speed, or adjusted speed (§2.2), in place of power.

Only show decoupling for steady workouts: duration ≥ 60 min, variability ≤ 1.10 (ours), and HR coverage ≥ 90 %. Otherwise show "n/a".

### 2.2 Running, pace-based (Pace Load, rTSS equivalent)

TrainingPeaks defines rTSS through Normalized Graded Pace (NGP) and functional threshold pace: `IF = NGP / threshold`, and rTSS has the same form as TSS. The exact NGP internals are unpublished (UNVERIFIED). The deterministic model below is ours.

#### 2.2.1 Grade-adjustment model: Minetti 2002

The energy cost of running on gradient `i` (decimal, rise/run) is (Minetti et al. 2002, *J Appl Physiol* 93:1039–1046):

```
Cr(i) = 155.4 i^5 − 30.4 i^4 − 43.3 i^3 + 46.3 i^2 + 19.5 i + 3.6     [J·kg⁻¹·m⁻¹]
```

The same coefficients are hard-coded in GoldenCheetah `GOVSS.cpp` (verified). Flat cost is `Cr(0) = 3.6`.

Grade factor: `f(i) = Cr(i) / 3.6`. Adjusted (graded) speed: `v_adj = v × f(i)`.

Reference values (use as unit tests):

| grade | Cr | f |
|---|---|---|
| −0.20 | 1.800032 | 0.500009 |
| −0.10 | 2.151706 | 0.597696 |
| −0.05 | 2.745924 | 0.762757 |
| 0.00 | 3.600000 | 1.000000 |
| +0.05 | 4.685196 | 1.301443 |
| +0.10 | 5.968214 | 1.657837 |
| +0.20 | 9.006688 | 2.501858 |

**Clamp** the grade to [−0.45, +0.45], Minetti's measured range. Steep descents are known to be over-credited by pure Minetti: the minimum cost is near −20 % at half the flat cost, while real runners braking downhill do not get that benefit. Strava's GAP uses a different, HR-calibrated curve that is unpublished. DECISION (optional): clamp the downhill factor at `f ≥ 0.75`, which a −5.5 % grade reaches. Default: off, pure Minetti.

**Grade computation (ours):**

1. Smooth altitude with a centred 15 s moving average. Prefer barometric altitude. Do not use GPS-only altitude for grade if a DEM-corrected stream is available.
2. Compute `grade_i = (altS[i+5] − altS[i−5]) / (dist[i+5] − dist[i−5])` when the distance delta is at least 10 m. Otherwise reuse the previous grade, or 0 at the start.
3. Clamp the result.
4. Treadmill: grade = device-reported incline if present, else 0.

#### 2.2.2 Adjusted Speed (NGP analogue) and Pace Load

1. Compute `v_adj` per active-series sample (stopped samples were already excluded in §1.1).
2. **Normalized adjusted speed:** run the same 30 s / 4th-power routine as WP (§2.1.1) on `v_adj`. Speed is proportional to metabolic power at a fixed cost, so the NP weighting carries over (UNVERIFIED whether TrainingPeaks applies 4th-power weighting to NGP; this is our choice).
3. `intensity = NS / thresholdSpeed`. Here `thresholdSpeed = 1000 / thresholdPace_s_per_km`. Intensity is a ratio of speeds, so faster gives a higher value.
4. `loadPace = 100 × (s/3600) × intensity²`.

Display "Adjusted Pace" = `1000 / NS` s/km.

#### 2.2.3 Threshold pace

- **Test:** 30 min solo run time trial. Threshold pace = average pace over the whole 30 min (Friel's test as reported by secondary sources). Some coaches use the last 20 min.
- **From a race:** predict the 60 min distance with Riegel (§4.6): `D60 = D × (3600/T)^(1/1.06)`, then `thresholdSpeed = D60 / 3600`. Example: 5 k in 20:00 gives D60 = 14 095.6 m, i.e. 4:15.4/km (TV-14).
- **Auto from history:** best sustained 40–60 min effort from the pace curve (§4.2) in the last 90 days. If the best effort is shorter (≥ 12 min), convert with Riegel to 60 min.

#### 2.2.4 Running power (Stryd etc.), opt-in

If the athlete sets a running FTP (for example Stryd CP), compute Power Load exactly as in §2.1 with that **run-specific** FTP. Never mix bike and run FTPs. Stryd's own RSS uses a different, steeper formula (UNVERIFIED). Do not try to match it. Run power values differ between vendors (Stryd, Garmin, Coros), so the threshold must come from the same device family. DECISION: running defaults to Pace Load, with Power Load as an opt-in per athlete.

#### 2.2.5 Running efficiency and decoupling

- `efficiencyRun = (NS × 60) / meanHR` in metres per minute per bpm. Friel uses yards/min/bpm; we use metric.
- Decoupling (Pa:Hr): the §2.1.3 algorithm with `v_adj` replacing power.

#### 2.2.6 Daniels-style alternatives (optional)

- **VDOT** (Daniels & Gilbert, *Oxygen Power*, 1979), with `v` in m/min and `t` in min:
  `VO2 = −4.60 + 0.182258 v + 0.000104 v²`
  `%max = 0.8 + 0.1894393 e^(−0.012778 t) + 0.2989558 e^(−0.1932605 t)`
  `VDOT = VO2 / %max`
  Example: 5 k in 20:00 gives VDOT 49.81. Training paces can be derived from VDOT, but that is out of scope for Load.
- **Daniels points:** GoldenCheetah adapts these for power as `points/s = (100/3600)·(P/CP)^4`, assuming VO2max power = 1.2 × CP (verified in `DanielsPoints.cpp`). Not recommended as the default. Listed only as an alternative load scale.

### 2.3 Cycling, hiking, walking

Cycling uses §2.1 (power), then §2.6 (HR). Hiking and walking use §2.6–2.8. Grade-adjusted walking load (for example Minetti's walking polynomial) is out of scope for v1.

### 2.4 Swimming (Swim Load, sTSS equivalent)

#### 2.4.1 Critical Swim Speed

Two-trial CSS test, 400 m and 200 m all-out, with rest between:

```
CSS [m/s] = (400 − 200) / (T400 − T200)          (T in seconds)
CSS pace [s/100 m] = 100 / CSS = (T400 − T200) / 2
```

Validation: require T200 < T400 and 200/T200 > 400/T400 (the 200 must be faster per metre). Otherwise reject the test. Ginn's original version used 50 m and 400 m: `CSS = 350 / (T400 − T50)`. The 200/400 pair tends to give a higher CS than models using longer trials. Alternative test: 1000 m or 1000 yd time trial, threshold = average speed (UNVERIFIED equivalence).

For yards pools, convert to metres (`1 yd = 0.9144 m`) before any computation.

#### 2.4.2 Swim Load

TrainingPeaks: `sTSS = IF³ × hours × 100`. IF is pace relative to threshold swim pace, and it is *not* normalized. Example from TrainingPeaks: 69 m/min ÷ 75 m/min = 0.92.

- `v_swim = totalDistance_m / movingTime_s`. Moving time excludes rest (§1.1 step 7).
- `intensity = v_swim / CSS`.
- `loadPace(swim) = 100 × (movingTime_s / 3600) × intensity³`.

**Rest handling.** TrainingPeaks describes sTSS as using "total moving duration (not including rest periods)". Their worked example uses the workout average pace. Exactly how they treat rest is UNVERIFIED. Our default is moving time for both intensity and duration. DECISION: an "elapsed" option, where intensity = distance / elapsed and hours = elapsed. Rest then lowers intensity, and because of the cubic term this usually lowers Load (TV-7b). Pool swims recorded without length data (only a total) must use elapsed time and be flagged `swimRestUnknown`.

Open water: GPS distance is noisy. Still use Swim Load, but flag the workout. If distance is missing, fall back to HR. Wrist HR in water is unreliable, so drop to HR only if coverage ≥ 80 %, then to RPE.

#### 2.4.3 SwimScore (Skiba; not default)

GoldenCheetah implements Skiba's SwimScore. It converts speed to power through a drag model `P = (K/ep)·v³` (verified in `SwimScore.cpp`), averages with 3rd-power weighting, and normalizes to "STP". It needs body metrics. Documented as an alternative only.

### 2.5 Rowing

Options, ranked:

1. **Power Load from erg power (recommended).** Concept2, RP3 and similar ergs report power. Use §2.1 with a **rowing-specific FTP**. If only pace is recorded on a Concept2, derive power with the Concept2 formula (confirmed on concept2.com's pace-to-watts calculator):
   ```
   P [W] = 2.80 / pace³          where pace = seconds per metre (e.g. 2:00/500 m → 120/500 = 0.24 s/m)
   pace [s/m] = (2.80 / P)^(1/3)
   ```
   Examples: 2:00/500 m gives 202.55 W; 2:05/500 m gives 179.2 W; 1:45/500 m gives 302.34 W. Convert *per second* (speed → pace → power) **before** the NP routine. Do not apply the formula to average pace and then average.
   - **This formula is Concept2-erg-specific.** It does not hold for on-water boats.
2. **On-water with oarlock power (Empower, NK, Peach):** Power Load with a separate *on-water* FTP. DECISION: whether to keep erg and on-water FTP separate. Recommended: yes.
3. **On-water without power:** HR Load (§2.6). Boat pace depends on wind, current, boat class and crew, so pace-based load is not recommended.
4. RPE Load, then duration.

**Rowing FTP default:** best 60 min erg power (or 30 min test power × 0.95, by analogy with cycling, UNVERIFIED). If only a 2 k test exists: `FTP_row ≈ 0.75 × P_2k` (UNVERIFIED heuristic). Rationale: ranking data put typical 60 min erg power at about 70–78 % of 2 k power; for example, a 6:30 2 k is 377.6 W, and 0.75 × 377.6 = 283.2 W, which is a 1:47.3 split.

### 2.6 Heart-rate based (HR Load)

#### 2.6.1 Recommended: HRSS (TRIMP normalized to 1 h at LTHR = 100)

The Banister TRIMP (Banister 1991; Morton et al. 1990):

```
x(HR) = (HR − HRrest) / (HRmax − HRrest)          clamp to [0, 1]
TRIMP_per_min(HR) = x · a · e^(b·x)
male:   a = 0.64, b = 1.92
female: a = 0.86, b = 1.67
```

Sample-wise (per second): `TRIMP = Σ_i (1/60) · x_i · a · e^(b·x_i)` over active samples with valid HR.

Normalization (GoldenCheetah `TRIMP(100) Points`, verified; equivalent to the HRSS used by intervals.icu and Elevate):

```
TRIMP_LT1h = 60 · x_LT · a · e^(b·x_LT),   x_LT = (LTHR − HRrest)/(HRmax − HRrest)
loadHr = 100 · TRIMP / TRIMP_LT1h
```

The prefactor `a` cancels, so only `b` matters. An hour at exactly LTHR gives 100.

- **Use per-sample summation, not average HR.** Because the exponential is convex, using the average under-reads variable sessions: TV-4c gives 69.59 per-sample versus 67.19 with average HR. intervals.icu sums bpm-by-bpm according to its forum (search summary). GoldenCheetah's `TRIMP Points` uses average HR (verified), which is the weaker approach.
- **Sex constant:** use the athlete's profile. DECISION: if "unspecified", default to male constants (b = 1.92), or average them (b = 1.795).
- **HR lag:** HR under-reads short hard efforts. That is a known limitation; no correction is applied.
- **Inputs:** LTHR, HRrest and HRmax per sport, valid on the date (§5).

#### 2.6.2 Alternative: zone-time method (hrTSS-style)

TrainingPeaks hrTSS is "based on time in HR zones derived from LTHR". Its lookup table is not public (UNVERIFIED). Our table assigns points per hour to Friel zones, calibrated against HRSS for a typical athlete (rest 50, max 190, LTHR 170, male, evaluated at zone mid-points), with Z5a anchored to 100:

| Friel zone | Z1 | Z2 | Z3 | Z4 | Z5a | Z5b | Z5c |
|---|---|---|---|---|---|---|---|
| points/hour | 30 | 55 | 70 | 85 | 100 | 120 | 140 |

`loadHrZones = Σ_z (timeInZone_z_s / 3600) × pph_z`. Not the default; provided for users who want to match hrTSS-style behaviour. (Friel's published RPE/zone estimate article gives 50/h for RPE 4 and 70/h for RPE 6; the rest of his table is UNVERIFIED.)

#### 2.6.3 Other TRIMP variants (reported as secondary metrics, not Load)

- **Edwards (1993):** `Σ minutes_in_zone × k` with zones by %HRmax: 50–60 % gives k = 1, 60–70 % k = 2, 70–80 % k = 3, 80–90 % k = 4, 90–100 % k = 5. Below 50 % counts 0.
- **Lucia (1999/2003):** 3 zones. Below VT1: k = 1. VT1–VT2: k = 2. Above VT2: k = 3. Multiply by minutes in zone. Without lab VTs, use the 3-zone mapping in §3.6.
- **Banister raw:** the un-normalized TRIMP above, in arbitrary units.
- **GoldenCheetah zonal TRIMP:** zone weights 0.9/1.1/1.2/2.0/5.0 on Coggan HR zones (verified in `HrZones.cpp`). Informational only.

Default HR fallback: **HRSS (§2.6.1)**.

### 2.7 Session RPE (strength, no-data sessions, or manual)

#### 2.7.1 Foster session-RPE

`sRPE = CR10_RPE × duration_min`, in arbitrary units (AU) (Foster 1998/2001). Duration is the whole session including rests between sets, by definition. RPE is collected about 30 min after the session. Store `sRPE` as its own metric.

#### 2.7.2 Mapping to Load points

Points per hour by RPE. Friel's TrainingPeaks article anchors RPE 4 at 50/h and RPE 6 at 70/h (confirmed in search snippets); the other rows follow his progression and are UNVERIFIED. Intensity equivalent is `√(pph/100)`.

| RPE (CR10) | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| points/hour | 0 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 100 | 120 | 140 |
| equiv. intensity | 0 | 0.45 | 0.55 | 0.63 | 0.71 | 0.77 | 0.84 | 0.89 | 1.00 | 1.10 | 1.18 |

- `loadRpe = pph(RPE) × duration_h`. For non-integer RPE, interpolate linearly between rows.
- Consistency check: 1 h at RPE 8 ("hard, sustained ~1 h effort") = 100, matching the "1 h at threshold = 100" anchor.
- **Strength factor.** DECISION: `strengthLoadFactor`, default **1.0**. Some coaches argue that an hour of lifting at RPE 7 (80 points) overstates its contribution to endurance fatigue. Expose the factor rather than silently scaling.

#### 2.7.3 Strength-specific metrics (separate from Load)

- **Volume load** = `Σ sets × reps × weight_kg`, in kg. Bodyweight exercises: add `bodyMass × fraction` only if the exercise defines a fraction (ours; optional).
- **e1RM:**
  - Epley (1985): `1RM = w × (1 + r/30)`
  - Brzycki (1993): `1RM = w × 36 / (37 − r)`, valid for r < 37. Do not use for r > 10.
  - Default: report Epley for r ≤ 10, and nothing for r > 12. r = 1 gives e1RM = w for Brzycki; Epley gives w × 1.033, so special-case r = 1 to return w.
- Track best e1RM per exercise over time, and weekly volume load per muscle group if tagged.

### 2.8 Duration-only estimate (last resort, `estimated=true`)

Points per hour by sport (ours, UNVERIFIED heuristics; assumes an easy or endurance session):

| Sport | pph | Sport | pph |
|---|---|---|---|
| Cycling | 50 | Strength | 40 |
| Running | 55 | Hiking | 35 |
| Swimming | 50 | Walking | 25 |
| Rowing | 50 | Yoga / mobility | 20 |
| Other | 40 | | |

### 2.9 Planned workouts

#### 2.9.1 Structured plans

Plan model: an ordered list of steps `{duration_s | distance_m, target, repeat?}`. `target` is one of: absolute power, %FTP, absolute speed or pace, %threshold pace, HR, %LTHR, RPE, zone id, or a ramp `{from, to}`.

Algorithm:

1. Expand repeats. Convert distance steps to duration using the target speed.
2. Resolve each step's target to a numeric value at 1 Hz. A range resolves to its midpoint. A ramp interpolates linearly per second. A zone resolves to its midpoint (open-ended top zones use the tables below).
3. Compute per sport:
   - **Power targets:** build the 1 Hz power series and run the *same* `weightedPower` and `loadPower` functions. This is better than `Σ IF²·dt`: TV-17 gives 70.04 versus 59.27.
   - **Run pace targets:** build a speed series (grade 0) and use §2.2.2.
   - **Swim:** `intensity = totalDistance / activeTime / CSS` (rest steps excluded), then cube as in §2.4.2.
   - **HR targets:** sum the per-second HRSS contribution at each target HR (§2.6.1).
   - **RPE targets:** `Σ pph(RPE_step) × dur_h`.
   - **Mixed targets:** compute each step with its own method, but steps of the same type within one workout must share the power/speed series so the 4th-power weighting applies across the whole workout.
4. Store `plannedLoad`, `plannedDuration` and `plannedIntensity`. Recompute them whenever thresholds change (§5).

Zone midpoints for planning (as a fraction of threshold):

- **Coggan power:** Z1 0.45, Z2 0.65, Z3 0.83, Z4 0.98, Z5 1.13, Z6 1.35, Z7 1.60.
- **Friel HR (bike):** Z1 0.75, Z2 0.855, Z3 0.92, Z4 0.97, Z5a 1.015, Z5b 1.05, Z5c 1.09.

The open-ended top values are ours.

#### 2.9.2 Unstructured plans (duration + label)

`plannedLoad = duration_h × 100 × IF_label²`

| Label | session IF | Label | session IF |
|---|---|---|---|
| Recovery | 0.55 | Threshold session (incl. WU/CD) | 0.88 |
| Endurance / easy | 0.68 | VO2max session | 0.87 |
| Long | 0.70 | Anaerobic / sprints | 0.80 |
| Tempo | 0.80 | Race | `clamp((1/h)^0.10, 0.70, 1.05)` |
| Sweet spot | 0.85 | Strength / yoga | use RPE table with the planned RPE |

All UNVERIFIED coaching heuristics. The race formula gives 1.00 at 1 h, 0.93 at 2 h, 0.88 at 3.5 h, and 0.79 at 10 h.

---

## 3. Zones

General rules:

- A zone table is an ascending list of **lower bounds** as fractions of a threshold. Zone k covers `[b_k, b_{k+1})`, and the top zone is open.
- Classify each sample by comparing the raw value to `threshold × b_k`. Do not round before classifying.
- For display, the integer range of zone k is `ceil(T·b_k)` to `ceil(T·b_{k+1}) − 1`.
- Store zone *definitions* as fractions, so they move with the threshold history (§5).

### 3.1 Heart-rate zones

**Friel 7-zone, % LTHR** (Friel's quick guide; confirmed by two secondary sources). Integer-percent ranges are read as half-open intervals:

| Zone | Bike lower bound | Run lower bound | Name |
|---|---|---|---|
| Z1 | 0 | 0 | Recovery |
| Z2 | 0.81 | 0.85 | Aerobic |
| Z3 | 0.90 | 0.90 | Tempo |
| Z4 | 0.94 | 0.95 | Sub-threshold |
| Z5a | 1.00 | 1.00 | Super-threshold |
| Z5b | 1.03 | 1.03 | Aerobic capacity |
| Z5c | 1.07 | 1.07 | Anaerobic capacity |

(Friel publishes Z5b as 103–106 % and Z5c as > 106 %. The half-open reading puts the boundary at 1.07.)

**Coggan 5-zone HR, % LTHR:** L1 < 69 %, L2 69–83 %, L3 84–94 %, L4 95–105 %, L5 ≥ 106 %. Lower bounds are 0, 0.69, 0.84, 0.95, 1.06. GoldenCheetah's defaults are 0/68/83/94/105 (verified in `HrZones.cpp`); the difference is ±1 %.

**% HRmax, 5-zone (common/Edwards):** lower bounds 0.50, 0.60, 0.70, 0.80, 0.90 of HRmax.

**HRR / Karvonen:** `HR_target = HRrest + f × (HRmax − HRrest)`. Use the same five fractions (0.50…0.90) applied to the reserve.

Swimming uses the run table with swim LTHR (DECISION; HR is usually 10–15 bpm lower in water, UNVERIFIED). Rowing has its own zones (§3.5).

### 3.2 Power zones: Coggan 7 levels, % FTP

Lower bounds: **0, 0.55, 0.75, 0.90, 1.05, 1.20, 1.50**. This matches GoldenCheetah `Zones.cpp` defaults (verified) and intervals.icu defaults. Coggan's text reads "≤ 55 %, 56–75 %, …"; the difference is immaterial.

| Level | Name | %FTP |
|---|---|---|
| Z1 | Active Recovery | < 55 |
| Z2 | Endurance | 55–75 |
| Z3 | Tempo | 75–90 |
| Z4 | Threshold | 90–105 |
| Z5 | VO2max | 105–120 |
| Z6 | Anaerobic | 120–150 |
| Z7 | Neuromuscular | ≥ 150 |

Apply the same table to run power (run FTP) and erg power (row FTP) when the athlete prefers %FTP zones.

### 3.3 Running pace zones

**Friel, % of threshold pace** (pace ratio `r = pace / thresholdPace`; larger r is slower). Sources: secondary (the5krunner), consistent with TrainingPeaks. Friel's published ranges overlap at 99–100 %; our boundaries resolve that:

| Zone | Friel published | Our rule on r | Speed fraction (= 1/r) lower bound |
|---|---|---|---|
| Z1 | > 129 % | r > 1.29 | 0 |
| Z2 | 114–129 % | 1.14 < r ≤ 1.29 | 0.7752 |
| Z3 | 106–113 % | 1.06 < r ≤ 1.14 | 0.8772 |
| Z4 | 99–105 % | 1.00 < r ≤ 1.06 | 0.9434 |
| Z5a | 97–100 % | 0.97 < r ≤ 1.00 | 1.0000 |
| Z5b | 90–96 % | 0.90 < r ≤ 0.97 | 1.0309 |
| Z5c | < 90 % | r ≤ 0.90 | 1.1111 |

Implement these as speed lower bounds (the last column; a boundary speed belongs to the faster zone). This gives one uniform zone engine.

**Alternative, Skiba 6-zone in % of critical speed** (GoldenCheetah default, verified): lower bounds **0, 0.80, 0.87, 0.95, 1.05, 1.19**. Names: Active Recovery, Endurance, Tempo, Threshold, VO2max, Anaerobic.

Threshold from a test: see §2.2.3. A 5 k or 10 k result goes through Riegel to the 60 min distance. A 30 min TT gives its average pace.

### 3.4 Swim pace zones from CSS

Skiba swim zones as % of CSS speed (GoldenCheetah `PaceZones.cpp` swim defaults, verified). Lower bounds **0, 0.93, 0.97, 0.99, 1.02, 1.09**, named Active Recovery, Endurance, Tempo, Threshold, VO2max, Anaerobic.

Example: CSS 1:45/100 m is 0.95238 m/s. Z2 starts at 0.8857 m/s (1:52.9/100 m); Z4 spans 0.9429–0.9714 m/s (1:46.1 to 1:42.9 /100 m).

### 3.5 Rowing zones

The UK/GB model has five bands: UT2, UT1, AT, TR, AN. Published %-of-2 k-power tables vary widely. Two schemes were found in search results (calculator and program pages); both are UNVERIFIED.

| Band | Scheme B (**recommended**) % of 2 k avg power | Scheme A % of 2 k power | ≈ % of row FTP (FTP = 0.75 × P2k, scheme B) | HR (% HRmax, UNVERIFIED composite) |
|---|---|---|---|---|
| UT2 | 45–60 | 55–65 | 60–80 | 65–75 |
| UT1 | 60–70 | 65–75 | 80–93 | 75–80 |
| AT | 70–80 | 75–85 | 93–107 | 80–85 |
| TR | 80–105 | 85–95 | 107–140 | 85–95 |
| AN | ≥ 105 | 95–110 | ≥ 140 | 95–100 |

Scheme B is recommended because it is internally consistent with `FTP_row ≈ 0.75 × P2k`: AT then brackets threshold at 93–107 % FTP, as Coggan Z4 does. Lower bounds for the engine: `[0, 0.45, 0.60, 0.70, 0.80, 1.05] × P2k`, plus an implicit "below UT2" band. DECISION: below UT2 can merge into UT2. Convert to splits with `split_500 = 500 × (2.80 / P)^(1/3)`.

### 3.6 Time in zone and intensity distribution

**Time in zone:** `tiz[k] = Σ_{samples in zone k} 1 s` over the active series. HR samples that are missing are not counted. Report seconds and the percentage of the classified total. For a period, sum the per-workout seconds; never average percentages.

**Seiler 3-zone mapping** (threshold-anchored). Zone 1 is below VT1/LT1, zone 2 is between VT1 and VT2, zone 3 is above VT2/LT2. The proxies below are ours, using threshold ≈ LT2:

| Signal | Z1 (< LT1) | Z2 [LT1, LT2) | Z3 (≥ LT2) |
|---|---|---|---|
| Power (%FTP) | < 0.75 | 0.75–1.00 | ≥ 1.00 |
| HR (%LTHR) | < 0.90 (Friel Z1–Z2) | 0.90–1.00 | ≥ 1.00 |
| Run speed (% thr. speed) | < 0.8772 (Friel Z1–Z2) | 0.8772–1.00 | ≥ 1.00 |
| Swim (% CSS) | < 0.93 | 0.93–1.00 | ≥ 1.00 |
| Row (% P2k) | < 0.60 (UT2) | 0.60–0.80 | ≥ 0.80 |

Signal priority per workout is the same as the load cascade (power, then pace, then HR). For a period, sum the seconds.

**Classification of a distribution** with fractions z1 + z2 + z3 = 1, checked in order:

1. **Polarized:** z1 > z3 > z2 and PI > 2.00.
2. **Pyramidal:** z1 > z2 > z3.
3. **Threshold:** z2 > z1 and z2 > z3.
4. **High-intensity:** z3 > z1 and z3 > z2.
5. Otherwise **Mixed** (also used for exact ties).

**Polarization Index** (Treff et al. 2019, *Front Physiol*; formula restated in a 2023 commentary):

```
if 0 < z2 and z3 > 0:  PI = log10( (z1 / z2) × z3 × 100 )
if z2 == 0 and z3 > 0.01: PI = log10( (z1 / 0.01) × (z3 − 0.01) × 100 )
otherwise: PI undefined
```

Zones are fractions, not percentages. PI > 2.00 a.U. means polarized, and only when z1 > z3 > z2 holds.

Examples: (0.80, 0.05, 0.15) gives 2.3802; (0.75, 0.20, 0.05) gives 1.2730 (pyramidal); (0.80, 0, 0.20) gives 3.1818.

---

## 4. Peaks and performance models

### 4.1 Mean-maximal power (MMP) curve

Use the **elapsed** series (§1), so pauses count as zeros and efforts never bridge a pause.

Duration grid (ours, 185 points): 1–60 s every 1 s; 65–300 s every 5 s; 310–1200 s every 10 s; 1230–3600 s every 30 s; 3660–18000 s every 60 s. Durations longer than the workout are omitted.

Algorithm (O(n × |grid|); a 5 h ride is about 3.3 M operations):

```ts
const pre = new Float64Array(n + 1);
for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + p[i];
for (const d of grid) {
  if (d > n) break;
  let best = -1, at = 0;
  for (let i = 0; i + d <= n; i++) { const s = pre[i + d] - pre[i]; if (s > best) { best = s; at = i; } }
  mmp[d] = { watts: best / d, startIndex: at };
}
```

- Store the per-workout curve. The athlete curve for a date range is the pointwise max across workouts, keeping the source workout id.
- Monotonicity: after the pointwise max, enforce `mmp[d] ≥ mmp[d']` for d < d' with a backward pass (`mmp[d] = max(mmp[d], mmp[next])`). Exact MMPs are already non-increasing within a workout; this fixes grid interpolation.
- Spikes are handled by the §1 cap. Optionally exclude workouts flagged by the user.
- Also compute HR and speed curves the same way (HR: max mean HR; run: max mean speed by duration).

### 4.2 Best efforts by distance (run, row, swim, ride)

Targets:

- Run: 400 m, 1 k, 1 mi (1609.344 m), 5 k, 10 k, HM (21 097.5 m), M (42 195 m).
- Row: 500 m, 1 k, 2 k, 5 k, 6 k, 10 k, HM.
- Swim: 50, 100, 200, 400, 800, 1500 m (and yd equivalents).

Algorithm on the elapsed 1 Hz cumulative distance `D[0..n]` (two pointers, linear interpolation inside the final second):

```
j = 0
for i in 0..n:
  while j ≤ n and D[j] − D[i] < L: j++
  if j > n: break
  need = L − (D[j−1] − D[i]);  frac = need / (D[j] − D[j−1])
  t = (j − 1 − i) + frac;  best = min(best, t)
```

Swimming in a pool: use length records instead. Find the minimum total time over contiguous active lengths whose distance sum equals the target exactly. Rest lengths break contiguity. GPS distance is not used in the pool.

### 4.3 Critical Power (2-parameter) and W′

Model: `P(t) = CP + W′/t`, equivalent to the linear work–time form `W = P·t = CP·t + W′`.

Fit by ordinary least squares on `(t_k, W_k = P_k t_k)` using MMP points in **[120 s, 1200 s]**. Default points: 180, 300, 420, 720 and 1200 s, from the last 90 days.

```
CP = Σ (t − t̄)(W − W̄) / Σ (t − t̄)²
W′ = W̄ − CP · t̄
```

Reject the fit if CP ≤ 0, W′ ≤ 0, W′ > 60 kJ, or R² < 0.95 (ours). Two-point closed form: `CP = (P1 t1 − P2 t2)/(t1 − t2)`.

The same linear model gives **critical speed**: `D = CS·t + D′`, using best distance/time pairs between 2 and 20 min. CSS (§2.4.1) is its two-point version.

Morton's 3-parameter model `P = CP + W′/(t − W′/(CP − Pmax))` is optional. It needs nonlinear least squares (Levenberg–Marquardt). Out of scope for v1.

### 4.4 W′ balance (Skiba)

**Default: differential form** (Skiba et al. 2015, as implemented by Froncioni and Clarke). Verified line by line in GoldenCheetah `WPrime.cpp`. At 1 Hz, starting from `W = W′`:

```
if P < CP:  W ← W + (CP − P) · (W′ − W) / W′        // recovery
else:       W ← W − (P − CP)                         // depletion
```

This is the explicit-Euler discretisation of `dW/dt = (CP − P)(W′ − W)/W′` below CP. W can go negative; display it, as that indicates CP/W′ are underestimated.

**Alternative: integral form** (Skiba et al. 2012):

```
τ = 546 · e^(−0.01 · D_CP) + 316
```

Here `D_CP = CP − mean(P | P < CP)`. GoldenCheetah truncates τ to an integer. Then `W′bal(t) = W′ − Σ_{u ≤ t} W′exp(u) · e^(−(t−u)/τ)`, where `W′exp(u) = max(0, P_u − CP)`. The 2012 form has been criticised (Skiba & Clarke 2021), so the differential form is the default.

### 4.5 Threshold estimation from performance

**FTP (cycling and erg), choose in order:**

1. A user-entered test.
2. `0.95 × MMP(1200 s)` (Allen & Coggan 20 min test).
3. `MMP(3600 s)`.
4. CP from §4.3 as a separate estimate. FTP is typically about 0.95–1.00 × CP (UNVERIFIED).

**eFTP (ours).** This is our version of the intervals.icu idea. According to its forum (via search), intervals.icu uses power-model curves fitted to MMP points of at least 180 s (the minimum is configurable) and reads the 1 h point. The exact model is unconfirmed. Ours:

```
eFTP = max( 0.95 × MMP90d(1200), MMP90d(3600) )
```

An optional third term, `0.90 × MMP90d(480)` (the Carmichael 8-min test), is UNVERIFIED and off by default because it over-reads for anaerobic profiles. Display eFTP as "estimated" and never auto-apply it (§5.3).

- Running threshold speed: §2.2.3.
- CSS: from a test, or the best 200 and 400 from the last 90 days.

### 4.6 Riegel race prediction

`T2 = T1 × (D2/D1)^1.06` (Riegel 1977/1981). Valid for roughly 3.5 to 230 min. The exponent is configurable (1.04–1.10). It tends to be optimistic for the marathon. For swimming and rowing, use the same form with the exponent configurable (default 1.06, UNVERIFIED for those sports).

Example: 10 k in 45:00 predicts HM 1:39:17.3 (5957.29 s) and M 3:27:00.5 (12 420.54 s).

### 4.7 VO2max estimates (optional, labelled "estimate")

- **Cycling (ACSM leg-cycling equation applied to 5 min MMP):** `VO2max ≈ 10.8 × P5min / kg + 7` (ml·kg⁻¹·min⁻¹). Example: 350 W at 70 kg gives 61.0.
- **Running:** VDOT (§2.2.6) from the best recent race-like effort between 5 and 21 k.

---

## 5. Threshold tracking

### 5.1 Data model

```ts
type ThresholdKind = 'ftp' | 'lthr' | 'hrMax' | 'hrRest' | 'thresholdSpeed' | 'css'
                   | 'p2k' | 'bodyMass' | 'cp' | 'wPrime';
interface ThresholdRecord {
  id: string;
  sport: 'cycling'|'running'|'swimming'|'rowing'|'rowingWater'|'any';
  kind: ThresholdKind;
  value: number;                 // canonical units (W, bpm, m/s, kg, J)
  effectiveFrom: string;         // local date YYYY-MM-DD, inclusive
  source: 'manual'|'test'|'auto-accepted';
  note?: string;
}
```

### 5.2 Lookup rule

The value valid for a workout is the record with the greatest `effectiveFrom ≤ workoutLocalDate` for (sport, kind). If none exists for the sport, fall back to the same kind with `sport='any'`. If there is still none, the method is ineligible and the cascade continues (§2.0). HR max and rest are typically `'any'`, while LTHR is per sport.

Each computed workout stores a snapshot of the thresholds it used, plus `algorithmVersion`. The UI can then explain "computed with FTP 250 W (from 2026-09-01)".

### 5.3 Recalculation

- **Insert, update or delete** of a record with `effectiveFrom = D` (sport s, kind k): recompute every workout of sport s (or all sports for `'any'`) dated in `[D, nextEffectiveFrom)`. That is the previous record's old range plus the new range; for a delete, the range now covered by the preceding record.
- Then recompute daily loads and the Fitness/Fatigue series from `min(D, earliestChangedWorkoutDate)` forward. The EWMA is sequential, so everything after that date changes. Store per-day state so a recompute can restart from day D−1's stored Fitness/Fatigue.
- Planned workouts on or after D are recomputed too (§2.9).
- Auto-estimates (eFTP, auto-LTHR, etc.) are **suggestions** with an "accept" action, which creates a record with `source='auto-accepted'` and an `effectiveFrom` the user chooses (default: the date of the supporting effort). DECISION: never silently change historical loads.
- Bump `algorithmVersion` whenever a formula changes, and run a full recompute.

---

## 6. Longitudinal model

### 6.1 Daily load series

`L[d]` = sum of `load` over all completed workouts whose local start date is d (all sports, or one sport for per-sport curves). Days without workouts have `L[d] = 0` and must be present in the iteration.

### 6.2 Fitness (CTL) and Fatigue (ATL)

These are exponentially weighted moving averages with time constants τ_F = **42** days and τ_A = **7** days, both configurable.

Two forms exist:

| Form | Update | Used by |
|---|---|---|
| (a) "1/τ" | `F[d] = F[d−1] + (L[d] − F[d−1]) / τ` | TrainingPeaks help center ("Fitness (CTL)" article, via search summary) |
| (b) exponential | `F[d] = F[d−1] + (L[d] − F[d−1]) · (1 − e^(−1/τ))`, i.e. `F[d] = L[d](1−λ) + F[d−1]·λ` with `λ = e^(−1/τ)` | GoldenCheetah `PMCData.cpp` (verified: `lte = exp(-1/ltsDays); lts = stress*(1-lte) + lastLTS*lte`); intervals.icu (forum posts reconciling spreadsheets use `exp(-1/42)` and `exp(-1/7)`); also a TrainingPeaks blog post |

Constants: `1 − e^(−1/42) = 0.0235283133`, versus `1/42 = 0.0238095238`. `1 − e^(−1/7) = 0.1331221002`, versus `1/7 = 0.1428571429`. The forms differ noticeably for Fatigue: about 7 % larger daily weight with 1/7.

**Recommendation: form (b), exponential.** It is the exact discretisation of a continuous 42-day time constant and matches GoldenCheetah and intervals.icu. Make it a setting (`pmcForm: 'exp' | 'simple'`) so users migrating from TrainingPeaks can match their numbers. Which form TrainingPeaks actually computes is UNVERIFIED: their help text shows (a), one of their blogs shows (b).

### 6.3 Form (TSB)

- **Recommended (TrainingPeaks and GoldenCheetah default convention):** `Form[d] = F[d−1] − A[d−1]`, i.e. yesterday's Fitness minus yesterday's Fatigue: how fresh you are going *into* day d. GoldenCheetah writes `sb[day+1] = lts[day] − sts[day]` unless "SB today" is enabled (verified).
- intervals.icu shows `F[d] − A[d]`, same day, including today's training (per its developer's forum comment, via search).
- DECISION: default to "yesterday", with a toggle.
- **Form %** = `100 × Form[d] / F[d−1]`. Undefined if `F[d−1] < 1`; show absolute Form instead.

### 6.4 Seeding and short history

- Default: `F[d0−1] = A[d0−1] = 0` at the first day with data. GoldenCheetah also starts at 0, but supports per-season manual seeds that reset both series to the seed value (verified).
- Fitness reaches 63 % of steady state after 42 days and 95 % after about 126 days. **Show Fitness, Fatigue and Form as "provisional"** (hatched) for the first 42 days after `d0`.
- **Seed options:**
  1. A user-entered starting Fitness/Fatigue on a date. This is the GoldenCheetah approach.
  2. Auto (ours): if the athlete imports fewer than 90 days of history, set `F = A = mean(L[d0 … d0+min(27, available−1)])` at d0−1. This is the steady-state assumption. Example: if the first 7 days average 58.57, start both at 58.57.
- DECISION: default to 0 (transparent) or auto-seed. Recommended: 0 for full imports of at least 90 days, auto-seed otherwise, always labelled.

### 6.5 Ramp

`Ramp[d] = F[d] − F[d−7]`, in Fitness points per week. This matches GoldenCheetah `rr` (a rolling 7-day sum of daily Fitness changes, verified).

Guidance bands (TrainingPeaks articles and Friel, via search):

| Ramp (/week) | Label |
|---|---|
| < 0 | Detraining / taper |
| 0 – 5 | Sustainable (Couzens' long-term target is 3–5) |
| 5 – 8 | Aggressive but generally safe (TrainingPeaks says "~4 to 8"; Friel "5–8") |
| > 8 | High risk; sustained > 10 is rarely beneficial |

TrainingPeaks also gives a stricter table for Fitness ≤ 45: ≤ 3 low risk, 4–6 moderate, ≥ 7 high. DECISION: use that table when Fitness ≤ 45 (recommended).

### 6.6 Form zones

intervals.icu's zones are Friel-derived. The percentage mode thresholds below were pieced together from forum posts and are partly UNVERIFIED (Optimal −10 to −30 % and Fresh +5 to +20 % confirmed by a user table). The intervals.icu tooltip calls the percentage mode "probably the better choice", so it is our default.

| Zone | Form % (default) | Absolute Form (alt., UNVERIFIED) | Meaning |
|---|---|---|---|
| Transition | > +20 % | > +25 | Detraining / long rest |
| Fresh | +5 to +20 % | +5 to +25 | Race-ready |
| Grey zone | −10 to +5 % | −10 to +5 | Maintenance |
| Optimal | −30 to −10 % | −30 to −10 | Productive training |
| High risk | < −30 % | < −30 | Overreaching risk |

Boundaries are lower-inclusive. For example, exactly −10 % is Grey.

### 6.7 Per-sport and combined curves

- The EWMA is linear, so **combined Fitness equals the sum of per-sport Fitness values** when they share τ and seeds (TV-10c: 12.3065 + 2.9808 = 15.2873). Use this as an invariant test.
- The headline Fitness/Fatigue/Form is combined across all sports. Per-sport curves are optional filters.
- Known limitation: one point of run Load is more fatiguing (eccentric/impact) than one point of bike Load. DECISION: per-sport multipliers (default 1.0) applied to the *combined* model only. Not recommended for v1.

### 6.8 Projection from planned workouts

Extend `L[d]` into the future:

- For future days, use the sum of `plannedLoad`.
- For **today**, use completed loads plus the planned loads of planned workouts not yet matched to a completed workout. GoldenCheetah uses actual load if present, else planned.
- Run the same recursion. Days with no plan are 0.
- Render projected values dashed. Matching planned to completed workouts (same sport, same day, nearest start time) is an app-level DECISION; this spec only needs the `matched` flag.

### 6.9 ACWR (acute:chronic workload ratio)

- **Rolling, coupled:** `acute = mean(L[d−6..d])`, `chronic = mean(L[d−27..d])`, `ACWR = acute / chronic`.
- **Rolling, uncoupled** (Lolli et al. 2017): `chronic = mean(L[d−27..d−7])`, i.e. the 21 days before the acute window.
- **EWMA** (Williams et al. 2017): `E[d] = λ·L[d] + (1−λ)·E[d−1]`, with `λ_a = 2/(7+1) = 0.25` and `λ_c = 2/(28+1) = 0.068966`. `ACWR = E_a / E_c`.
- Undefined when chronic < 1 or history < 28 days.
- Bands (Gabbett 2016): 0.8–1.3 "sweet spot", > 1.5 "spike".
- **Criticism (show in the UI tooltip):**
  - mathematical coupling causes spurious correlation (Lolli 2017);
  - ratio-of-averages artefacts;
  - weak predictive validity for injury;
  - Impellizzeri et al. 2021, "Time to dismiss ACWR and its underlying theory".

  Recommendation: compute it (some users expect it), but keep it out of the readiness heuristic and the headline. Ramp and Form already carry the same information.

### 6.10 Monotony and strain (Foster 1998)

Over the trailing 7 days, including zero days:

- `monotony = mean(L) / SD(L)`, using the **population SD** (divide by 7; ours, stated explicitly). Undefined if SD = 0.
- `strain = Σ L × monotony` (weekly load × monotony).

Foster's illness thresholds were individual. The commonly quoted monotony > 2.0 warning is UNVERIFIED (not found in the primary source). Show monotony with a soft flag at > 2.0.

### 6.11 Aggregations

Period buckets: **ISO week (Monday start, configurable)**, calendar month, and custom ranges, using the workout's local start date. Per bucket, overall and per sport:

- count of workouts; moving time; elapsed time; distance; elevation gain;
- Load (sum); mean Load/day;
- work (kJ); calories if provided by the device (never derived);
- time in zone per zone system (seconds; power, HR and pace separately);
- 3-zone distribution and PI (§3.6);
- end-of-period Fitness, Fatigue and Form, plus Ramp.

**Elevation gain:** prefer the device's `total_ascent`. Otherwise sum positive altitude increments after a 2 m hysteresis filter (ours): accumulate a climb only once the altitude rises at least 2 m above the last local minimum.

---

## 7. Wellness signals (shown next to Load)

### 7.1 HRV (rMSSD)

- Input: morning rMSSD in ms, one per day; keep the first measurement of the day. Work in `lnRMSSD = ln(rMSSD)`.
- **Baseline:** `B7 = mean(lnRMSSD over last 7 days)`. Require at least 4 values, else null. This is Altini/HRV4Training and Plews practice (7-day moving average of ln rMSSD).
- **Normal range (ours, SWC method):** over the last 60 days (at least 14 values), `M60 = mean`, `S60 = sample SD` of daily lnRMSSD. Normal range = `M60 ± 0.5 × S60`. Altini says the normal range is "typically based on 1–2 months"; the 0.5 SD smallest-worthwhile-change comes from Plews/Kiviniemi-style protocols. HRV4Training's exact formula is UNVERIFIED.
- Status: `B7` below the range means "suppressed"; above the range means "elevated". Altini notes both can indicate stress; flag both.
- Also show `CV7 = 100 × SD7(lnRMSSD) / B7`. A rising CV indicates instability.

### 7.2 Resting HR

`RHR7 = mean(last 7)` and `RHR60 = mean(last 60)`, `SD60`. Flag "elevated" if `RHR7 > RHR60 + max(3 bpm, 1 × SD60)` (ours, UNVERIFIED threshold).

### 7.3 Sleep

Nightly duration in hours (and score if the device supplies one). Flag if the last night < 6.0 h or the 3-night mean < 0.85 × target (default target 8 h, giving 6.8 h) (ours).

### 7.4 Body mass

`mass7 = mean of last 7 measurements`. Trend = OLS slope over the last 28 days, in kg/week. The latest `mass7` feeds W/kg if no explicit `bodyMass` threshold record exists for the date (DECISION).

### 7.5 Readiness (HEURISTIC; label it as such)

Count flags for today:

1. HRV `B7` outside the normal range.
2. RHR elevated.
3. Sleep short.
4. Form % < −30 (High-risk zone).
5. The athlete's subjective soreness, stress or fatigue ≥ 4 on a 1–5 scale, if collected.

| Flags | State | Copy |
|---|---|---|
| 0 | Green | "No warning signs" |
| 1 | Amber | "One warning sign: <reason>" |
| ≥ 2 | Red | "Several warning signs: consider an easy day" |

Requirements:

- Missing inputs are skipped, not counted. Show which inputs were available.
- Always list the reasons.
- Label it "Heuristic, not a validated or medical score".
- No composite 0–100 number. False precision is the main risk here.

---

## 8. Recommended defaults

### 8.1 Load method priority per sport (after manual override)

| Sport | 1st | 2nd | 3rd | 4th | 5th |
|---|---|---|---|---|---|
| Cycling (road, MTB, gravel, indoor) | Power | HR (HRSS) | RPE | Duration (50/h) | — |
| Running (road, track, treadmill) | Pace (Minetti-adjusted) | Power (opt-in, replaces Pace when enabled) | HR | RPE | Duration (55/h) |
| Trail running | HR (DECISION; pace undervalues technical terrain) | Pace | RPE | Duration (55/h) | — |
| Swimming, pool | Swim Pace (CSS, cubed) | RPE | HR (if coverage ≥ 80 %) | Duration (50/h) | — |
| Swimming, open water | Swim Pace (GPS) | HR | RPE | Duration (50/h) | — |
| Rowing, erg | Power (erg or C2-pace-derived) | HR | RPE | Duration (50/h) | — |
| Rowing, on water | Power (oarlock, on-water FTP) | HR | RPE | Duration (50/h) | — |
| Strength | RPE (sRPE) | HR (only if athlete opts in) | Duration (40/h) | — | — |
| Hiking / walking | HR | RPE | Duration (35/h hike, 25/h walk) | — | — |
| Yoga / mobility | RPE | Duration (20/h) | — | — | — |
| Other | HR | RPE | Duration (40/h) | — | — |

### 8.2 Default thresholds when none are entered

All are flagged "default, please test". Auto-estimates are offered as suggestions (§5.3).

| Threshold | Auto-estimate from history (preferred) | Cold-start default (UNVERIFIED population values) |
|---|---|---|
| HRmax | max of 5 s-smoothed HR over the last 365 days (exclude artefacts above 220 or with spikes over 10 bpm/s) | Tanaka: `208 − 0.7 × age` |
| HRrest | min of daily RHR over the last 30 days, else the 5th percentile of overnight HR | 60 bpm |
| LTHR run | last-20-min average HR of a 30 min TT (Friel); else 0.95 × best 20 min mean HR of runs in the last 90 days (UNVERIFIED factor) | 0.90 × HRmax |
| LTHR bike | same approach on rides | 0.87 × HRmax |
| LTHR swim | — | run LTHR − 10 bpm |
| FTP bike | eFTP (§4.5) | 2.5 W/kg × body mass (or 175 W with no mass) |
| Threshold speed (run) | best 40–60 min effort, or Riegel from the best 12–60 min effort over 90 days | none; skip Pace Load |
| CSS | best 400 and 200 over 90 days | none; skip Swim Load |
| Row FTP | best 60 min erg power, or 0.75 × P2k | none; skip Power Load |
| Body mass | latest `mass7` | none (W/kg hidden) |
| Sex (TRIMP b) | profile | male constants (DECISION) |

### 8.3 Model defaults

| Setting | Default |
|---|---|
| τ Fitness / Fatigue | 42 / 7 days |
| PMC form | exponential `1 − e^(−1/τ)` |
| Form convention | yesterday's F − A |
| Form zones | percentage mode |
| Ramp window | 7 days |
| HR Load | HRSS, per-sample |
| Power zones | Coggan 7 |
| HR zones | Friel 7 (bike and run tables) |
| Run pace zones | Friel 7 |
| Swim zones | Skiba 6 (% CSS) |
| Row zones | scheme B (% P2k) |
| 3-zone mapping | §3.6 table |
| MAX_GAP_S | 10 s |
| Stop removal | ≥ 60 s of zero power and no speed |
| Coverage gate | 80 % |

---

## 9. Decisions for the architect (summary)

1. PMC update form: exponential (recommended) versus 1/τ (TrainingPeaks-compatible). Expose as a setting?
2. Form convention: yesterday (recommended) versus same-day.
3. Seeding: 0 versus auto steady-state seed for short histories.
4. Running default: Pace versus Power. Trail runs on HR?
5. Swim rest: moving time (recommended) versus elapsed.
6. Erg FTP and on-water FTP kept separate (recommended yes).
7. `strengthLoadFactor` (default 1.0) and per-sport multipliers in combined Fitness (recommended: no for v1).
8. Auto-estimated thresholds are suggestions only (recommended) versus auto-applied.
9. Stop-removal rule for cycling Load (ours; deviates from TrainingPeaks' probable count-everything behaviour).
10. Power spike cap (2500 W) and gap limit (10 s).
11. Sex constant when unspecified.
12. Whether to surface ACWR at all (recommended: secondary screen with caveat).
13. Planned/completed matching rule (affects today's projection).

---

## Appendix A. Test vectors

All inputs are already-cleaned 1 Hz active series unless stated. "≈" means a tolerance of 1e-3. Values come from the reference script; formulas are in the cited sections.

### TV-1 Constant power (§2.1)
- Input: 3600 s × 200 W; FTP 250.
- Expected: WP = 200.0000; intensity = 0.8000; Load = 64.0000; variability = 1.0000; work = 720.0 kJ.

### TV-2 Short series, full-window WP rule (§2.1.1)
- Input: 30 s × 100 W, then 30 s × 300 W (n = 60); FTP 250.
- Rolling values r_k = 100 + 200k/30 for k = 0…30, giving 31 full windows.
- Expected: WP = 223.0695; mean power = 200.0000; variability = 1.1153; intensity = 0.8923; Load (s = 60) = 1.3269.

### TV-3 Variable 1 h ride (§2.1)
- Input: 4 × (300 s @ 300 W + 600 s @ 150 W) = 3600 s; FTP 250.
- Expected: WP = 233.2275; mean = 200.0000; variability = 1.1661; intensity = 0.9329; Load = 87.0321; work = 720.0 kJ.

### TV-4 HR Load, HRSS (§2.6.1)
Common inputs: HRrest 50, HRmax 190, LTHR 170.
- **a)** Male, 60 min @ 150 bpm: TRIMP_raw = 108.0954; TRIMP_LT1h = 170.6511; **HR Load = 63.3429**.
- **b)** Female, same session: TRIMP_raw = 121.4991; TRIMP_LT1h = 185.0821; **HR Load = 65.6460**.
- **c)** Male, 30 min @ 140 + 30 min @ 165 (per-sample): **HR Load = 69.5924**. The average-HR shortcut (152.5 bpm) gives 67.1911 and is NOT to be used.
- **d)** Male, 60 min @ 170 (= LTHR): **HR Load = 100.0000**.

### TV-5 Zone-time HR Load (§2.6.2)
- Input: 20 min Z1, 30 min Z2, 10 min Z4 (Friel); table 30/55/70/85/100/120/140.
- Expected: 20/60 × 30 + 30/60 × 55 + 10/60 × 85 = 10 + 27.5 + 14.1667 = **51.6667**.

### TV-6 Run Pace Load with grade (§2.2)
- Threshold pace 4:00/km, so threshold speed = 4.166667 m/s.
- **a)** 1800 s at 3.0 m/s on a constant +5 % grade:
  - f = 1.301443; adjusted speed = 3.904330 m/s (4:16.1/km);
  - intensity = 0.937039; **Load = 43.9021**.
- **b)** 900 s flat at 3.5 m/s, then 900 s at 3.0 m/s on +5 % (adjusted 3.904330), concatenated:
  - normalized adjusted speed = 3.718438 m/s (4:28.9/km);
  - intensity = 0.892425; **Load = 39.8211**.
- **c)** Grade factor table in §2.2.1: f(−0.10) = 0.597696; f(+0.10) = 1.657837.

### TV-7 CSS and Swim Load (§2.4)
- CSS test: T400 = 400 s (6:40), T200 = 190 s (3:10). CSS = 200/210 = 0.952381 m/s = **1:45.0/100 m**.
- **a)** 2000 m, moving time 2400 s: v = 0.833333; intensity = 0.875000; **Load = 100 × (2400/3600) × 0.875³ = 44.6615**.
- **b)** Same swim, elapsed option (2700 s incl. rest): intensity = 0.777778; **Load = 35.2881**.

### TV-8 Session RPE (§2.7)
- Input: strength session, 45 min, RPE 7, factor 1.0.
- Expected: sRPE = 315 AU; Load = 80 × 0.75 = **60.0000**.
- With RPE 6.5 (interpolated pph 75): Load = 56.2500.

### TV-9 Rowing (§2.5)
- Concept2 conversions: 2:00/500 m gives **202.5463 W**; 2:05/500 m gives **179.2000 W**; 1:45/500 m gives **302.3432 W**.
- 1800 s at a steady 2:05/500 m, FTP_row 200 W: intensity = 0.8960; **Load = 40.1408**.
- 2 k of 6:30.0: P2k = 377.6193 W. FTP_row default = 0.75 × P2k = **283.2145 W**, which is a 1:47.3/500 m split.

### TV-10 Fitness/Fatigue/Form over 14 days (§6)
Inputs: daily loads `[100, 0, 60, 80, 0, 120, 50, 0, 90, 70, 0, 150, 40, 0]`; F0 = A0 = 0; exponential form (λ_F = 0.0235283133, λ_A = 0.1331221002). FormY = F[d−1] − A[d−1] (recommended); FormT = F[d] − A[d].

| Day | Load | Fitness | Fatigue | FormY | FormT |
|---|---|---|---|---|---|
| 1 | 100 | 2.3528 | 13.3122 | 0.0000 | −10.9594 |
| 2 | 0 | 2.2975 | 11.5401 | −10.9594 | −9.2426 |
| 3 | 60 | 3.6551 | 17.9911 | −9.2426 | −14.3360 |
| 4 | 80 | 5.4514 | 26.2459 | −14.3360 | −20.7945 |
| 5 | 0 | 5.3231 | 22.7520 | −20.7945 | −17.4289 |
| 6 | 120 | 8.0213 | 35.6978 | −17.4289 | −27.6766 |
| 7 | 50 | 9.0090 | 37.6018 | −27.6766 | −28.5928 |
| 8 | 0 | 8.7970 | 32.5962 | −28.5928 | −23.7992 |
| 9 | 90 | 10.7076 | 40.2379 | −23.7992 | −29.5303 |
| 10 | 70 | 12.1026 | 44.1999 | −29.5303 | −32.0973 |
| 11 | 0 | 11.8179 | 38.3159 | −32.0973 | −26.4980 |
| 12 | 150 | 15.0691 | 53.1835 | −26.4980 | −38.1145 |
| 13 | 40 | 15.6556 | 51.4285 | −38.1145 | −35.7729 |
| 14 | 0 | 15.2873 | 44.5822 | −35.7729 | −29.2949 |

- **b)** Same input, "1/τ" form, day 14: Fitness = 15.4415, Fatigue = 45.3551. Day 1: 2.3810 / 14.2857.
- **c)** Linearity: bike loads `[100,0,60,0,0,120,50,0,90,0,0,150,40,0]` give day-14 Fitness 12.3065; run loads `[0,0,0,80,0,0,0,0,0,70,0,0,0,0]` give 2.9808. The sum, 15.2873, equals the combined value.
- **d)** Ramp at day 14 = F[14] − F[7] = **6.2783**.
- **e)** Form % day 14 (yesterday convention) = 100 × (−35.7729)/15.6556 = −228.5 %. This is "High risk", and also illustrates why Form % must be suppressed while provisional (§6.4).
- **f)** Monotony, days 8–14 `[0,90,70,0,150,40,0]`: sum 350, mean 50.0000, population SD 52.9150, **monotony 0.9449**, **strain 330.7189**. (Sample SD would give 57.1548 and monotony 0.8748; not used.)
- **g)** EWMA ACWR at day 14 (λ 0.25 / 0.068966, start 0): acute 46.4959, chronic 33.5779, **ratio 1.3847**. It must still be reported as undefined in the UI because history < 28 days. Test the raw function separately.
- **h)** Auto-seed example (§6.4) using the first 7 days: seed = 58.5714.

### TV-11 CP 2-parameter fit (§4.3)
- Efforts: (180 s, 400 W), (420 s, 330 W), (1200 s, 290 W), so work = 72 000, 138 600, 348 000 J.
- OLS on W = CP·t + W′: **CP = 270.0633 W**, **W′ = 24 162.03 J**.
- Fitted powers: 404.2968 / 327.5919 / 290.1983 W. Predicted P(300 s) = 350.6034; P(3600 s) = 276.7750.
- Two-point (180, 1200): CP = 270.5882 W.

### TV-12 W′bal, differential form (§4.4)
- Input: CP 280 W, W′ 20 000 J; 60 s @ 400 W, then 60 s @ 200 W.
- After 60 s: W′bal = **12 800.0000**. After 120 s: **14 339.0046**. Minimum = 12 800.

### TV-13 HR zones from LTHR 165 (§3.1)
Integer display ranges in bpm; boundary = ceil(165 × b):

- **Friel bike** (b = .81/.90/.94/1.00/1.03/1.07; raw 133.65/148.5/155.1/165/169.95/176.55):
  Z1 ≤ 133 | Z2 134–148 | Z3 149–155 | Z4 156–164 | Z5a 165–169 | Z5b 170–176 | Z5c ≥ 177
- **Friel run** (b = .85/.90/.95/1.00/1.03/1.07):
  Z1 ≤ 140 | Z2 141–148 | Z3 149–156 | Z4 157–164 | Z5a 165–169 | Z5b 170–176 | Z5c ≥ 177
- **Coggan 5** (b = .69/.84/.95/1.06):
  L1 ≤ 113 | L2 114–138 | L3 139–156 | L4 157–174 | L5 ≥ 175
- Classification check: HR 148.5 (a non-integer sample) is bike Z3; HR 148 is bike Z2.

### TV-14 Riegel and threshold pace (§4.6, §2.2.3)
- 10 k in 2700 s predicts HM **5957.2883 s** and M **12 420.5382 s**.
- 5 k in 1200 s gives D60 = **14 095.6269 m**, threshold pace **255.3984 s/km** (4:15.4).
- VDOT for 5 k in 20:00: VO2 = 47.4645; %max = 0.952983; **VDOT = 49.8062**.

### TV-15 Polarization Index and classification (§3.6)
- (0.80, 0.05, 0.15): PI = **2.3802**, so Polarized.
- (0.75, 0.20, 0.05): PI = 1.2730, so Pyramidal.
- (0.80, 0.00, 0.20): PI = **3.1818**, so Polarized (z2 = 0 branch).
- (0.30, 0.50, 0.20): Threshold.

### TV-16 Strength (§2.7.3)
- 100 kg × 5 reps: Epley **116.6667**; Brzycki **112.5000**.
- 3 × 5 × 100 kg: volume load **1500 kg**.

### TV-17 Planned structured workout (§2.9.1)
- FTP 250. Steps: 600 s @ 150 W; 3 × (480 s @ 262.5 W [105 %] + 240 s @ 125 W); 600 s @ 125 W. Total 3360 s.
- Expected: WP = **216.5646**, mean = 188.3929, intensity = 0.8663, **planned Load = 70.0377**. The naive per-second Σ IF² would give 59.2667 and must NOT be used.
- Label-only: 90 min "Endurance" (IF 0.68) gives **69.3600**.
- Race IF heuristic: 2 h gives 0.9330; 4 h gives 0.8706; 10 h gives 0.7943.

### TV-18 Edwards TRIMP (§2.6.3)
- 60 min: 10 min @ 55 % HRmax, 20 @ 65 %, 20 @ 75 %, 10 @ 85 %.
- Expected: 10·1 + 20·2 + 20·3 + 10·4 = **150**.

### TV-19 MMP (§4.1)
- Power `[100, 200, 300, 400, 300, 200, 100]`.
- Expected best mean by duration 1…7 s: 400, 350, 333.3333, 300, 280, 250, 228.5714.

### TV-20 Best effort by distance (§4.2)
- Speeds: 200 s @ 3.0 m/s, 300 s @ 4.0 m/s, 200 s @ 3.0 m/s (total 2400 m).
- Expected: fastest 1000 m = **250.0 s**, inside the 4.0 m/s block.

### TV-21 Decoupling (§2.1.3)
- First half 200 W / 140 bpm; second half 200 W / 147 bpm.
- EF1 = 1.428571, EF2 = 1.360544, so **decoupling = 4.7619 %**.

### TV-22 HRV baseline (§7.1)
- Last 7 rMSSD `[62, 58, 65, 55, 60, 52, 50]` ms.
- ln values: 4.1271, 4.0604, 4.1744, 4.0073, 4.0943, 3.9512, 3.9120. **B7 = 4.046701** (geometric mean 57.21 ms). CV7 = 2.3450 %.
- With M60 = 4.10 and S60 = 0.12, the normal range is [4.0400, 4.1600], so B7 is inside: no flag.

### TV-23 VO2max estimate (§4.7)
- 5 min MMP 350 W, 70 kg: VO2max ≈ **61.0** ml·kg⁻¹·min⁻¹.

---

## Appendix B. Sources

Verified against code: GoldenCheetah, github.com/GoldenCheetah/GoldenCheetah, `src/Metrics/`:

- `Coggan.cpp`: NP/IF/TSS/VI
- `PMCData.cpp`: exponential CTL/ATL, SB on following day, ramp, seeds
- `TRIMPPoints.cpp`: Banister constants, TRIMP(100) normalization
- `GOVSS.cpp`: Minetti polynomial
- `WPrime.cpp`: Skiba integral τ and the Froncioni/Clarke differential form
- `AerobicDecoupling.cpp`
- `Zones.cpp`, `HrZones.cpp`, `PaceZones.cpp`: default zones
- `SwimScore.cpp`, `DanielsPoints.cpp`

Verified via web-search summaries (primary pages not directly fetchable from this sandbox):

- TrainingPeaks: "Fitness (CTL)" help article; "The Science of the Performance Manager"; "Calculating Swimming TSS Score"; rTSS/NGP description (help article 204071944); "Why ramp rate is an important training metric"; "Estimating Training Stress Score" (Friel); "Normalized Power" blog; Friel's zones quick guide.
- intervals.icu forum: decay `exp(-1/42)`/`exp(-1/7)`; same-day form; Form % zones; HRSS per-bpm summation; eFTP description.
- Concept2 pace-to-watts calculator: `P = 2.80/pace³`.
- Minetti AE et al. (2002) J Appl Physiol 93:1039–1046.
- Treff G et al. (2019) Front Physiol 10:707; commentary (2023) Front Physiol, doi 10.3389/fphys.2023.1179769.
- Skiba PF et al. (2012) MSSE 44:1526; Skiba et al. (2015); critique in arXiv 2108.04510.
- Foster C (1998) MSSE 30:1164–1168; Foster et al. (2001) JSCR 15:109.
- Williams S et al. (2017) BJSM (EWMA ACWR); Lolli L et al. (2017) BJSM (coupling); Impellizzeri FM et al. (2021) Sports Med.
- Riegel P (1977/1981); Daniels J & Gilbert J (1979) *Oxygen Power*.
- Banister EW (1991); Morton RH et al. (1990); Edwards S (1993); Lucia A et al. (1999/2003).
- Ginn (CSS); Tanaka H et al. (2001) JACC; Epley (1985); Brzycki (1993).
- Altini M (HRV4Training) on 7-day baseline and normal range; Plews DJ et al. on ln rMSSD and SWC.
- Rowing bands: British Rowing / GB Rowing training matrix (structure only); percentage schemes from calculator and program pages (UNVERIFIED).
