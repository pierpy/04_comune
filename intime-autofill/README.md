# Registro Lezioni Autofill

Estensione per Chrome/Edge (Manifest V3) che precompila il registro lezioni di **U-WEB InTime** (Cineca)
incrociando **Google Calendar** e **University Planner** (UP). Compila i campi ma **non salva mai**:
il pulsante "Salva" viene evidenziato e lo preme il docente.

Stato: prototipo. La lettura dei dati e l'incrocio sono testati; il riempimento del modulo InTime
usa un riconoscimento generico dei campi e va tarato sulla pagina reale (vedi "Taratura").

## Come funziona

1. **Google Calendar**: API v3 in sola lettura (`calendar.readonly`), uno o più calendari, ricorrenze espanse.
2. **University Planner**: aprendo una volta la propria pagina `…/calendarioPubblico/…` (anche nella forma
   `matricola=XXXXXX`), lo script `up-capture.js` registra la chiamata `getImpegniCalendarioPubblico` fatta dalla
   pagina; l'estensione la ripete poi per qualsiasi periodo, settimana per settimana.
3. **Incrocio** (`src/lib/matcher.js`): ogni impegno UP viene abbinato all'evento Google che si sovrappone di più
   (≥ 50 % della durata, più somiglianza del titolo). L'argomento viene dalla descrizione dell'evento Google.
   Segnala orari diversi, lezioni solo in UP o solo in Google, e scarta le lezioni annullate/sospese in UP.
4. **InTime**: dal popup, "Compila la prossima" riempie data, ora inizio/fine, tipo, titolo e argomento
   nella scheda attiva. Quando il docente preme "Salva", la riga viene segnata come registrata.

Tutti i dati restano nel browser (`chrome.storage.local`): non c'è un server e non vengono memorizzate password.

## Installazione per sviluppo

1. Crea in Google Cloud Console un progetto, abilita *Google Calendar API* e crea un ID client OAuth di tipo
   **Estensione Chrome** con l'ID dell'estensione; inseriscilo in `manifest.json` → `oauth2.client_id`.
2. `chrome://extensions` → Modalità sviluppatore → *Carica estensione non pacchettizzata* → cartella `intime-autofill`.
3. Impostazioni → collega Google e scegli i calendari; apri la pagina UP del tuo calendario.
4. Test dell'incrocio: `npm test` (Node ≥ 20).

## Taratura su InTime

Apri il modulo di inserimento lezione in InTime, poi nel popup premi **Analizza modulo**: la struttura dei campi
(etichette, tipi, opzioni dei menu) viene copiata negli appunti. Con quella si aggiornano le espressioni regolari
o i selettori CSS in Impostazioni → "Campi del modulo InTime".

## Note per la distribuzione

- Lo scope `calendar.readonly` è "sensibile": per un'app pubblica serve la verifica OAuth di Google.
- Le API di University Planner non sono documentate da Cineca e possono cambiare.
- Il nome del prodotto non deve usare i marchi Cineca/InTime; verificare le condizioni d'uso degli atenei.
