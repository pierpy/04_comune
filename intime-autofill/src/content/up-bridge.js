// Ponte tra up-capture.js (contesto pagina) e il service worker dell'estensione.
(() => {
  let notified = false;

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.__intimeAutofill !== 'up-request') return;
    chrome.runtime.sendMessage(
      { type: 'up:captured', url: ev.data.url, body: ev.data.body, pageUrl: location.href, title: document.title },
      (res) => {
        if (res?.ok && res.data?.isNew && !notified) {
          notified = true;
          toast('Calendario University Planner collegato all\'estensione InTime Autofill.');
        }
      },
    );
  });

  function toast(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;padding:12px 16px;border-radius:8px;background:#1f6f43;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)';
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }
})();
