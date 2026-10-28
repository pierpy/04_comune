// Ponte tra up-capture.js (contesto pagina) e il service worker dell'estensione.
(() => {
  let notified = false;

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.__intimeAutofill !== 'up-api') return;
    const { __intimeAutofill, ...call } = ev.data;
    // Ogni chiamata API vista viene annotata per la diagnostica (pagina Impostazioni).
    chrome.runtime.sendMessage({ type: 'up:seen', call: { ...call, pageUrl: location.href, at: new Date().toISOString() } });
    if (!call.isImpegni) return;
    chrome.runtime.sendMessage(
      { type: 'up:captured', ...call, pageUrl: location.href, title: document.title },
      (res) => {
        if (res?.ok && !notified) {
          notified = true;
          toast(res.data?.isNew
            ? 'Calendario University Planner collegato all\'estensione Registro Lezioni Autofill.'
            : 'Calendario University Planner aggiornato nell\'estensione.');
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
