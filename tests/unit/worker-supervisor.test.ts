import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = await import(String('../../scripts/worker-supervisor.mjs')).catch(() => ({}));

class FakeChild extends EventEmitter {
  kill = vi.fn();
  finish(code: number | null, signal: string | null) {
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
}

function setup(spawnOverride?: () => FakeChild) {
  const children: FakeChild[] = [];
  const spawnWorker = spawnOverride ?? (() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const controller = typeof api.superviseWorker === 'function'
    ? api.superviseWorker({ spawnWorker, restartDelayMs: 1_000 }) : null;
  return { children, controller };
}

describe('continuous worker supervisor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts exactly one worker generation', () => {
    const { children } = setup();
    expect(children).toHaveLength(1);
  });

  it('waits for channel close when the recycle acknowledgement arrives after process exit', async () => {
    const { children, controller } = setup();
    expect(controller).not.toBeNull();
    let settled = false;
    controller.done.then(() => { settled = true; });
    children[0].emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(false);
    expect(children).toHaveLength(1);
    children[0].emit('message', {type:'greenlight.worker.recycle.v1'});
    children[0].emit('close', 0, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(children).toHaveLength(2);
    controller.stop('SIGTERM');
    children[1].finish(0, null);
    await expect(controller.done).resolves.toBe(0);
  });

  it('keeps the parent alive across 100 acknowledged clean recycles, with no overlap', async () => {
    const { children, controller } = setup();
    expect(controller).not.toBeNull();
    let settled = false;
    controller.done.then(() => { settled = true; });
    for (let i = 0; i < 100; i++) {
      const child = children[i];
      child.emit('message', { type: 'greenlight.worker.recycle.v1' });
      expect(children).toHaveLength(i + 1);
      child.finish( 0, null);
      expect(children).toHaveLength(i + 1);
      expect(child.listenerCount('message')).toBe(0);
      expect(child.listenerCount('error')).toBe(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(children).toHaveLength(i + 2);
      expect(settled).toBe(false);
    }
    controller.stop('SIGTERM');
    children.at(-1)!.finish( 0, null);
    await expect(controller.done).resolves.toBe(0);
  });

  it.each([1, 134])('does not hide a failing generation with exit %s', async (code) => {
    const { children, controller } = setup();
    expect(controller).not.toBeNull();
    children[0].emit('message', { type: 'greenlight.worker.recycle.v1' });
    children[0].finish( code, null);
    await expect(controller.done).resolves.toBe(code);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
  });

  it.each([null, { type: 'other' }, 'greenlight.worker.recycle.v1'])('rejects unacknowledged clean exit with message %j', async (message) => {
    const { children, controller } = setup();
    expect(controller).not.toBeNull();
    children[0].emit('message', message);
    children[0].finish( 0, null);
    await expect(controller.done).resolves.toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
  });

  it('treats a signal exit as failure without a parent stop request', async () => {
    const { children, controller } = setup();
    expect(controller).not.toBeNull();
    children[0].finish( null, 'SIGSEGV');
    await expect(controller.done).resolves.toBe(1);
  });

  it('forwards shutdown once and never restarts after an acknowledged child exit', async () => {
    const { children, controller } = setup();
    expect(controller).not.toBeNull();
    controller.stop('SIGTERM');
    controller.stop('SIGTERM');
    expect(children[0].kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    children[0].emit('message', { type: 'greenlight.worker.recycle.v1' });
    children[0].finish( 0, null);
    await expect(controller.done).resolves.toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
  });

  it('cancels a pending replacement during shutdown', async () => {
    const { children, controller } = setup();
    expect(controller).not.toBeNull();
    children[0].emit('message', { type: 'greenlight.worker.recycle.v1' });
    children[0].finish( 0, null);
    controller.stop('SIGTERM');
    await expect(controller.done).resolves.toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
  });

  it('cannot acknowledge the next generation using a previous child message', async () => {
    const { children, controller } = setup();
    expect(controller).not.toBeNull();
    children[0].emit('message', { type: 'greenlight.worker.recycle.v1' });
    children[0].finish( 0, null);
    await vi.advanceTimersByTimeAsync(1_000);
    children[0].emit('message', { type: 'greenlight.worker.recycle.v1' });
    children[1].finish( 0, null);
    await expect(controller.done).resolves.toBe(1);
  });

  it('does not restart a child that emitted an operational error before exiting', async () => {
    const { children, controller } = setup();
    expect(controller).not.toBeNull();
    children[0].emit('message', { type: 'greenlight.worker.recycle.v1' });
    children[0].emit('error', new Error('synthetic process error'));
    expect(children).toHaveLength(1);
    children[0].finish( 0, null);
    await expect(controller.done).resolves.toBe(1);
  });

  it('fails safely if process creation throws', async () => {
    const { controller } = setup(() => { throw new Error('synthetic spawn failure'); });
    expect(controller).not.toBeNull();
    await expect(controller.done).resolves.toBe(1);
  });
});
