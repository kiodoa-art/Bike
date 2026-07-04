# KICKR Live

Et browserbaseret træningsdashboard til Wahoo KICKR med watt, kadence, puls,
træningshistorik, testdata og Spotify-styring.

## Kør appen lokalt

Appen skal serveres via `http://localhost` eller HTTPS. Åbn den ikke direkte som
en lokal fil, da service worker, Bluetooth og flere browserfunktioner ellers ikke
virker korrekt.

Eksempel med en valgfri lokal webserver:

```text
http://localhost:4173/
```

Brug Microsoft Edge eller Google Chrome til Web Bluetooth. Knappen **Start
testvisning** under Indstillinger kan bruges uden træningsudstyr.

## Træningshistorik

Historikken ligger i `data/training-history.json`. Hver aktivitet skal som minimum
have en gyldig dato (`date` eller `startTime`) og `averagePower` større end nul.
`durationSeconds` bruges til det varighedsvægtede 30-dages-gennemsnit.

## Spotify

Spotify-konfigurationen ligger øverst i `spotify.js`. `clientId` og `redirectUri`
skal passe til den app, der er oprettet i Spotify Developer Dashboard. Redirect-URI'en
skal være registreret hos Spotify, før login virker.

## Projektfiler

- `index.html` – sidens struktur og tilgængelighedsmarkering
- `styles.css` – dashboardets layout og generelle udseende
- `spotify-controls.css` – Spotify-panelets udseende
- `app.js` – KICKR, puls, træningshistorik, testvisning og PWA-funktioner
- `spotify.js` – Spotify-login, afspilning og styring
- `sw.js` – offline-cache
- `manifest.webmanifest` – installationsoplysninger til PWA'en
