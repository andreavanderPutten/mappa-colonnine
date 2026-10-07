"""
Esplora gli open data del MIMIT sui prezzi dei carburanti.

Scarica i due file ufficiali (impianti e prezzi), li salva nella cartella
"dati" del progetto e stampa un riepilogo per capire com'e' fatto il dataset.

Fonte: Ministero delle Imprese e del Made in Italy - Osservatorio Prezzi Carburanti
Licenza dei dati: IODL 2.0

Uso:  python scripts/esplora_dati.py
"""

import csv
import io
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path

URL_IMPIANTI = "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv"
URL_PREZZI = "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv"

# Cartella "dati" accanto alla cartella "scripts"
CARTELLA_DATI = Path(__file__).resolve().parent.parent / "dati"


def scarica(url, nome_file):
    """Scarica un file, lo salva in CARTELLA_DATI e ne restituisce il testo."""
    richiesta = urllib.request.Request(
        url, headers={"User-Agent": "app-distributori (progetto open source)"}
    )
    with urllib.request.urlopen(richiesta, timeout=120) as risposta:
        contenuto = risposta.read()
    CARTELLA_DATI.mkdir(exist_ok=True)
    (CARTELLA_DATI / nome_file).write_bytes(contenuto)
    try:
        return contenuto.decode("utf-8-sig")
    except UnicodeDecodeError:
        return contenuto.decode("latin-1")


def leggi_csv(testo):
    """
    Struttura dei file MIMIT:
      riga 1  -> "Estrazione del AAAA-MM-GG"
      riga 2  -> nomi delle colonne
      poi     -> i dati, separati dal carattere "|"
    Restituisce: data di estrazione, nomi delle colonne, lista di righe (dizionari).
    """
    prima_riga, resto = testo.split("\n", 1)
    data_estrazione = prima_riga.replace("Estrazione del", "").strip()
    lettore = csv.reader(io.StringIO(resto), delimiter="|")
    colonne = [c.strip().lower() for c in next(lettore)]
    righe = [dict(zip(colonne, r)) for r in lettore if r]
    return data_estrazione, colonne, righe


def coordinate_valide(impianto):
    """True se le coordinate sono numeri e cadono dentro un rettangolo attorno all'Italia."""
    try:
        lat = float(impianto.get("latitudine", ""))
        lon = float(impianto.get("longitudine", ""))
    except ValueError:
        return False
    return 35.0 <= lat <= 47.5 and 6.0 <= lon <= 19.0


def giorni_di_vecchiaia(dt_comu, data_estrazione):
    """Quanti giorni prima dell'estrazione il gestore ha comunicato il prezzo."""
    try:
        comunicato = datetime.strptime(dt_comu.strip(), "%d/%m/%Y %H:%M:%S")
        estrazione = datetime.strptime(data_estrazione, "%Y-%m-%d")
    except ValueError:
        return None
    return (estrazione - comunicato).days


def main():
    print("Scarico i dati dal MIMIT (puo' volerci qualche secondo)...")
    data_imp, col_imp, impianti = leggi_csv(scarica(URL_IMPIANTI, "impianti.csv"))
    data_prz, col_prz, prezzi = leggi_csv(scarica(URL_PREZZI, "prezzi.csv"))

    # ---------------- IMPIANTI ----------------
    print(f"\n=== IMPIANTI (estrazione del {data_imp}) ===")
    print("Colonne:", col_imp)
    print("Numero impianti:", len(impianti))
    validi = sum(1 for i in impianti if coordinate_valide(i))
    print(f"Con coordinate valide: {validi} ({validi / len(impianti):.1%})")
    print("Bandiere piu' diffuse:")
    for bandiera, n in Counter(i.get("bandiera", "") for i in impianti).most_common(10):
        print(f"  {n:6d}  {bandiera}")

    # ---------------- PREZZI ----------------
    print(f"\n=== PREZZI (estrazione del {data_prz}) ===")
    print("Colonne:", col_prz)
    print("Numero righe:", len(prezzi))
    print("Tipi di carburante (i 25 piu' frequenti):")
    for carb, n in Counter(p.get("desccarburante", "") for p in prezzi).most_common(25):
        print(f"  {n:6d}  {carb}")

    benzina_self = []
    for p in prezzi:
        if p.get("desccarburante") == "Benzina" and p.get("isself") == "1":
            try:
                benzina_self.append(float(p["prezzo"]))
            except (KeyError, ValueError):
                pass
    if benzina_self:
        media = sum(benzina_self) / len(benzina_self)
        print(
            f"\nBenzina self: min {min(benzina_self):.3f} | "
            f"media {media:.3f} | max {max(benzina_self):.3f} EUR/L "
            f"({len(benzina_self)} prezzi)"
        )

    # Quanto sono "vecchi" i prezzi rispetto al giorno di estrazione
    fasce = Counter()
    for p in prezzi:
        g = giorni_di_vecchiaia(p.get("dtcomu", ""), data_prz)
        if g is None:
            fasce["data non leggibile"] += 1
        elif g <= 1:
            fasce["entro 1 giorno"] += 1
        elif g <= 7:
            fasce["entro 7 giorni"] += 1
        elif g <= 30:
            fasce["entro 30 giorni"] += 1
        else:
            fasce["piu' di 30 giorni"] += 1
    print("\nEta' dei prezzi comunicati:")
    for fascia, n in fasce.most_common():
        print(f"  {n:6d}  {fascia}")

    # ---------------- COLLEGAMENTO TRA I DUE FILE ----------------
    id_impianti = {i.get("idimpianto") for i in impianti}
    id_con_prezzi = {p.get("idimpianto") for p in prezzi}
    print("\n=== COLLEGAMENTO ===")
    print("Impianti senza nessun prezzo:", len(id_impianti - id_con_prezzi))
    print("Prezzi di impianti non in anagrafica:", len(id_con_prezzi - id_impianti))

    # Un esempio concreto: il primo impianto con coordinate valide
    esempio = next((i for i in impianti if coordinate_valide(i)), None)
    if esempio:
        print("\n=== ESEMPIO DI IMPIANTO ===")
        for chiave, valore in esempio.items():
            print(f"  {chiave}: {valore}")
        print("  Prezzi:")
        for p in prezzi:
            if p.get("idimpianto") == esempio.get("idimpianto"):
                modo = "self" if p.get("isself") == "1" else "servito"
                print(f"    {p.get('desccarburante')} ({modo}): {p.get('prezzo')}")


if __name__ == "__main__":
    main()
