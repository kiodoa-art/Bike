# KICKR Live

En PWA til Surface/Windows, der læser live watt og kadence fra en Wahoo KICKR via Web Bluetooth og viser den aktuelle Spotify-afspilning.

## Upload til GitHub Pages

1. Upload alle filer og mapper fra pakken til roden af repository'et `Bike`.
2. Åbn **Settings → Pages**.
3. Vælg **Deploy from a branch**, branch **main**, mappe **/(root)**.
4. Åbn `https://kiodoa-art.github.io/Bike/` i Microsoft Edge.

Web Bluetooth kræver HTTPS. Bluetooth-forbindelsen virker derfor fra GitHub Pages, men ikke ved at dobbeltklikke på `index.html`.

## KICKR

1. Start MyWhoosh og forbind KICKR som normalt.
2. Åbn KICKR Live i Microsoft Edge på Surface 3.
3. Tryk **Forbind til KICKR** og vælg træneren.
4. Begynd at træde.

Appen abonnerer kun på måledata. Den skriver ikke til trænerens kontrolpunkt og forsøger ikke at styre modstanden.

## Spotify

Spotify Client ID er allerede indsat i appen.

1. Sørg for, at denne Redirect URI står præcist i Spotify Developer Dashboard:
   `https://kiodoa-art.github.io/Bike/`
2. Åbn KICKR Live og tryk **Forbind Spotify**.
3. Godkend læseadgang til den aktuelle afspilning.
4. Efter tilbagevending viser appen sangtitel, kunstner/podcast, albumcover, afspilningsenhed og tidslinje.

Spotify-login genindlæser siden. Derfor skal KICKR forbindes igen efter det første Spotify-login. Senere kan Spotify normalt genforbindes automatisk via det gemte refresh token.

Appen beder kun om læseadgang:

- `user-read-playback-state`
- `user-read-currently-playing`

Der bruges ingen Client Secret i GitHub-koden.

## Hvis KICKR ikke forbinder

- Kontrollér, at Bluetooth er slået til i Windows.
- Brug Edge eller Chrome, ikke Firefox.
- Åbn `edge://bluetooth-internals` for at kontrollere, om Windows kan se KICKR.
- Luk Wahoo-appen og andre unødvendige apps, der kan have optaget Bluetooth-forbindelser.
- KICKR v5 kan normalt håndtere op til tre samtidige Bluetooth-forbindelser, men kun MyWhoosh bør styre modstanden.

## Test uden KICKR

Tryk **Start testvisning** for at se layoutet med simulerede tal.
