"""
Prepara i dati per l'app.

Scarica i file del MIMIT, li pulisce e scrive web/data/distributori.json,
il file che la mappa leggera'.

Regole di pulizia:
- tiene solo gli impianti con coordinate valide e almeno un prezzo
- i 4 carburanti principali (Benzina, Gasolio, GPL, Metano) entrano nel confronto;
  tutti gli altri (Blue Diesel, HVO, ...) finiscono in "altri" e compaiono solo nel listino
- scarta i prezzi comunicati da piu' di MAX_GIORNI giorni
- scarta i prezzi anomali: fuori dall'intervallo SOGLIA_BASSA-SOGLIA_ALTA
  rispetto alla mediana nazionale dello stesso carburante e modalita' (self o servito)

Fonte dei dati: MIMIT - Osservatorio prezzi carburanti, licenza IODL 2.0

Uso:  python scripts/prepara_dati.py
"""

import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import median

# Riusiamo le funzioni gia' scritte nello script di esplorazione
from esplora_dati import URL_IMPIANTI, URL_PREZZI, coordinate_valide, leggi_csv, scarica

FILE_USCITA = Path(__file__).resolve().parent.parent / "web" / "data" / "distributori.json"

# Nome nel file MIMIT -> nome che usiamo nell'app
CARBURANTI_PRINCIPALI = {
    "Benzina": "benzina",
    "Gasolio": "gasolio",
    "GPL": "gpl",
    "Metano": "metano",
}
MAX_GIORNI = 30      # prezzi piu' vecchi di cosi' vengono scartati
SOGLIA_BASSA = 0.75  # sotto il 75% della mediana -> anomalo
SOGLIA_ALTA = 1.40   # sopra il 140% della mediana -> anomalo


def pulisci(testo):
    """Toglie gli spazi in eccesso: '  VIA  ROMA  1 ' -> 'VIA ROMA 1'."""
    return re.sub(r"\s+", " ", testo or "").strip()


def leggi_prezzi_validi(righe, data_estrazione, scartati):
    """
    Restituisce {idimpianto: {(carburante, is_self): (prezzo, data_comunicazione)}}.
    Se lo stesso carburante compare piu' volte per un impianto, tiene la comunicazione piu' recente.
    """
    estrazione = datetime.strptime(data_estrazione, "%Y-%m-%d")
    per_impianto = defaultdict(dict)

    for r in righe:
        try:
            prezzo = float(r["prezzo"])
            comunicato = datetime.strptime(r["dtcomu"].strip(), "%d/%m/%Y %H:%M:%S")
        except (KeyError, ValueError):
            scartati["riga illeggibile"] += 1
            continue

        if (estrazione - comunicato).days > MAX_GIORNI:
            scartati[f"prezzo piu' vecchio di {MAX_GIORNI} giorni"] += 1
            continue
        if not 0.3 <= prezzo <= 5.0:
            scartati["prezzo impossibile"] += 1
            continue

        chiave = (pulisci(r.get("desccarburante")), r.get("isself", "").strip() == "1")
        id_imp = r.get("idimpianto", "").strip()
        precedente = per_impianto[id_imp].get(chiave)
        if precedente is None or comunicato > precedente[1]:
            per_impianto[id_imp][chiave] = (prezzo, comunicato)

    return per_impianto


def calcola_mediane(per_impianto):
    """Mediana nazionale per ogni (carburante principale, self/servito)."""
    valori = defaultdict(list)
    for prezzi in per_impianto.values():
        for (nome, is_self), (prezzo, _) in prezzi.items():
            if nome in CARBURANTI_PRINCIPALI:
                valori[(nome, is_self)].append(prezzo)
    return {chiave: median(lista) for chiave, lista in valori.items()}


def costruisci_distributori(impianti, per_impianto, mediane, scartati):
    """Unisce anagrafica e prezzi in una lista di distributori pronta per la mappa."""
    distributori = []

    for imp in impianti:
        id_imp = imp.get("idimpianto", "").strip()
        if not coordinate_valide(imp):
            scartati["impianto senza coordinate valide"] += 1
            continue
        prezzi = per_impianto.get(id_imp)
        if not prezzi:
            scartati["impianto senza prezzi"] += 1
            continue

        principali, altri, ultimo_aggiornamento = {}, {}, None
        for (nome, is_self), (prezzo, comunicato) in prezzi.items():
            if nome in CARBURANTI_PRINCIPALI:
                m = mediane[(nome, is_self)]
                if not SOGLIA_BASSA * m <= prezzo <= SOGLIA_ALTA * m:
                    scartati["prezzo anomalo"] += 1
                    continue
                voce = principali.setdefault(CARBURANTI_PRINCIPALI[nome], {"self": None, "servito": None})
            else:
                voce = altri.setdefault(nome, {"self": None, "servito": None})
            voce["self" if is_self else "servito"] = round(prezzo, 3)
            if ultimo_aggiornamento is None or comunicato > ultimo_aggiornamento:
                ultimo_aggiornamento = comunicato

        if ultimo_aggiornamento is None:  # tutti i suoi prezzi erano anomali
            scartati["impianto con soli prezzi anomali"] += 1
            continue

        distributori.append({
            "id": int(id_imp) if id_imp.isdigit() else id_imp,
            "bandiera": pulisci(imp.get("bandiera")),
            "nome": pulisci(imp.get("nome impianto")),
            "indirizzo": pulisci(imp.get("indirizzo")),
            "comune": pulisci(imp.get("comune")),
            "provincia": pulisci(imp.get("provincia")),
            "autostrada": pulisci(imp.get("tipo impianto")) == "Autostradale",
            "lat": round(float(imp["latitudine"]), 6),
            "lon": round(float(imp["longitudine"]), 6),
            "prezzi": principali,
            "altri": altri,
            "aggiornato": ultimo_aggiornamento.strftime("%Y-%m-%d"),
        })

    return distributori


def main():
    print("Scarico i dati dal MIMIT...")
    data_imp, _, impianti = leggi_csv(scarica(URL_IMPIANTI, "impianti.csv"))
    data_prz, _, righe_prezzi = leggi_csv(scarica(URL_PREZZI, "prezzi.csv"))
    if data_imp != data_prz:
        print(f"ATTENZIONE: date di estrazione diverse ({data_imp} / {data_prz})")

    scartati = Counter()
    per_impianto = leggi_prezzi_validi(righe_prezzi, data_prz, scartati)
    mediane = calcola_mediane(per_impianto)
    distributori = costruisci_distributori(impianti, per_impianto, mediane, scartati)

    risultato = {
        "estrazione": data_prz,
        "fonte": "MIMIT - Osservatorio prezzi carburanti, licenza IODL 2.0",
        "distributori": distributori,
    }
    FILE_USCITA.parent.mkdir(parents=True, exist_ok=True)
    FILE_USCITA.write_text(
        json.dumps(risultato, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    # ---------------- RIEPILOGO ----------------
    print(f"\nDistributori nel file: {len(distributori)}")
    print("\nMediane nazionali (EUR/L, metano EUR/kg):")
    for (nome, is_self), m in sorted(mediane.items()):
        print(f"  {nome:8s} {'self' if is_self else 'servito':8s} {m:.3f}")
    print("\nScartati:")
    for motivo, n in scartati.most_common():
        print(f"  {n:6d}  {motivo}")
    megabyte = FILE_USCITA.stat().st_size / 1_000_000
    print(f"\nFile scritto: {FILE_USCITA} ({megabyte:.1f} MB)")


if __name__ == "__main__":
    main()
