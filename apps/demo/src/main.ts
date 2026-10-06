// The demo shell: install the service worker that answers /api, then start the same
// interface as the server version. The interface does not know where the API runs.

async function controlledByWorker(): Promise<void> {
  const { serviceWorker } = navigator;
  const changed = new Promise((resolve) =>
    serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
  );
  await serviceWorker.register('/sw.js', { type: 'module', scope: '/' });
  if (!serviceWorker.controller) await changed;
}

const root = document.getElementById('root');
if (root) {
  if ('serviceWorker' in navigator) {
    await controlledByWorker();
    const { mount } = await import('@timon/web');
    mount(root);
  } else {
    root.textContent = 'This demo needs a browser with service workers.';
  }
}
