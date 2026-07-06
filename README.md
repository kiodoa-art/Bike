# KICKR Live

KICKR Live er en browserbaseret træningsapp til indendørs cykling. Den viser live-data fra en Wahoo KICKR og en Bluetooth-pulsmåler, sammenligner turen med tidligere træningsdata og kan gemme hver tur som JSON-fil.

Appen er lavet som en statisk PWA, så den kan hostes direkte på GitHub Pages uden backend, database eller build-proces.

## Hvad appen kan

- Live watt fra Wahoo KICKR
- 3-sekunders wattvisning
- Kadence
- Puls via Bluetooth-pulsmåler
- Distanceberegning fra FTMS/speed-data
- Graf for watt de seneste 10 minutter
- Graf for puls de seneste 10 minutter
- Tid, gennemsnitlig watt, max watt og distance
- Sammenligning med sidste tur og 30-dages gennemsnit
- Automatisk start af tur, når der registreres bevægelse/data
- Gemmer færdige ture som JSON
- Spotify “nu afspilles” med styring af afspilning
- Installerbar PWA
- Fuldskærmstilstand
- Testvisning uden træningsudstyr

## Formål

Appen er bygget til brug på en tablet eller computer ved siden af MyWhoosh, Zwift eller anden indoor cycling-software.

Målet er ikke at erstatte Garmin, Zwift eller MyWhoosh fuldstændigt. Målet er at have sit eget simple dashboard, hvor data gemmes i et åbent JSON-format, som senere kan bruges i en egen Training History-app.

## Krav

Appen kræver en browser med Web Bluetooth.

Anbefalet:

- Microsoft Edge
- Google Chrome
- HTTPS-hosting, fx GitHub Pages
- Wahoo KICKR eller anden træner med Cycling Power / FTMS
- Bluetooth-pulsmåler, hvis puls skal vises
- Spotify Premium, hvis Spotify-styring skal bruges

Appen skal køres via HTTPS eller `localhost`. Den skal ikke åbnes direkte som en lokal fil, da Bluetooth, service worker, PWA-installation og filadgang ellers ikke virker korrekt.

## Kør appen lokalt

Der er ingen build-proces.

Start en simpel lokal webserver i projektmappen, fx:

```bash
python -m http.server 4173
```

Åbn derefter:

```text
http://localhost:4173/
```

Brug Edge eller Chrome. Safari og Firefox er ikke et realistisk valg til denne app, fordi Web Bluetooth-understøttelsen ikke er god nok.

## Deployment på GitHub Pages

Upload filerne til roden af GitHub-repoet, og slå GitHub Pages til.

Typisk filstruktur:

```text
/
├── index.html
├── app.js
├── spotify.js
├── spotify-controls.js
├── spotify-controls.css
├── styles.css
├── sw.js
├── manifest.webmanifest
├── README.md
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── data/
    └── training-history.json
```

Hvis appen bliver ved med at vise en gammel version efter upload, så ændr cache-navnet øverst i `sw.js`. Det tvinger service worker til at hente de nye filer.

Eksempel:

```js
const CACHE_NAME = 'kickr-live-v20';
```

## Brug af appen

1. Åbn appen i Edge eller Chrome.
2. Tryk på **Forbind KICKR**.
3. Vælg din Wahoo KICKR i Bluetooth-vinduet.
4. Tryk på **Forbind puls**, hvis du bruger pulsmåler.
5. Vælg en gemmemappe under **Indstillinger**, hvis browseren understøtter det.
6. Start med at træde. Turen starter automatisk, når der kommer data.
7. Tryk på **Stop tur**, når træningen er færdig.
8. Appen gemmer turen som JSON.

Der er også en **Start testvisning** under indstillinger, så layout og grafer kan testes uden træningsudstyr.

## Gemte træningsture

Når en tur stoppes, gemmes den som JSON med dette filnavn:

```text
ride-YYYY-MM-DD-HHMM.json
```

Eksempel:

```text
ride-2026-07-06-1840.json
```

Formatet indeholder både summary og sekunddata:

```json
{
  "version": 1,
  "rideId": "...",
  "startTime": "2026-07-06T16:40:00.000Z",
  "endTime": "2026-07-06T17:10:00.000Z",
  "summary": {
    "durationSec": 1800,
    "distanceKm": 15.32,
    "avgPower": 145,
    "maxPower": 420,
    "avgHeartRate": 138,
    "maxHeartRate": 160,
    "avgCadence": 86,
    "maxCadence": 104
  },
  "samples": [
    {
      "t": 0,
      "timestamp": "2026-07-06T16:40:00.000Z",
      "power": 120,
      "heartRate": 132,
      "cadence": 84,
      "speedKmh": 28.4,
      "distanceKm": 0.01
    }
  ]
}
```

