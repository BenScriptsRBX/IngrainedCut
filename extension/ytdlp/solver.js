// Runs one challenge script from ytdlp.js (yt-dlp's solver plus YouTube's player code) and sends back what it printed.
// Each script gets a fresh frame, so nothing carries over between runs.
window.addEventListener('message', (e) => {
  if (e.source !== parent || typeof e.data?.script !== 'string') return;
  let out = '';
  const log = console.log;
  console.log = (...a) => {
    out += a.join(' ') + '\n';
  };
  try {
    (0, eval)(e.data.script);
    parent.postMessage({ out }, '*');
  } catch (err) {
    parent.postMessage({ error: String(err?.stack || err) }, '*');
  } finally {
    console.log = log;
  }
});
parent.postMessage({ ready: true }, '*');
