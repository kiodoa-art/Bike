# KICKR Live

En lille PWA, der læser live watt og kadence fra en Wahoo KICKR via Web Bluetooth.

## Upload til GitHub Pages

1. Opret et nyt repository, eller slet indholdet i et tomt repository.
2. Upload alle filer og mapper fra denne pakke til roden af repository'et.
3. Åbn **Settings → Pages**.
4. Vælg **Deploy from a branch**, branch **main**, mappe **/(root)**.
5. Åbn GitHub Pages-adressen i Microsoft Edge på Surface 3.

Web Bluetooth kræver HTTPS. Derfor virker Bluetooth-knappen først korrekt fra GitHub Pages eller en anden HTTPS-side. Den virker også fra `localhost`, men ikke ved at dobbeltklikke på `index.html`.

## Brug

1. Start MyWhoosh og forbind KICKR som normalt.
2. Åbn KICKR Live i Microsoft Edge på Surface 3.
3. Tryk **Forbind til KICKR** og vælg træneren.
4. Begynd at træde.

Appen abonnerer kun på måledata. Den skriver ikke til trænerens kontrolpunkt og forsøger ikke at styre modstanden.

## Hvis den ikke forbinder

- Kontrollér at Bluetooth er slået til i Windows.
- Brug Edge eller Chrome, ikke Firefox.
- Åbn `edge://bluetooth-internals` for at kontrollere, om Windows kan se KICKR.
- Luk Wahoo-appen og andre unødvendige apps, der kan have optaget Bluetooth-forbindelser.
- KICKR v5 kan normalt håndtere op til tre samtidige Bluetooth-forbindelser, men kun MyWhoosh bør styre modstanden.

## Test uden KICKR

Tryk **Start testvisning** for at se layoutet med simulerede tal.
