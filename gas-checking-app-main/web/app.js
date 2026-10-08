const FILE_DATI = 'data/distributori.json';
const CENTRO_ITALIA = [12.5, 42.3];      // MapLibre vuole [longitudine, latitudine]
const ZOOM_GOCCE = 12;                   // da questo zoom in su compaiono le gocce con il prezzo
const SPAZIO_GOCCIA = { x: 40, y: 46 };  // in pixel: due gocce piu' vicine di cosi' si sovrapporrebbero
const MARGINE_VERDE = 0.015;             // fino all'1,5% sopra i piu' economici della zona -> verde (circa 3 cent)
const MARGINE_GIALLO = 0.05;             // fino al 5% sopra -> giallo (circa 10 cent); oltre -> rosso

const LINK_MIMIT = 'https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti';

// Nome da mostrare per ogni carburante: maiuscolo (pulsanti, listino) e dentro una frase
const NOMI = { benzina: 'Benzina', gasolio: 'Gasolio', gpl: 'GPL', metano: 'Metano', elettrica_ac: 'Ricarica AC', elettrica_dc: 'Ricarica Fast DC' };
const NOMI_IN_FRASE = { benzina: 'benzina', gasolio: 'gasolio', gpl: 'GPL', metano: 'metano', elettrica_ac: 'ricarica lenta', elettrica_dc: 'ricarica veloce' };

// ---------- Stato ----------
let distributoriCarburante = []; // Dati reali MIMIT (benzina, gasolio, gpl, metano)
let distributoriEV = [];         // Dati dinamici da OpenChargeMap
let tariffeOperatori = {};       // Listino prezzi EV reale (dal tuo script Python)
let dataPrezzi = '';             // giorno a cui si riferiscono i prezzi, es. "3 ottobre"
let carburante = 'benzina';      // Determina cosa mostrare ('benzina', 'elettrica_ac', ecc.)
let posizioneUtente = null;      // [lon, lat], quando il browser ce la da'
let gocce = [];                  // le gocce attualmente sulla mappa
let migliore = null;             // { d, prezzo, modo }: il piu' economico nella zona visibile
let selezionato = null;          // distributore aperto nella scheda
let caricamentoInCorso = false;  // per evitare di fare troppe chiamate all'API

// ---------- Mappa ----------
const mappa = new maplibregl.Map({
  container: 'mappa',
  style: 'https://tiles.openfreemap.org/styles/positron', 
  center: CENTRO_ITALIA,
  zoom: 5.3,
  attributionControl: {
    compact: true,
    customAttribution: `Prezzi: <a href="${LINK_MIMIT}" target="_blank">MIMIT</a> | Colonnine: OpenChargeMap`,
  },
});

const posizione = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  fitBoundsOptions: { maxZoom: 13 },
});
mappa.addControl(posizione, 'bottom-right');

posizione.on('geolocate', (evento) => {
  posizioneUtente = [evento.coords.longitude, evento.coords.latitude];
  mostraMigliore();
});
posizione.on('error', () => mostraAvviso('Posizione non disponibile.', 6000));

// ---------- Funzioni di supporto ----------

// SCEGLIE IN AUTOMATICO LA LISTA CORRETTA DA USARE
function getListaAttiva() {
  return carburante.startsWith('elettrica') ? distributoriEV : distributoriCarburante;
}

function formattaPrezzo(prezzo) {
  return prezzo.toFixed(3).replace('.', ',');
}

