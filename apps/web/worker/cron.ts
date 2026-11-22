/** Cron entry point: Garmin incremental sync, wellness, auto-push, one backfill step. Never throws. */
import { logSync } from './db/sync';
import { runSync, type SyncReport } from './services/sync';

export async function runCron(env: Env): Promise<SyncReport | undefined> {
  try {
    const report = await runSync(env, { reason: 'cron' });
    if (report.status === 'skipped' && report.skippedBecause !== 'not_connected') console.log(`cron sync skipped: ${report.summary}`);
    return report;
  } catch (e) {
    // runSync records Garmin failures itself; anything reaching here is unexpected (e.g. D1 down).
    console.error('cron sync crashed', e);
    try {
      await logSync(env.DB, { kind: 'pull_activities', status: 'error', summary: 'Scheduled sync crashed', detail: e instanceof Error ? e.message : String(e) });
    } catch {
      /* nothing more we can do */
    }
    return undefined;
  }
}

export async function runScheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  // runCron catches everything; the extra catch keeps the waitUntil promise from ever rejecting.
  ctx.waitUntil(runCron(env).catch((e) => console.error('cron crashed', e)));
}
