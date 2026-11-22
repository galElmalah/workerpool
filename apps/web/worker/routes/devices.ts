import { Hono } from 'hono';
import { z } from 'zod';
import { DevicePlatform, type Device } from '@cadence/core/domain';
import type { AppEnv } from '../env';
import { badRequest, notFound } from '../lib/http';
import { newId, nowIso } from '../lib/ids';
import { deleteDevice, insertDevice, listDevices } from '../db/devices';
import { validate } from '../services/context';
import { forgetDevice, hashDeviceToken, newDeviceToken } from '../middleware/auth';
import { authenticate } from './auth';

const CreateDevice = z.object({
  passphrase: z.string().min(1).max(1024),
  name: z.string().trim().min(1).max(64),
  platform: DevicePlatform,
});

/**
 * Device tokens for native clients (docs/MOBILE_API.md §1). Mounted at /api. `POST /auth/devices`
 * is open (passphrase + login throttle); the others are protected by `requireAuth`.
 */
export const devicesRoutes = new Hono<AppEnv>()
  .post('/auth/devices', validate('json', CreateDevice), async (c) => {
    const { passphrase, name, platform } = c.req.valid('json');
    await authenticate(c.env.DB, passphrase);
    const token = newDeviceToken();
    const device = await insertDevice(c.env.DB, { id: newId('dev'), name, platform, tokenHash: await hashDeviceToken(token), createdAt: nowIso() });
    return c.json({ token, device } satisfies { token: string; device: Device }, 201);
  })
  .get('/auth/devices', async (c) => {
    return c.json({ devices: await listDevices(c.env.DB) });
  })
  // before '/auth/devices/:id' so "current" is never taken for an id
  .delete('/auth/devices/current', async (c) => {
    const p = c.get('principal');
    if (p?.kind !== 'device') throw badRequest('This request is not authenticated with a device token');
    await deleteDevice(c.env.DB, p.deviceId);
    forgetDevice(p.deviceId);
    return c.body(null, 204);
  })
  .delete('/auth/devices/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await deleteDevice(c.env.DB, id);
    forgetDevice(id);
    if (!deleted) throw notFound('Device');
    return c.body(null, 204);
  });
