/**
 * WebCrypto helpers: base64url, PBKDF2 passphrase hashing, HMAC-signed tokens, constant-time
 * comparison and AES-GCM encryption at rest (Garmin credentials).
 *
 * PBKDF2 is capped at 100 000 iterations in production Workers (local workerd does not enforce
 * the cap) — never go above it.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64uEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const norm = s.replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Constant-time equality of two byte arrays (length difference returns false immediately). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (x: ArrayBufferView, y: ArrayBufferView) => boolean };
  if (typeof subtle.timingSafeEqual === 'function') return subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ───────────────────────────── passphrase hashing ─────────────────────────────

export const PBKDF2_ITERATIONS = 100_000;

export interface PassphraseHash {
  hash: string; // base64url
  salt: string; // base64url
  iterations: number;
}

async function pbkdf2(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassphrase(passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<PassphraseHash> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const bits = await pbkdf2(passphrase, salt, Math.min(iterations, PBKDF2_ITERATIONS));
  return { hash: b64uEncode(bits), salt: b64uEncode(salt), iterations: Math.min(iterations, PBKDF2_ITERATIONS) };
}

export async function verifyPassphrase(passphrase: string, stored: PassphraseHash): Promise<boolean> {
  const bits = await pbkdf2(passphrase, b64uDecode(stored.salt), Math.min(stored.iterations, PBKDF2_ITERATIONS));
  return timingSafeEqual(bits, b64uDecode(stored.hash));
}

// ───────────────────────────── HMAC tokens ─────────────────────────────

const hmacKeys = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let k = hmacKeys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    hmacKeys.set(secret, k);
  }
  return k;
}

/** `base64url(JSON).base64url(HMAC-SHA256)` */
export async function signToken(payload: unknown, secret: string): Promise<string> {
  const body = b64uEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64uEncode(sig)}`;
}

/** Verified payload, or null when malformed / tampered. */
export async function verifyToken<T>(token: string, secret: string): Promise<T | null> {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64uDecode(sig), enc.encode(body));
    if (!ok) return null;
    return JSON.parse(dec.decode(b64uDecode(body))) as T;
  } catch {
    return null;
  }
}

// ───────────────────────────── AES-GCM at rest ─────────────────────────────

const AAD = enc.encode('cadence:v1');
const aesKeys = new Map<string, Promise<CryptoKey>>();

/** AES-256 key = SHA-256(ENCRYPTION_KEY), so any sufficiently random secret string works. */
function aesKey(secret: string): Promise<CryptoKey> {
  let k = aesKeys.get(secret);
  if (!k) {
    k = crypto.subtle
      .digest('SHA-256', enc.encode(`cadence-aes:${secret}`))
      .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
    aesKeys.set(secret, k);
  }
  return k;
}

function requireKey(env: Env): string {
  const k = env.ENCRYPTION_KEY;
  if (!k) throw new Error('ENCRYPTION_KEY is not configured');
  return k;
}

/** AES-GCM encrypt a JSON-serialisable value → `v1.<iv>.<ciphertext>` (base64url). */
export async function encryptJson(env: Env, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD },
    await aesKey(requireKey(env)),
    enc.encode(JSON.stringify(value)),
  );
  return `v1.${b64uEncode(iv)}.${b64uEncode(ct)}`;
}

export async function decryptJson<T>(env: Env, payload: string): Promise<T> {
  const [v, iv, ct] = payload.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Unknown ciphertext format');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64uDecode(iv), additionalData: AAD },
    await aesKey(requireKey(env)),
    b64uDecode(ct),
  );
  return JSON.parse(dec.decode(plain)) as T;
}
