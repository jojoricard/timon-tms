// The demo shell: install the service worker that answers /api, then start the same
// interface as the server version. The interface does not know where the API runs.
import { mount, mountNotice } from '@timon/web';

const activationTimeout = 15_000;

async function controlledByWorker(): Promise<void> {
  // Absent in some private windows (Firefox) and on insecure origins.
  const { serviceWorker } = navigator;
  if (!serviceWorker) throw new Error('Service workers are not available');

  const changed = new Promise((resolve) =>
    serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
  );
  await serviceWorker.register('/sw.js', { type: 'module', scope: '/' });
  if (serviceWorker.controller) return;

  // A forced reload bypasses an already active worker; ask it to take the page back.
  (await serviceWorker.ready).active?.postMessage('claim');
  await changed;
}

// Registration can also hang rather than fail: give up after a while either way.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`No service worker after ${ms} ms`)), ms),
  );
  return Promise.race([promise, timeout]);
}

const root = document.getElementById('root');
if (root) {
  try {
    await withTimeout(controlledByWorker(), activationTimeout);
    mount(root);
  } catch (error) {
    console.error('Timon demo: the service worker could not start', error);
    mountNotice(root, 'service-worker-unavailable');
  }
}
