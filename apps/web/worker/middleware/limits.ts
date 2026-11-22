import { bodyLimit } from 'hono/body-limit';
import { ApiError } from '../lib/http';

export const MB = 1024 * 1024;
/** FIT uploads: a 3 h 1 Hz ride is ~1–3 MB, a zipped Garmin download less. */
export const MAX_UPLOAD_BYTES = 25 * MB;
/** JSON backups (no streams): years of data stay well below this; bounded for isolate memory. */
export const MAX_IMPORT_BYTES = 32 * MB;

/** Reject request bodies above `maxBytes` with `413 { error: { code: 'payload_too_large' } }`. */
export const limitBody = (maxBytes: number, what = 'Request body') =>
  bodyLimit({
    maxSize: maxBytes,
    onError: () => {
      throw new ApiError(413, 'payload_too_large', `${what} is larger than ${Math.round(maxBytes / MB)} MB`);
    },
  });