Hvis browseren understøtter File System Access API, kan appen gemme direkte i en valgt mappe. Hvis ikke, downloades JSON-filen i stedet.

## Træningshistorik

Appen læser tidligere træning fra:

```text
data/training-history.json
```

Den bruges til at vise:

- sidste tur
- 30-dages gennemsnit
- live sammenligning med den aktuelle tur

Minimumsformat:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-06T18:00:00.000Z",
  "source": "training_history_app",
  "activities": [
    {
      "id": "ride-2026-07-06-1840",
      "date": "2026-07-06",
      "startTime": "2026-07-06T16:40:00.000Z",
      "sport": "indoor_cycling",
      "durationSeconds": 1800,
      "averagePower": 145,
      "maxPower": 420,
      "averageCadence": 86,
      "averageHeartRate": 138,
      "maxHeartRate": 160,
      "distanceKm": 15.32
    }
  ]
}
```

Aktiviteter uden gyldig dato eller uden positiv `averagePower` bliver ignoreret.

## Spotify

Spotify-konfigurationen ligger i `spotify.js`.

Vigtige felter:

```js
clientId: '...'
redirectUri: 'https://kiodoa-art.github.io/Bike/'
```

Hvis appen flyttes til et andet repo, domæne eller sti, skal `redirectUri` ændres både i `spotify.js` og i Spotify Developer Dashboard.

Spotify kræver disse scopes:

```text
user-read-playback-state
user-read-currently-playing
user-modify-playback-state
```

Spotify-token gemmes lokalt i browserens `localStorage`.

## Bluetooth

Appen læser fra standard Bluetooth-profiler:

- Cycling Power Service
- Cycling Speed and Cadence Service
- Fitness Machine Service / FTMS
- Heart Rate Service

Appen skriver ikke kontrolkommandoer til træneren. Den læser kun data.

Automatisk genforbindelse forsøges, hvis browseren understøtter tidligere godkendte Bluetooth-enheder via `navigator.bluetooth.getDevices()`.

Bluetooth er stadig browser-Bluetooth. Det betyder, at første forbindelse normalt kræver et manuelt klik og valg af enhed. Det er ikke en fejl i appen, men en sikkerhedsbegrænsning i browseren.

## PWA og offline-cache

Appen har:

- `manifest.webmanifest`
- `sw.js`
- app-ikoner i `icons/`
- installationsknap i UI

Service workeren cacher appens statiske filer. Spotify API-kald og OAuth-callbacks caches ikke.

`data/training-history.json` hentes med `cache: no-store`, men appen forsøger at gemme en fallback i cachen, så historikken kan vises, hvis netværket fejler.

## Vigtige filer

| Fil | Funktion |
|---|---|
| `index.html` | Appens struktur og UI |
| `styles.css` | Layout, farver og dashboard-design |
| `app.js` | Bluetooth, live-data, grafer, historik, ride recording og PWA-logik |
| `spotify.js` | Spotify-login, tokenhåndtering og Web API-styring |
| `spotify-controls.js` | Ekstra Spotify-kontrolkode |
| `spotify-controls.css` | Styling af Spotify-kontroller |
| `sw.js` | Service worker og cache |
| `manifest.webmanifest` | PWA-installation |
| `data/training-history.json` | Træningshistorik til sammenligning |
| `icons/` | PWA-ikoner |

## Privat data

Vær opmærksom på, at `data/training-history.json` kan indeholde personlige træningsdata.

Hvis repoet er offentligt, er filen også offentlig. Det samme gælder alle JSON-filer, du uploader til repoet.

Hvis du ikke vil dele træningsdata offentligt, så hold repoet privat eller lad være med at committe personlige historikfiler.

## Kendte begrænsninger

- Web Bluetooth virker bedst i Edge og Chrome.
- Første Bluetooth-forbindelse kræver brugerhandling.
- Automatisk genforbindelse afhænger af browserens tilladelser.
- Spotify-styring kræver korrekt redirect URI.
- PWA-cache kan hænge i gamle filer, hvis cache-navnet i `sw.js` ikke ændres efter større opdateringer.
- GitHub Pages er statisk hosting, så appen kan ikke selv opdatere filer i repoet.

## Status

Appen er et personligt træningsdashboard under aktiv udvikling. Den er bygget til praktisk brug på en tablet under indoor cycling, ikke som et færdigt kommercielt produkt.
