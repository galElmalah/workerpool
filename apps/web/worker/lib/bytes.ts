/**
 * Bytes as a `BodyInit`. Under the DOM lib (the SPA type-checks the Worker via `AppType`) only
 * ArrayBuffer-backed views are valid bodies; D1 / fflate hand us `Uint8Array<ArrayBufferLike>`.
 * Returns the same view when it is ArrayBuffer-backed (always the case at runtime), else a copy.
 */
export function bodyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes);
}
