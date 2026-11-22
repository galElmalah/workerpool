/**
 * Settings → Devices: the native clients (the iPhone app) signed in with a revocable device token
 * (docs/MOBILE_API.md §1). A quiet table of devices with a two-step Revoke — revoking cannot be
 * undone (the token is gone; the phone has to connect again), so it follows the Settings → Data
 * pattern for irreversible actions rather than `toast.undo` — plus the server address the app asks
 * for, with a copy button.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Device } from '@cadence/core/domain';
import { Check, Copy, MonitorSmartphone, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api, call, raw } from '@/lib/api';
import { formatDayMonth } from '@/lib/format';
import { Button, IconButton } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Section } from '@/ui/Section';
import { Skeleton } from '@/ui/Skeleton';
import { Table, type Column } from '@/ui/Table';
import { toast } from '@/ui/toast';
import { InlineError, Row, Rows, TwoStepButton, relativeTime } from './common';

const devicesKey = ['auth', 'devices'] as const;

const PLATFORM: Record<Device['platform'], string> = { ios: 'iPhone', other: 'Other' };

/** "21 Nov 2026" in the viewer's time zone. */
function addedOn(iso: string): string {
  const d = new Date(iso);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${formatDayMonth(local)} ${d.getFullYear()}`;
}

function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (d: Device) => {
      try {
        await raw(`/auth/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e; // already revoked: same outcome
      }
      return d;
    },
    onMutate: async (d) => {
      await qc.cancelQueries({ queryKey: devicesKey });
      const prev = qc.getQueryData<{ devices: Device[] }>(devicesKey);
      qc.setQueryData<{ devices: Device[] }>(devicesKey, (p) => (p ? { devices: p.devices.filter((x) => x.id !== d.id) } : p));
      return { prev };
    },
    onError: (e, _d, ctx) => {
      if (ctx?.prev) qc.setQueryData(devicesKey, ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (d) => toast.success(<>Revoked <b>{d.name}</b>. It is signed out now.</>),
    onSettled: () => qc.invalidateQueries({ queryKey: devicesKey }),
  });
}

export function SettingsDevicesPage() {
  const q = useQuery({ queryKey: devicesKey, queryFn: () => call(api.auth.devices.$get()) });
  const revoke = useRevokeDevice();
  const devices = q.data?.devices ?? [];

  const columns: Column<Device>[] = [
    {
      key: 'name',
      header: 'Name',
      // takes the free width and truncates, so the armed "Cancel · Confirm revoke" never widens the table
      width: '100%',
      className: 'max-w-0',
      cell: (d) => (
        <span className="flex min-w-0 items-center gap-2.5">
          {d.platform === 'ios' ? <Smartphone className="size-4 shrink-0 text-fg-3" aria-hidden /> : <MonitorSmartphone className="size-4 shrink-0 text-fg-3" aria-hidden />}
          <span className="truncate text-fg-1">{d.name}</span>
        </span>
      ),
    },
    { key: 'platform', header: 'Platform', cell: (d) => <span className="text-fg-2">{PLATFORM[d.platform]}</span>, hideBelow: 'md', width: '7rem' },
    { key: 'added', header: 'Added', cell: (d) => <span className="whitespace-nowrap text-fg-2">{addedOn(d.createdAt)}</span>, hideBelow: 'sm', width: '8.5rem' },
    { key: 'used', header: 'Last used', cell: (d) => <span className="whitespace-nowrap text-fg-2">{d.lastUsedAt ? relativeTime(d.lastUsedAt) : 'Not yet'}</span>, width: '8rem' },
    {
      key: 'revoke',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '1%',
      cell: (d) => (
        <div className="flex justify-end">
          <TwoStepButton size="sm" label="Revoke" confirmLabel="Confirm revoke" onConfirm={() => revoke.mutate(d)} />
        </div>
      ),
    },
  ];

  return (
    <>
      <Section title="Devices" description="Phones signed in to Cadence with their own key. Revoking one signs it out at once.">
        {q.isPending ? (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-8 w-full" radius="sm" />
            <Skeleton className="h-11 w-full" radius="sm" />
            <Skeleton className="h-11 w-full" radius="sm" />
          </div>
        ) : q.isError ? (
          <InlineError action={<Button size="sm" variant="ghost" onClick={() => void q.refetch()}>Retry</Button>}>Couldn't load your devices.</InlineError>
        ) : devices.length === 0 ? (
          <EmptyState size="sm" icon={<Smartphone />} title="No devices yet">
            Open the Cadence app on your iPhone, enter this server&rsquo;s address and your passphrase. It shows up here once it is connected.
          </EmptyState>
        ) : (
          <Table aria-label="Devices" rows={devices} rowKey={(d) => d.id} columns={columns} />
        )}
      </Section>

      <Section title="Connect the iPhone app">
        <Rows>
          <ServerAddressRow />
          <Row title="Passphrase" description="The same one you sign in with here. Changing it signs every device out." />
        </Rows>
      </Section>
    </>
  );
}

function ServerAddressRow() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      toast.success('Server address copied');
    } catch {
      toast.error('Couldn’t copy. Select the address and copy it instead.');
    }
  };
  return (
    <Row title="Server address" description="Enter this in the app’s connect screen.">
      <code className="min-w-0 select-all truncate rounded-sm bg-surface-1 px-2.5 py-1.5 font-mono text-body-sm text-fg-1">{origin}</code>
      <IconButton label={copied ? 'Copied' : 'Copy server address'} icon={copied ? <Check /> : <Copy />} onClick={() => void copy()} />
    </Row>
  );
}
