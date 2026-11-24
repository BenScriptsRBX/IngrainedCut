// Runs on the IngrainedCut website: tells the editor the extension is installed, and carries its requests to the
// extension's background script (which holds the ChatGPT sign-in) and the answers back. Only the website's own page can
// talk to it (messages from frames or other windows are ignored), and the sign-in tokens never reach the page.
const VERSION = chrome.runtime.getManifest().version;
document.documentElement.setAttribute('data-icut-extension', VERSION);

const streams = new Map(); // request id -> port
const reply = (msg) => window.postMessage({ __icut: 'from-ext', ...msg }, location.origin);

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.__icut !== 'to-ext') return;
  if (m.kind === 'call') {
    chrome.runtime.sendMessage({ method: m.method, params: m.params }, (res) => {
      const err = chrome.runtime.lastError;
      reply({ id: m.id, kind: 'result', ...(err ? { error: err.message } : res) });
    });
  } else if (m.kind === 'stream') {
    // a streamed ChatGPT request: chunks of the response body come back as they arrive
    const port = chrome.runtime.connect({ name: 'responses' });
    streams.set(m.id, port);
    const ping = setInterval(() => port.postMessage({ t: 'ping' }), 15_000); // keeps the background awake meanwhile
    const end = () => {
      clearInterval(ping);
      streams.delete(m.id);
    };
    port.onMessage.addListener((msg) => {
      reply({ id: m.id, kind: 'chunk', ...msg });
      if (msg.t === 'end' || msg.t === 'error') {
        end();
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!streams.has(m.id)) return;
      end();
      reply({ id: m.id, kind: 'chunk', t: 'error', message: 'stream_interrupted: the extension stopped answering' });
    });
    port.postMessage({ t: 'start', path: m.path, body: m.body });
  } else if (m.kind === 'abort') {
    const port = streams.get(m.id);
    if (port) {
      streams.delete(m.id);
      port.disconnect();
    }
  }
});
