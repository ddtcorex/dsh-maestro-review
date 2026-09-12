import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, MAESTRO_ENDPOINTS } from '../src/host/settings-rpc.ts';
import { loadUserConfig } from '../src/host/config-store.ts';

let home: string;
let previousDshHome: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'review-pin-'));
  previousDshHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
});

afterEach(async () => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  await rm(home, { recursive: true, force: true });
});

/** Captures the RPC handler settings-rpc registers, with a mocked maestroTunnel. */
function makeCtx() {
  let handler: ((endpoint: string, payload?: unknown) => Promise<unknown>) | undefined;
  const maestroTunnel = {
    status: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    proxyStatus: vi.fn(),
    reloadConfig: vi.fn(),
    initialReady: vi.fn(),
    getPin: vi.fn().mockResolvedValue('11112222'),
    rotatePin: vi.fn().mockResolvedValue('33334444'),
    getLanPin: vi.fn().mockResolvedValue('55556666'),
    rotateLanPin: vi.fn().mockResolvedValue('77778888'),
  };
  const ctx: any = {
    connection: { rpc: { handle: (_channel: string, fn: typeof handler) => { handler = fn; return () => {}; }, call: vi.fn() } },
    maestroTunnel,
    effect: (fn: () => unknown) => fn(),
    get: () => undefined,
    logger: undefined,
  };
  return { ctx, maestroTunnel, call: (endpoint: string, payload?: unknown) => handler!(endpoint, payload) };
}

describe('settings-rpc PIN endpoints', () => {
  it('getPin delegates to maestroTunnel.getPin — not a local hardcoded value', async () => {
    const { ctx, maestroTunnel, call } = makeCtx();
    apply(ctx);
    const result = await call(MAESTRO_ENDPOINTS.getPin) as { ok: true; value: { pin: string } };
    expect(maestroTunnel.getPin).toHaveBeenCalledTimes(1);
    expect(result.value.pin).toBe('11112222');
  });

  it('rotatePin delegates to maestroTunnel.rotatePin and returns its real, rotated value', async () => {
    const { ctx, maestroTunnel, call } = makeCtx();
    apply(ctx);
    const result = await call(MAESTRO_ENDPOINTS.rotatePin) as { ok: true; value: { pin: string } };
    expect(maestroTunnel.rotatePin).toHaveBeenCalledTimes(1);
    expect(result.value.pin).toBe('33334444');
    expect(result.value.pin).not.toBe('00000000');
  });

  it('lanPinRotate delegates to maestroTunnel.rotateLanPin', async () => {
    const { ctx, maestroTunnel, call } = makeCtx();
    apply(ctx);
    const result = await call(MAESTRO_ENDPOINTS.lanPinRotate) as { ok: true; value: { pin: string } };
    expect(maestroTunnel.rotateLanPin).toHaveBeenCalledTimes(1);
    expect(result.value.pin).toBe('77778888');
  });

  it('lanPinStatus delegates to maestroTunnel.getLanPin when the LAN PIN is enabled', async () => {
    const { ctx, maestroTunnel, call } = makeCtx();
    apply(ctx);
    await call(MAESTRO_ENDPOINTS.lanPinSetEnabled, { enabled: true });
    const result = await call(MAESTRO_ENDPOINTS.lanPinStatus) as { ok: true; value: { enabled: boolean; pin?: string } };
    expect(maestroTunnel.getLanPin).toHaveBeenCalledTimes(1);
    expect(result.value).toEqual({ enabled: true, pin: '55556666' });
  });
});

describe('settings-rpc pinSessionTtlHours', () => {
  it('persists an in-range lifetime and reads it back from the shared store', async () => {
    const { ctx, call } = makeCtx();
    apply(ctx);
    const saved = await call(MAESTRO_ENDPOINTS.saveConfig, { pinSessionTtlHours: 168 }) as { ok: true };
    expect(saved.ok).toBe(true);
    expect((await loadUserConfig()).pinSessionTtlHours).toBe(168);
  });

  it('accepts the boundary values 0 (session only) and 8760 (one year)', async () => {
    const { ctx, call } = makeCtx();
    apply(ctx);
    expect((await call(MAESTRO_ENDPOINTS.saveConfig, { pinSessionTtlHours: 0 }) as { ok: boolean }).ok).toBe(true);
    expect((await call(MAESTRO_ENDPOINTS.saveConfig, { pinSessionTtlHours: 8760 }) as { ok: boolean }).ok).toBe(true);
  });

  it('rejects out-of-range, fractional and non-numeric values without persisting them', async () => {
    const { ctx, call } = makeCtx();
    apply(ctx);
    await call(MAESTRO_ENDPOINTS.saveConfig, { pinSessionTtlHours: 24 });
    for (const bad of [-1, 1.5, '24', 8761]) {
      const res = await call(MAESTRO_ENDPOINTS.saveConfig, { pinSessionTtlHours: bad }) as { ok: false; error: { message: string } };
      expect(res.ok).toBe(false);
      expect(res.error.message).toContain('pinSessionTtlHours must be an integer between 0 and 8760');
    }
    expect((await loadUserConfig()).pinSessionTtlHours).toBe(24); // last good value survived
  });
});
