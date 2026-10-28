// Gira nel contesto della pagina University Planner (world: MAIN) e osserva le chiamate
// che la pagina stessa fa alle API di UP, per impararne i parametri.
// Non modifica né blocca nulla: legge URL, corpo della richiesta e risposta.
// Una chiamata viene riconosciuta come "impegni" dalla risposta (elenco di oggetti con
// dataInizio/dataFine), non dal nome: le pagine calendarioPubblico/matricola=… e
// linkCalendarioId=… non usano necessariamente lo stesso endpoint.
(() => {
  const API = /\/api\//i;

  function parse(text) {
    if (text && typeof text === 'object') return text;
    try { return JSON.parse(text); } catch { return undefined; }
  }

  // Ritorna [elenco, percorso] se la risposta contiene impegni.
  function impegniIn(res) {
    for (const path of ['', 'payload', 'items', 'data', 'impegni']) {
      const arr = path ? res?.[path] : res;
      if (Array.isArray(arr) && arr.some((x) => x && x.dataInizio && x.dataFine)) return [arr, path];
    }
    return [null, null];
  }

  function report(url, method, body, responseText) {
    const abs = new URL(url, location.href).href;
    const res = parse(responseText);
    const [arr, path] = impegniIn(res);
    const req = parse(body);
    window.postMessage({
      __intimeAutofill: 'up-api',
      url: abs,
      method: (method || 'GET').toUpperCase(),
      body: req && typeof req === 'object' ? req : null,
      isImpegni: Boolean(arr),
      responsePath: path,
      count: arr ? arr.length : Array.isArray(res) ? res.length : null,
      sampleKeys: arr?.[0] ? Object.keys(arr[0]).slice(0, 30) : res && typeof res === 'object' ? Object.keys(res).slice(0, 30) : [],
    }, location.origin);
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const method = init?.method || input?.method;
    const p = origFetch.apply(this, arguments);
    if (API.test(url)) {
      p.then((r) => r.clone().text()).then((t) => report(url, method, init?.body, t)).catch(() => {});
    }
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__intime = { method, url: String(url) };
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__intime;
    if (info && API.test(info.url)) {
      this.addEventListener('load', () => {
        try {
          const resp = this.responseType === 'json' ? this.response : this.responseType === '' || this.responseType === 'text' ? this.responseText : null;
          report(info.url, info.method, body, resp);
        } catch { /* risposta non leggibile */ }
      });
    }
    return origSend.apply(this, arguments);
  };
})();
