// Gira nel contesto della pagina University Planner (world: MAIN) e osserva le chiamate
// che la pagina stessa fa a getImpegniCalendarioPubblico, per impararne i parametri.
// Non modifica né blocca nulla: legge solo URL e corpo della richiesta.
(() => {
  const MATCH = /\/api\/Impegni\/getImpegniCalendarioPubblico/i;

  function report(url, body) {
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      if (!parsed || typeof parsed !== 'object') return;
      window.postMessage({ __intimeAutofill: 'up-request', url: new URL(url, location.href).href, body: parsed }, location.origin);
    } catch { /* corpo non JSON: ignorato */ }
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (url && MATCH.test(url) && init?.body) report(url, init.body);
    return origFetch.apply(this, arguments);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__intimeUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__intimeUrl && MATCH.test(this.__intimeUrl)) report(this.__intimeUrl, body);
    return origSend.apply(this, arguments);
  };
})();
