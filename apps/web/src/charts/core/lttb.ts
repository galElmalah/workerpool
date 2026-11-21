/**
 * Largest-Triangle-Three-Buckets downsampling on typed arrays, gap aware.
 *
 * Unlike `@cadence/core/metrics`' `lttb` (which drops nulls and returns new arrays) this
 * works on an index window of shared Float64Arrays (NaN = no sample) and returns *indices*,
 * so a renderer can look up any channel at the chosen samples. A `-1` entry marks a gap:
 * the bucket that produced the next index contained missing samples, so the line breaks.
 */
export function lttbIndices(x: Float64Array, y: Float64Array, start: number, end: number, threshold: number): Int32Array {
  const len = end - start;
  if (len <= 0) return new Int32Array(0);
  if (threshold >= len || threshold < 3) {
    const out: number[] = [];
    let prevNaN = false;
    for (let i = start; i < end; i++) {
      if (Number.isNaN(y[i])) {
        prevNaN = true;
        continue;
      }
      if (prevNaN && out.length) out.push(-1);
      prevNaN = false;
      out.push(i);
    }
    return Int32Array.from(out);
  }
  const out = new Int32Array(threshold * 2);
  let o = 0;
  const every = (len - 2) / (threshold - 2);
  let a = start;
  // first point (first finite)
  while (a < end && Number.isNaN(y[a])) a++;
  if (a >= end) return new Int32Array(0);
  out[o++] = a;
  for (let i = 0; i < threshold - 2; i++) {
    // next bucket average
    let avgStart = start + Math.floor((i + 1) * every) + 1;
    let avgEnd = Math.min(start + Math.floor((i + 2) * every) + 1, end);
    if (avgStart >= avgEnd) avgStart = avgEnd - 1;
    let ax = 0;
    let ay = 0;
    let cnt = 0;
    for (let j = avgStart; j < avgEnd; j++) {
      const yy = y[j];
      if (yy === yy) {
        ax += x[j];
        ay += yy;
        cnt++;
      }
    }
    if (cnt) {
      ax /= cnt;
      ay /= cnt;
    } else {
      ax = x[Math.max(start, avgEnd - 1)];
      ay = y[a];
    }
    const bs = start + Math.floor(i * every) + 1;
    const be = Math.min(start + Math.floor((i + 1) * every) + 1, end);
    const pax = x[a];
    const pay = y[a];
    let maxArea = -1;
    let pick = -1;
    let gap = false;
    for (let j = bs; j < be; j++) {
      const yy = y[j];
      if (yy !== yy) {
        gap = true;
        continue;
      }
      const area = Math.abs((pax - ax) * (yy - pay) - (pax - x[j]) * (ay - pay));
      if (area > maxArea) {
        maxArea = area;
        pick = j;
      }
    }
    if (gap) out[o++] = -1;
    if (pick >= 0) {
      out[o++] = pick;
      a = pick;
    }
  }
  let last = end - 1;
  while (last > a && Number.isNaN(y[last])) last--;
  if (last > a) out[o++] = last;
  return out.subarray(0, o);
}

/** Binary search: first index whose value is ≥ v (array must be ascending; NaNs not allowed). */
export function lowerBound(arr: ArrayLike<number>, v: number, lo = 0, hi = arr.length): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the value nearest to v in an ascending array. */
export function nearestIndex(arr: ArrayLike<number>, v: number): number {
  const n = arr.length;
  if (!n) return -1;
  const i = lowerBound(arr, v);
  if (i <= 0) return 0;
  if (i >= n) return n - 1;
  return v - arr[i - 1] <= arr[i] - v ? i - 1 : i;
}

/** null-aware conversion to Float64Array (null/undefined → NaN). */
export function toF64(a: ArrayLike<number | null | undefined> | undefined, n?: number): Float64Array {
  const len = n ?? a?.length ?? 0;
  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const v = a?.[i];
    out[i] = v == null ? NaN : v;
  }
  return out;
}

/** Centered rolling mean ignoring NaN (O(n) prefix sums). window ≤ 1 returns the input. */
export function rollingMeanF64(x: Float64Array, window: number): Float64Array {
  if (window <= 1) return x;
  const n = x.length;
  const ps = new Float64Array(n + 1);
  const pc = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = x[i];
    const ok = v === v;
    ps[i + 1] = ps[i] + (ok ? v : 0);
    pc[i + 1] = pc[i] + (ok ? 1 : 0);
  }
  const back = Math.floor((window - 1) / 2);
  const fwd = window - 1 - back;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (x[i] !== x[i]) {
      out[i] = NaN;
      continue;
    }
    const a = Math.max(0, i - back);
    const b = Math.min(n, i + fwd + 1);
    const c = pc[b] - pc[a];
    out[i] = c > 0 ? (ps[b] - ps[a]) / c : NaN;
  }
  return out;
}