function formattaData(testo) {
  if (!testo) return 'Oggi';
  return new Date(testo + (testo.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
}

function nomeProprio(testo) {
  return (testo || '').toLowerCase().replace(/(^|[\s'-])\S/g, (lettera) => lettera.toUpperCase());
}

function esc(testo) {
  const sostituzioni = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(testo ?? '').replace(/[&<>"']/g, (c) => sostituzioni[c]);
}

function unita(carb) {
  if (carb === 'metano') return '€/kg';
  if (carb.startsWith('elettrica')) return '€/kWh';
  return '€/L';
}

function titoloDistributore(d) {
  if (d.bandiera === 'Pompe Bianche') return d.nome || 'Pompa bianca';
  return d.bandiera || d.nome;
}

function prezzoMigliore(d, carb) {
  const p = d.prezzi[carb];
  if (!p) return null;
  if (p.self != null && (p.servito == null || p.self <= p.servito)) return { prezzo: p.self, modo: 'self' };
  if (p.servito != null) return { prezzo: p.servito, modo: 'servito' };
  return null;
}

function distanzaKm([lon1, lat1], [lon2, lat2]) {
  const rad = (gradi) => (gradi * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function testoDistanza(d) {
  if (!posizioneUtente) return '';
  const km = distanzaKm(posizioneUtente, [d.lon, d.lat]);
  const testo = km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1).replace('.', ',')} km`;
  return `, a ${testo} da te`;
}

function linkGoogleMaps(d) { return `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lon}`; }
function linkWaze(d) { return `https://waze.com/ul?ll=${d.lat},${d.lon}&navigate=yes`; }

function mostraAvviso(testo, durataMs) {
  const avviso = document.getElementById('avviso');
  avviso.textContent = testo;
  avviso.hidden = false;
  if (durataMs) setTimeout(() => { avviso.hidden = true; }, durataMs);
}

function aggiornaSpazioBasso() {
  const aperto = [...document.querySelectorAll('.pannello')].find((p) => !p.hidden);
  const altezza = aperto ? aperto.offsetHeight + 12 : 0;
  document.documentElement.style.setProperty('--spazio-basso', `${altezza}px`);
}

// ---------- Dati Statici ----------
async function caricaDati() {
  try {
    const risTariffe = await fetch('data/tariffe.json');
    if (risTariffe.ok) {
      const datiTariffe = await risTariffe.json();
      tariffeOperatori = datiTariffe.operatori;
    }
  } catch (e) {
    console.warn("File tariffe.json non trovato, uso default.");
    tariffeOperatori = { "default": { ac: 0.60, dc: 0.80 } };
  }

  try {
    const risCarburanti = await fetch('data/distributori.json');
    if (!risCarburanti.ok) throw new Error(`HTTP ${risCarburanti.status}`);
    const dati = await risCarburanti.json();
    distributoriCarburante = dati.distributori;
    
    if (dati.estrazione && typeof formattaData === 'function') {
      dataPrezzi = formattaData(dati.estrazione);
    }
  } catch (e) {
    console.error("Dati carburanti non trovati.");
  }
}

// ---------- Dati Dinamici (API Elettrico) ----------
async function caricaDatiDinamici() {
  if (!carburante.startsWith('elettrica')) return;
  if (mappa.getZoom() < ZOOM_GOCCE) return;
  if (caricamentoInCorso) return;

  caricamentoInCorso = true;
  const centro = mappa.getCenter();
  const url = `https://api.openchargemap.io/v3/poi/?output=json&latitude=${centro.lat}&longitude=${centro.lng}&distance=10&distanceunit=KM&maxresults=50&key=04166cac-47ee-4596-bbc0-c030cfb71453`;

  try {
    const ris = await fetch(url);
    const dati = await ris.json();
    
    let nuoviAggiunti = false;
    
    dati.forEach(poi => {
      const idGoccia = 'ocm_' + poi.ID;
      
      // Salva nella lista EV
      if (!distributoriEV.find(d => d.id === idGoccia)) {
        const haAC = poi.Connections?.some(c => c.LevelID <= 2 || c.PowerKW <= 22);
        const haDC = poi.Connections?.some(c => c.LevelID === 3 || c.PowerKW > 22);
        
        const nomeOperatore = poi.OperatorInfo?.Title || 'Operatore Indipendente';
        const opLower = nomeOperatore.toLowerCase();
        
        // Applica i prezzi reali dal listino
        let tariffa = tariffeOperatori["default"] || { ac: 0.60, dc: 0.80 };
        for (const [chiave, tariffe] of Object.entries(tariffeOperatori)) {
          if (opLower.includes(chiave)) {
            tariffa = tariffe;
            break;
          }
        }

        const nuovoDistributore = {
          id: idGoccia,
          nome: poi.AddressInfo?.Title || 'Colonnina',
          bandiera: nomeOperatore,
          indirizzo: poi.AddressInfo?.AddressLine1 || '',
          comune: poi.AddressInfo?.Town || '',
          lat: poi.AddressInfo?.Latitude,
          lon: poi.AddressInfo?.Longitude,
          prezzi: {
             elettrica_ac: haAC ? { self: tariffa.ac } : null,
             elettrica_dc: haDC ? { self: tariffa.dc } : null,
          },
          altri: {},
          aggiornato: poi.DateLastStatusUpdate || new Date().toISOString()
        };
        
        distributoriEV.push(nuovoDistributore);
        nuoviAggiunti = true;
      }
    });

    if (nuoviAggiunti) {
      aggiornaSorgentePuntini();
      aggiornaGocce();
    }
  } catch (e) {
    console.error("Errore API Colonnine:", e);
  }
  caricamentoInCorso = false;
}

// ---------- Puntini ----------
function aggiornaSorgentePuntini() {
  const sorgente = mappa.getSource('distributori');
  if (sorgente) {
    sorgente.setData({
      type: 'FeatureCollection',
      features: getListaAttiva().map((d) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
        properties: Object.fromEntries(Object.keys(NOMI).map((c) => [c, prezzoMigliore(d, c) != null])),
      })),
    });
  }
}

function aggiungiPuntini() {
  mappa.addSource('distributori', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  
  mappa.addLayer({
    id: 'puntini',
    type: 'circle',
    source: 'distributori',
    filter: ['==', ['get', carburante], true],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 11, 4],
      'circle-color': '#14201A',
      'circle-opacity': 0.45,
    },
  });

  mappa.on('click', 'puntini', (evento) => mappa.easeTo({ center: evento.lngLat, zoom: Math.max(mappa.getZoom() + 1.5, ZOOM_GOCCE + 1) }));
  mappa.on('mouseenter', 'puntini', () => { mappa.getCanvas().style.cursor = 'pointer'; });
  mappa.on('mouseleave', 'puntini', () => { mappa.getCanvas().style.cursor = ''; });
  
  aggiornaSorgentePuntini();
}

// ---------- Gocce ----------
function aggiornaGocce() {
  gocce.forEach((marker) => marker.remove());
  gocce = [];
  migliore = null;

  if (mappa.getZoom() < ZOOM_GOCCE) {
    mostraMigliore();
    return;
  }

  const area = mappa.getBounds();
  const visibili = getListaAttiva()
    .filter((d) => area.contains([d.lon, d.lat]))
    .map((d) => ({ d, ...prezzoMigliore(d, carburante) }))
    .filter((v) => v.prezzo != null)
    .sort((a, b) => a.prezzo - b.prezzo);

  if (visibili.length === 0) {
    mostraMigliore();
    return;
  }

  const riferimento = visibili[Math.floor((visibili.length - 1) * 0.1)].prezzo;
  const scelte = [];
  
  for (const v of visibili) {
    const punto = mappa.project([v.d.lon, v.d.lat]); 
    const sovrapposta = scelte.some((s) => Math.abs(s.punto.x - punto.x) < SPAZIO_GOCCIA.x && Math.abs(s.punto.y - punto.y) < SPAZIO_GOCCIA.y);
    if (!sovrapposta) scelte.push({ ...v, punto });
  }
  migliore = scelte[0];

  for (let k = scelte.length - 1; k >= 0; k--) {
    const { d, prezzo, modo } = scelte[k];
    
    let fascia = 'rosso';
    if (carburante.startsWith('elettrica')) {
      fascia = 'elettrica';
    } else {
      fascia = prezzo <= riferimento * (1 + MARGINE_VERDE) ? 'verde' : prezzo <= riferimento * (1 + MARGINE_GIALLO) ? 'giallo' : 'rosso';
    }
    
    const piuEconomico = k === 0 && !carburante.startsWith('elettrica');

    const elemento = document.createElement('button');
    elemento.type = 'button';
    elemento.className = `goccia ${fascia}${piuEconomico ? ' migliore' : ''}`;
    elemento.innerHTML = `<span>${formattaPrezzo(prezzo)}</span>`;
    elemento.addEventListener('click', (e) => { e.stopPropagation(); apriScheda(d); });

    const lato = piuEconomico ? 52 : 44;
    const marker = new maplibregl.Marker({ element: elemento, anchor: 'bottom', offset: [0, -Math.round(lato * 0.21)] })
      .setLngLat([d.lon, d.lat])
      .addTo(mappa);
    gocce.push(marker);
  }
  mostraMigliore();
}

// ---------- Interfaccia ----------
function mostraMigliore() {
  const riquadro = document.getElementById('migliore');
  const lontano = mappa.getZoom() < ZOOM_GOCCE;

  document.getElementById('suggerimento').hidden = !lontano || selezionato != null || getListaAttiva().length === 0;
  riquadro.hidden = lontano || selezionato != null || getListaAttiva().length === 0;

  if (!riquadro.hidden) {
    if (!migliore) {
      riquadro.innerHTML = `<p class="vuoto">Nessun impianto per ${NOMI_IN_FRASE[carburante]} visibile. Prova a spostare la mappa.</p>`;
    } else {
      const { d, prezzo, modo } = migliore;
      const etichetta = carburante.startsWith('elettrica') ? 'Colonnina in questa zona' : 'Il più economico in questa zona';
      riquadro.innerHTML = `
        <p class="etichetta">${etichetta}</p>
        <p class="prezzo-grande">${formattaPrezzo(prezzo)} <small>${unita(carburante)} ${NOMI_IN_FRASE[carburante]} ${modo}</small></p>
        <p class="luogo">${esc(titoloDistributore(d))}, ${esc(d.indirizzo)}${testoDistanza(d)}</p>
        <div class="azioni">
          <a class="bottone primario" href="${linkGoogleMaps(d)}" target="_blank" rel="noopener">Portami lì</a>
          <button type="button" class="bottone secondario" data-azione="listino">Dettagli</button>
        </div>`;
      riquadro.querySelector('[data-azione="listino"]').addEventListener('click', () => apriScheda(d));
    }
  }
  aggiornaSpazioBasso();
}

function rigaListino(nome, prezzi, evidenziata) {
  const cella = (valore) => (valore != null ? `<td>${formattaPrezzo(valore)}</td>` : '<td class="manca"><span aria-hidden="true">—</span></td>');
  return `<tr${evidenziata ? ' class="scelto"' : ''}><th scope="row">${nome}</th>${cella(prezzi.self)}${cella(prezzi.servito)}</tr>`;
}

function apriScheda(d, spostaFocus = true) {
  selezionato = d;
  const scheda = document.getElementById('scheda');

  const principali = Object.keys(NOMI)
    .filter((c) => d.prezzi[c])
    .map((c) => rigaListino(NOMI[c], d.prezzi[c], c === carburante))
    .join('');

  scheda.innerHTML = `
    <div class="scheda-testa">
      <span class="iniziale" aria-hidden="true">${esc(titoloDistributore(d).charAt(0))}</span>
      <div>
        <h2 id="scheda-titolo">${esc(titoloDistributore(d))}</h2>
        <p class="luogo">${esc(d.indirizzo)}, ${esc(nomeProprio(d.comune))}${testoDistanza(d)}</p>
      </div>
      <button type="button" class="chiudi" aria-label="Chiudi scheda">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="listino-box">
      <table class="listino">
        <thead><tr><th scope="col">Costo</th><th scope="col">Self/Base</th><th scope="col">Servito/Premium</th></tr></thead>
        <tbody>${principali}</tbody>
      </table>
    </div>
    <div class="azioni">
      <a class="bottone primario" href="${linkGoogleMaps(d)}" target="_blank">Portami lì (Maps)</a>
      <a class="bottone secondario" href="${linkWaze(d)}" target="_blank">Apri Waze</a>
    </div>`;

  scheda.hidden = false;
  scheda.scrollTop = 0;
  scheda.querySelector('.chiudi').addEventListener('click', chiudiScheda);
  mostraMigliore(); 
}

function chiudiScheda() {
  if (!selezionato) return;
  selezionato = null;
  document.getElementById('scheda').hidden = true;
  mostraMigliore();
}

// ---------- Eventi Base ----------
document.querySelectorAll('#carburanti button').forEach((pulsante) => {
  pulsante.addEventListener('click', () => {
    carburante = pulsante.dataset.carburante;
    document.querySelectorAll('#carburanti button').forEach((altro) => altro.setAttribute('aria-pressed', String(altro === pulsante)));
    
    if (mappa.getLayer('puntini')) mappa.setFilter('puntini', ['==', ['get', carburante], true]);
    
    caricaDatiDinamici(); // Se clicco su elettrica, fa la chiamata API
    
    aggiornaSorgentePuntini(); // Rinfresca la sorgente dei puntini lontani
    aggiornaGocce();           // Rinfresca i marker da vicino
    
    if (selezionato) apriScheda(selezionato, false);
  });
});

document.addEventListener('keydown', (evento) => { if (evento.key === 'Escape') chiudiScheda(); });

// ---------- Avvio ----------
mappa.on('load', async () => {
  posizione.trigger(); 
  await caricaDati();
  aggiungiPuntini();
  aggiornaGocce();
  
  // Eventi per scaricare i dati dinamicamente ad ogni fine spostamento mappa
  mappa.on('moveend', () => {
    aggiornaGocce();
    caricaDatiDinamici();
  });
  mappa.on('click', chiudiScheda);
});