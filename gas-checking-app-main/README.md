# Distributori: il prezzo più basso vicino a te

Web app open source che mostra su una mappa i distributori di carburante in Italia con i prezzi del giorno, per trovare subito il più conveniente nella zona.

**Prova l'app:** https://roccocherubini.github.io/gas-checking-app/

## Cosa fa

- Mostra i distributori come gocce con il prezzo: verdi i più economici della zona, gialle quelle qualche centesimo più care, rosse le più care.
- Permette di scegliere il carburante: benzina, gasolio, GPL o metano.
- Indica il distributore più economico nell'area visibile e quanto dista da te.
- Apre la scheda del distributore con il listino completo (self e servito) e il percorso in Google Maps o Waze.
- Si installa sul telefono dalla schermata Home, senza passare dagli store.

## Da dove vengono i dati

I prezzi sono quelli che i gestori comunicano per legge al Ministero delle Imprese e del Made in Italy (MIMIT), pubblicati ogni giorno come [open data](https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti) con licenza IODL 2.0. Sono i prezzi in vigore alle 8 del mattino del giorno di estrazione, quindi non sono in tempo reale.

Prima della pubblicazione, lo script `scripts/prepara_dati.py` pulisce i dati:

- per il confronto usa solo benzina, gasolio, GPL e metano; i carburanti speciali compaiono nel listino della scheda;
- scarta i prezzi comunicati da più di 30 giorni e quelli anomali, cioè sotto il 75% o sopra il 140% della mediana nazionale;
- esclude gli impianti senza coordinate valide o senza prezzi.

## Come funziona

Non c'è nessun server da gestire. Un workflow di GitHub Actions (`.github/workflows/aggiorna.yml`) gira due volte al giorno e a ogni modifica del codice: scarica i dati dal MIMIT, genera `web/data/distributori.json` e pubblica la cartella `web` su GitHub Pages.

```
scripts/
  esplora_dati.py      scarica i dati e stampa un riepilogo
  prepara_dati.py      pulisce i dati e scrive il file per la mappa
web/
  index.html           la pagina
  style.css            l'aspetto
  app.js               mappa, gocce, scheda e scelta del carburante
  manifest.webmanifest nome e icone per l'installazione sul telefono
  icone/               icone dell'app
.github/workflows/
  aggiorna.yml         aggiornamento e pubblicazione automatici
```

## Provarla sul proprio computer

Serve Python 3.10 o più recente, senza librerie esterne.

```
python scripts/prepara_dati.py
python -m http.server 8000 --directory web
```

Poi apri http://localhost:8000 nel browser.

## Licenze

- Codice: MIT, vedi il file `LICENSE`.
- Dati sui prezzi: MIMIT, Osservatorio prezzi carburanti, licenza IODL 2.0.
- Mappa: © OpenStreetMap contributors, tile di OpenFreeMap, libreria MapLibre GL JS.
