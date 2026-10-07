import json
import os
from datetime import datetime

# 1. Dizionario base delle tariffe (funziona da fallback)
# Nelle versioni avanzate di questo script, potrai usare librerie come 'requests' 
# e 'BeautifulSoup' per leggere i prezzi direttamente dalle pagine web degli operatori.
tariffe_attuali = {
    "enel x": {"ac": 0.69, "dc": 0.89},
    "becharge": {"ac": 0.65, "dc": 0.85},
    "plenitude": {"ac": 0.65, "dc": 0.85},
    "a2a": {"ac": 0.59, "dc": 0.83},
    "iren": {"ac": 0.65, "dc": 0.85},
    "free to x": {"ac": 0.69, "dc": 0.89},
    "ionity": {"ac": 0.79, "dc": 0.79},
    "tesla": {"ac": 0.45, "dc": 0.55},
    "neogy": {"ac": 0.69, "dc": 0.89},
    "wroom": {"ac": 0.49, "dc": 0.69},
    "default": {"ac": 0.60, "dc": 0.80}
}

# 2. Crea la struttura JSON richiesta dall'app
dati_da_salvare = {
    "aggiornamento": datetime.now().strftime("%Y-%m-%d"),
    "operatori": tariffe_attuali
}

# 3. Trova la cartella web/data e salva il file sovrascrivendo il vecchio
percorso_file = os.path.join(os.path.dirname(__file__), '..', 'web', 'data', 'tariffe.json')

# Assicurati che la cartella esista
os.makedirs(os.path.dirname(percorso_file), exist_ok=True)

with open(percorso_file, "w", encoding="utf-8") as f:
    json.dump(dati_da_salvare, f, indent=2)

print(f"Aggiornamento completato: {percorso_file} è stato ricreato con la data di oggi.")