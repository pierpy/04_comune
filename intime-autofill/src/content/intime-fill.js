// Iniettato su richiesta (pulsante del popup) nella scheda di U-WEB InTime.
// Riempie il modulo della lezione con i dati di una riga della coda.
// NON preme mai "Salva": evidenzia il pulsante e aspetta che sia l'utente a confermare.
// Espone window.__intimeAutofill.{fill, analyze}, chiamate dal popup con chrome.scripting.
(() => {
  if (window.__intimeAutofill) return;

  const CONTROL = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), select, textarea, [role=combobox], mat-select, [contenteditable=true]';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (t) => (t || '').replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim();

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  // Testo con cui l'utente "vede" il campo: <label>, aria-label, placeholder, mat-label del contenitore.
  function labelOf(el) {
    const parts = [];
    el.labels?.forEach((l) => parts.push(l.textContent));
    parts.push(el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('title'));
    const ids = el.getAttribute('aria-labelledby');
    if (ids) ids.split(/\s+/).forEach((id) => parts.push(document.getElementById(id)?.textContent));
    const box = el.closest('mat-form-field, .mat-mdc-form-field, .form-group, .field, .p-field, .control-group, tr, .row');
    const lab = box?.querySelector('label, mat-label, .mat-mdc-floating-label, th, .control-label');
    if (lab) parts.push(lab.textContent);
    return clean(parts.filter(Boolean).join(' | '));
  }

  function controls() {
    return [...document.querySelectorAll(CONTROL)].filter(visible);
  }

  function findField(spec) {
    if (spec.selector) {
      const el = document.querySelector(spec.selector);
      if (el) return el;
    }
    if (!spec.label) return null;
    const re = new RegExp(spec.label, 'i');
    // Si confronta ogni pezzo di etichetta separatamente, così "Ora fine" non cattura "Data".
    return controls().find((el) => labelOf(el).split(' | ').some((p) => re.test(p))) || null;
  }

  function setNative(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    // Angular/React ascoltano questi eventi per aggiornare il proprio modello.
    for (const type of ['input', 'change']) el.dispatchEvent(new Event(type, { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  const norm = (t) => clean(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function bestOption(options, wanted) {
    const w = norm(wanted);
    return options.find((o) => norm(o.text) === w)
      || options.find((o) => norm(o.text).startsWith(w))
      || options.find((o) => norm(o.text).includes(w) || (w && w.includes(norm(o.text)) && norm(o.text)));
  }

  async function setValue(el, kind, row) {
    const value = valueFor(kind, row, el);
    if (value === undefined || value === '') return 'vuoto';
    if (el instanceof HTMLSelectElement) {
      const opt = bestOption([...el.options].map((o) => ({ text: o.textContent, value: o.value })), value);
      if (!opt) return `opzione "${value}" non trovata`;
      setNative(el, opt.value);
      return 'ok';
    }
    if (el.matches('[role=combobox], mat-select') && !(el instanceof HTMLInputElement)) {
      el.click();
      await sleep(300);
      const opts = [...document.querySelectorAll('[role=option], mat-option')].filter(visible);
      const opt = bestOption(opts.map((o) => ({ text: o.textContent, el: o })), value);
      if (!opt) { document.body.click(); return `opzione "${value}" non trovata`; }
      opt.el.click();
      return 'ok';
    }
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    }
    el.focus();
    setNative(el, value);
    return 'ok';
  }

  function valueFor(kind, row, el) {
    switch (kind) {
      case 'date': return el.type === 'date' ? row.isoDate : row.date;
      case 'start': return row.start;
      case 'end': return row.end;
      case 'type': return row.type;
      case 'course': return row.course;
      case 'topic': return row.topic;
      default: return undefined;
    }
  }

  function findButton(pattern) {
    const re = new RegExp(pattern, 'i');
    return [...document.querySelectorAll('button, [role=button], input[type=submit], input[type=button], a.btn')]
      .filter(visible)
      .find((b) => re.test(clean(b.textContent || b.value || b.getAttribute('aria-label'))));
  }

  function mark(el, ok) {
    el.style.outline = `3px solid ${ok ? '#2e9d5b' : '#d93b3b'}`;
    el.style.outlineOffset = '1px';
  }

  function banner(html, color = '#1f4e8c') {
    document.getElementById('__intime_banner')?.remove();
    const el = document.createElement('div');
    el.id = '__intime_banner';
    el.innerHTML = html;
    el.style.cssText = `position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);max-width:640px;padding:12px 18px;border-radius:8px;background:${color};color:#fff;font:14px/1.45 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)`;
    el.addEventListener('click', () => el.remove());
    document.documentElement.appendChild(el);
  }

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function fill(row, settings) {
    // Se il modulo non è aperto, prova ad aprirlo con il pulsante "Aggiungi" (non è un salvataggio).
    if (!findField(settings.fields.date) && settings.addButton) {
      const add = findButton(settings.addButton);
      if (add) { add.click(); await sleep(800); }
    }

    const report = {};
    for (const [kind, spec] of Object.entries(settings.fields)) {
      const el = findField(spec);
      if (!el) { report[kind] = 'campo non trovato'; continue; }
      try {
        report[kind] = await setValue(el, kind, row);
      } catch (e) {
        report[kind] = `errore: ${e.message}`;
      }
      if (report[kind] !== 'vuoto') mark(el, report[kind] === 'ok');
      await sleep(120);
    }

    const save = findButton(settings.saveButton);
    if (save) {
      save.style.outline = '4px solid #f2b705';
      save.style.outlineOffset = '2px';
      save.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // Quando l'utente preme Salva la riga viene segnata come registrata.
      save.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'queue:mark', key: row.key, patch: { done: true } });
        banner('Lezione segnata come registrata. Riapri l\'estensione per la successiva.', '#1f6f43');
      }, { once: true });
    }

    const problems = Object.entries(report).filter(([, v]) => v !== 'ok' && v !== 'vuoto');
    banner(
      `<b>${esc(row.date)} ${esc(row.start)}–${esc(row.end)}</b> · ${esc(row.course)}<br>`
      + (problems.length ? `Da controllare: ${problems.map(([k, v]) => `${esc(k)} (${esc(v)})`).join(', ')}<br>` : '')
      + 'Verifica i campi e premi <b>Salva</b> tu stesso.',
      problems.length ? '#a35a00' : '#1f4e8c',
    );
    return { report, saveFound: Boolean(save) };
  }

  // Descrizione dei campi presenti, da usare per tarare le etichette su un nuovo ateneo.
  function analyze() {
    return {
      url: location.href,
      fields: controls().map((el) => ({
        label: labelOf(el),
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || el.getAttribute('role') || '',
        id: el.id || '',
        name: el.getAttribute('name') || el.getAttribute('formcontrolname') || '',
        options: el instanceof HTMLSelectElement ? [...el.options].map((o) => clean(o.textContent)).slice(0, 40) : undefined,
      })),
      buttons: [...document.querySelectorAll('button, [role=button], input[type=submit]')].filter(visible)
        .map((b) => clean(b.textContent || b.value || b.getAttribute('aria-label'))).filter(Boolean),
    };
  }

  window.__intimeAutofill = { fill, analyze };
})();
