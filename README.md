# KICKR Live – Studio dashboard med træningshistorik

Upload alle filer og mapper til roden af din Bike-app på GitHub Pages. Mappestrukturen skal bevares:

```text
Bike/
├── index.html
├── app.js
├── styles.css
├── sw.js
├── manifest.webmanifest
├── icons/
└── data/
    └── training-history.json
```

## Automatisk historik

Appen henter `data/training-history.json` ved hver opstart. Under tandhjulet kan filen genindlæses uden at genstarte appen.

Live-sammenligningen bruger:

- gennemsnitswatt fra den seneste gyldige aktivitet
- et varighedsvægtet gennemsnit af aktiviteter inden for de seneste 30 dage

Når du får en ny JSON-fil fra ChatGPT, erstatter du kun:

```text
data/training-history.json
```

Du skal ikke ændre appens øvrige filer ved hver træning.

## Vigtigt

- Bevar tidligere aktiviteter i JSON-filen. Den skal være kumulativ.
- `averagePower` skal være træningens faktiske gennemsnitswatt.
- Ukendte værdier skal stå som `null`, ikke gættes.
- Filen må ikke omdøbes.

Prompten til den anden chat ligger også i pakken som `PROMPT-TIL-TRÆNINGSHISTORIK.txt`.

## Installation på Surface

1. Åbn siden i Microsoft Edge.
2. Tryk **Installér**, når knappen vises, eller vælg **… → Apps → Installér dette websted som app**.
3. Start KICKR Live fra ikonet.
4. Brug knappen **⛶** for fuld skærm.
