import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Only a joined, clean worker generation may request another generation.
// Unexpected exits remain visible failures; the supervisor does not replay jobs.
export function superviseWorker({ spawnWorker, restartDelayMs = 1_000 }) {
  const delay = Number.isFinite(restartDelayMs)
    ? Math.max(1_000, Math.min(30_000, restartDelayMs)) : 1_000;
  let active = null;
  let restartTimer = null;
  let stopping = false;
  let finished = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  function finish(code) {
    if (finished) return;
    finished = true;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    resolveDone(code);
  }

  function start() {
    restartTimer = null;
    if (stopping || finished) return;
    let child;
    try { child = spawnWorker(); } catch { finish(1); return; }
    active = child;
    let recycleReady = false;
    let processError = false;
    const onMessage = (message) => {
      if (active === child && !stopping && message && typeof message === 'object'
        && message.type === 'greenlight.worker.recycle.v1') recycleReady = true;
    };
    const onError = () => {
      processError = true;
      // A failed fork can emit error without a process ID or an exit event.
      if (!child.pid) finish(1);
    };
    child.on('message', onMessage);
    child.on('error', onError);
    // close follows process exit and stdio/IPC closure; an acknowledgement can
    // still be in flight when exit is emitted.
    child.once('close', (code, signal) => {
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      active = null;
      if (stopping) { finish(code === 0 || signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1); return; }
      if (!processError && code === 0 && recycleReady) {
        restartTimer = setTimeout(start, delay);
        return;
      }
      finish(typeof code === 'number' && code !== 0 ? code : 1);
    });
  }

  function stop(signal = 'SIGTERM') {
    if (finished || stopping) return;
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    if (active) active.kill(signal);
    else finish(0);
  }

  start();
  return { done, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = superviseWorker({
    spawnWorker: () => fork(new URL('../dist/worker/index.mjs', import.meta.url), [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      detached: false,
    }),
  });
  const terminate = () => controller.stop('SIGTERM');
  const interrupt = () => controller.stop('SIGINT');
  process.on('SIGTERM', terminate);
  process.on('SIGINT', interrupt);
  controller.done.then((code) => {
    process.removeListener('SIGTERM', terminate);
    process.removeListener('SIGINT', interrupt);
    process.exitCode = code;
  });
}
