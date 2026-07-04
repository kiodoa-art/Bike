'use strict';

(() => {
  const CONFIG = Object.freeze({
    clientId: 'cf99ee32743343bfa30807d3195d59f9',
    redirectUri: 'https://kiodoa-art.github.io/Bike/',
    authorizeUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    apiBase: 'https://api.spotify.com/v1',
    scopes: [
      'user-read-playback-state',
      'user-read-currently-playing',
      'user-modify-playback-state',
    ],
    pollIntervalMs: 5000,
    tokenStorageKey: 'kickrSpotifyTokensV1',
    verifierStorageKey: 'kickrSpotifyPkceVerifierV1',
    stateStorageKey: 'kickrSpotifyOauthStateV1',
    controlPermissionKey: 'kickrSpotifyControlsGrantedV1',
  });

  const ui = {
    card: document.querySelector('.spotify-card'),
    connectButton: document.querySelector('#spotifyConnectButton'),
    disconnectButton: document.querySelector('#spotifyDisconnectButton'),
    status: document.querySelector('#spotifyStatus'),
    device: document.querySelector('#spotifyDevice'),
    empty: document.querySelector('#spotifyEmpty'),
    nowPlaying: document.querySelector('#spotifyNowPlaying'),
    trackLink: document.querySelector('#spotifyTrackLink'),
    cover: document.querySelector('#spotifyCover'),
    playbackState: document.querySelector('#spotifyPlaybackState'),
    trackTitle: document.querySelector('#spotifyTrackTitle'),
    artist: document.querySelector('#spotifyArtist'),
    progressFill: document.querySelector('#spotifyProgressFill'),
    elapsed: document.querySelector('#spotifyElapsed'),
    duration: document.querySelector('#spotifyDuration'),
    controller: document.querySelector('.spotify-controller'),
    permissionNotice: document.querySelector('#spotifyPermissionNotice'),
    reconnectButton: document.querySelector('#spotifyReconnectButton'),
    previousButton: document.querySelector('#spotifyPreviousButton'),
    playButton: document.querySelector('#spotifyPlayButton'),
    pauseButton: document.querySelector('#spotifyPauseButton'),
    stopButton: document.querySelector('#spotifyStopButton'),
    nextButton: document.querySelector('#spotifyNextButton'),
    volumeDownButton: document.querySelector('#spotifyVolumeDownButton'),
    volumeUpButton: document.querySelector('#spotifyVolumeUpButton'),
    volumeSlider: document.querySelector('#spotifyVolumeSlider'),
    volumeValue: document.querySelector('#spotifyVolumeValue'),
    controlStatus: document.querySelector('#spotifyControlStatus'),
  };

  const requiredElements = [
    ui.card,
    ui.connectButton,
    ui.disconnectButton,
    ui.status,
    ui.device,
    ui.empty,
    ui.nowPlaying,
    ui.trackLink,
    ui.cover,
    ui.playbackState,
    ui.trackTitle,
    ui.artist,
    ui.progressFill,
    ui.elapsed,
    ui.duration,
    ui.controller,
    ui.permissionNotice,
    ui.reconnectButton,
    ui.previousButton,
    ui.playButton,
    ui.pauseButton,
    ui.stopButton,
    ui.nextButton,
    ui.volumeDownButton,
    ui.volumeUpButton,
    ui.volumeSlider,
    ui.volumeValue,
    ui.controlStatus,
  ];

  if (requiredElements.some(element => !element)) {
    console.error('Spotify-modulet kunne ikke starte, fordi nødvendige UI-elementer mangler.');
    return;
  }

  const commandControls = [
    ui.previousButton,
    ui.playButton,
    ui.pauseButton,
    ui.stopButton,
    ui.nextButton,
    ui.volumeDownButton,
    ui.volumeUpButton,
    ui.volumeSlider,
  ];

  const state = {
    initialized: false,
    authenticated: false,
    mode: 'disconnected',
    emptyMessage: 'Forbind Spotify for at vise den aktuelle sang.',
    errorMessage: '',
    track: null,
    device: null,
    playback: null,
    volume: 50,
    volumeSupported: true,
    permissionRequired: false,
    busy: false,
    feedback: null,
  };

  let pollTimer = null;
  let progressTimer = null;
  let polling = false;
  let refreshPromise = null;
  let volumeTimer = null;

  function appLog(message) {
    if (typeof window.log === 'function') window.log(message);
    else console.info(message);
  }

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  function readStorage(storage, key) {
    try {
      return storage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function writeStorage(storage, key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeStorage(storage, key) {
    try {
      storage.removeItem(key);
    } catch (_) {
      // Storage can be blocked. There is nothing else to clean up here.
    }
  }

  function getTokens() {
    const raw = readStorage(localStorage, CONFIG.tokenStorageKey);
    if (!raw) return null;

    try {
      const tokens = JSON.parse(raw);
      return tokens?.accessToken ? tokens : null;
    } catch (_) {
      removeStorage(localStorage, CONFIG.tokenStorageKey);
      return null;
    }
  }

  function saveTokens(payload, existing = null) {
    if (!payload?.access_token) throw new Error('Spotify returnerede ikke et gyldigt adgangstoken.');

    const tokens = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || existing?.refreshToken || null,
      expiresAt: Date.now() + Math.max(0, Number(payload.expires_in || 3600) - 45) * 1000,
    };

    if (!writeStorage(localStorage, CONFIG.tokenStorageKey, JSON.stringify(tokens))) {
      throw new Error('Browseren kunne ikke gemme Spotify-login. Kontrollér browserens lagerindstillinger.');
    }

    return tokens;
  }

  function hasControlPermission() {
    return readStorage(localStorage, CONFIG.controlPermissionKey) === '1';
  }

  function setControlPermission(granted) {
    if (granted) writeStorage(localStorage, CONFIG.controlPermissionKey, '1');
    else removeStorage(localStorage, CONFIG.controlPermissionKey);
  }

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function safeHttpUrl(value, fallback = '') {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  function deriveMainStatus() {
    switch (state.mode) {
      case 'authenticating':
        return {
          status: 'Færdiggør login',
          device: 'Henter adgang fra Spotify',
          empty: 'Henter adgang fra Spotify',
        };
      case 'idle':
        return {
          status: 'Forbundet',
          device: 'Venter på afspilning',
          empty: state.emptyMessage,
        };
      case 'playing':
        return {
          status: 'Afspiller',
          device: state.device?.name || 'Spotify',
          empty: '',
        };
      case 'paused':
        return {
          status: 'Sat på pause',
          device: state.device?.name || 'Spotify',
          empty: '',
        };
      case 'error':
        return {
          status: 'Forbindelsesfejl',
          device: state.errorMessage,
          empty: state.errorMessage,
        };
      default:
        return {
          status: 'Ikke forbundet',
          device: 'Viser det, der afspilles på din Spotify-konto',
          empty: 'Forbind Spotify for at vise den aktuelle sang.',
        };
    }
  }

  function deriveControlStatus() {
    if (state.feedback) return state.feedback;

    if (!state.authenticated) {
      return state.mode === 'authenticating'
        ? { message: 'Åbner Spotify-login…', type: '' }
        : { message: 'Forbind Spotify for at bruge knapperne.', type: '' };
    }

    if (state.permissionRequired) {
      return { message: 'Godkend Spotify-styring igen via den grønne knap.', type: 'error' };
    }

    if (state.mode === 'error') {
      return { message: state.errorMessage, type: 'error' };
    }

    if (state.device?.restricted) {
      return {
        message: `${state.device.name || 'Spotify-enheden'} tillader ikke fjernstyring.`,
        type: 'warning',
      };
    }

    if (state.device) {
      return { message: `Styrer ${state.device.name || 'den aktive Spotify-enhed'}`, type: '' };
    }

    if (state.mode === 'idle') {
      return { message: state.emptyMessage, type: '' };
    }

    return { message: 'Henter aktiv Spotify-enhed…', type: '' };
  }

  function renderProgress() {
    if (!state.playback) {
      ui.progressFill.style.width = '0%';
      ui.elapsed.textContent = '0:00';
      ui.duration.textContent = '0:00';
      return;
    }

    const elapsedSinceFetch = state.playback.isPlaying
      ? Date.now() - state.playback.fetchedAt
      : 0;
    const progress = Math.min(
      state.playback.durationMs,
      state.playback.progressMs + elapsedSinceFetch,
    );
    const percent = state.playback.durationMs > 0
      ? (progress / state.playback.durationMs) * 100
      : 0;

    ui.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    ui.elapsed.textContent = formatTime(progress);
    ui.duration.textContent = formatTime(state.playback.durationMs);
  }

  function renderTrack() {
    const showTrack = (state.mode === 'playing' || state.mode === 'paused') && state.track;
    ui.empty.hidden = Boolean(showTrack);
    ui.nowPlaying.hidden = !showTrack;

    if (!showTrack) {
      ui.trackTitle.textContent = '–';
      ui.artist.textContent = '–';
      ui.trackLink.hidden = true;
      ui.trackLink.removeAttribute('href');
      ui.cover.hidden = true;
      ui.cover.removeAttribute('src');
      ui.cover.alt = 'Intet albumcover';
      ui.nowPlaying.classList.remove('no-cover');
      renderProgress();
      return;
    }

    const cover = safeHttpUrl(state.track.cover);
    const externalUrl = safeHttpUrl(state.track.externalUrl, 'https://open.spotify.com/');

    ui.playbackState.textContent = state.mode === 'playing' ? 'Afspiller nu' : 'På pause';
    ui.trackTitle.textContent = state.track.title;
    ui.artist.textContent = state.track.artist;
    ui.trackLink.href = externalUrl;
    ui.trackLink.setAttribute('aria-label', `Åbn ${state.track.title} i Spotify`);
    ui.cover.alt = cover ? `Cover til ${state.track.title}` : 'Intet albumcover';
    ui.trackLink.hidden = !cover;
    ui.cover.hidden = !cover;
    ui.nowPlaying.classList.toggle('no-cover', !cover);

    if (cover) ui.cover.src = cover;
    else ui.cover.removeAttribute('src');

    renderProgress();
  }

  function renderControls() {
    const tokenExists = Boolean(getTokens());
    const controlsDisabled = state.busy || !tokenExists;

    for (const control of commandControls) control.disabled = controlsDisabled;

    if (!state.volumeSupported) {
      ui.volumeSlider.disabled = true;
      ui.volumeDownButton.disabled = true;
      ui.volumeUpButton.disabled = true;
    }

    ui.controller.setAttribute('aria-busy', String(state.busy));
    ui.playButton.classList.toggle('is-active', state.mode === 'playing');
    ui.pauseButton.classList.toggle('is-active', state.mode === 'paused');
    ui.playButton.setAttribute('aria-pressed', String(state.mode === 'playing'));
    ui.pauseButton.setAttribute('aria-pressed', String(state.mode === 'paused'));

    ui.volumeSlider.value = String(state.volume);
    ui.volumeSlider.setAttribute('aria-valuetext', `${state.volume} procent`);
    ui.volumeValue.textContent = `${state.volume}%`;

    ui.permissionNotice.hidden = !(
      tokenExists && (state.permissionRequired || !hasControlPermission())
    );

    const controlStatus = deriveControlStatus();
    ui.controlStatus.textContent = controlStatus.message;
    ui.controlStatus.className = `spotify-control-status ${controlStatus.type}`.trim();
  }

  function render() {
    const mainStatus = deriveMainStatus();
    const showConnectedActions = state.authenticated;
    const authenticating = state.mode === 'authenticating';

    ui.card.dataset.spotifyState = state.mode;
    ui.connectButton.hidden = showConnectedActions || authenticating;
    ui.disconnectButton.hidden = !showConnectedActions;
    ui.status.textContent = mainStatus.status;
    ui.device.textContent = mainStatus.device;
    ui.empty.textContent = mainStatus.empty;

    renderTrack();
    renderControls();
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    window.clearInterval(progressTimer);
    pollTimer = null;
    progressTimer = null;
    polling = false;
  }

  function clearAuth() {
    removeStorage(localStorage, CONFIG.tokenStorageKey);
    removeStorage(sessionStorage, CONFIG.verifierStorageKey);
    removeStorage(sessionStorage, CONFIG.stateStorageKey);
    stopPolling();
    setState({
      authenticated: false,
      mode: 'disconnected',
      emptyMessage: 'Forbind Spotify for at vise den aktuelle sang.',
      errorMessage: '',
      track: null,
      device: null,
      playback: null,
      volume: 50,
      volumeSupported: true,
      permissionRequired: false,
      busy: false,
      feedback: null,
    });
  }

  function base64Url(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomString(length = 64) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function sha256Base64Url(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return base64Url(new Uint8Array(digest));
  }

  async function beginLogin() {
    if (!window.crypto?.subtle) {
      throw new Error('Browseren understøtter ikke det sikre Spotify-login.');
    }

    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);
    const oauthState = randomString(24);

    const verifierSaved = writeStorage(sessionStorage, CONFIG.verifierStorageKey, verifier);
    const stateSaved = writeStorage(sessionStorage, CONFIG.stateStorageKey, oauthState);
    if (!verifierSaved || !stateSaved) {
      throw new Error('Browseren kunne ikke gemme Spotify-login midlertidigt.');
    }

    setState({
      mode: 'authenticating',
      errorMessage: '',
      feedback: { message: 'Åbner Spotify-login…', type: '' },
    });

    const params = new URLSearchParams({
      client_id: CONFIG.clientId,
      response_type: 'code',
      redirect_uri: CONFIG.redirectUri,
      scope: CONFIG.scopes.join(' '),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state: oauthState,
    });

    window.location.assign(`${CONFIG.authorizeUrl}?${params.toString()}`);
  }

  async function exchangeCode(code) {
    const verifier = readStorage(sessionStorage, CONFIG.verifierStorageKey);
    if (!verifier) {
      throw new Error('Spotify-login kunne ikke færdiggøres. Prøv at forbinde igen.');
    }

    const body = new URLSearchParams({
      client_id: CONFIG.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: CONFIG.redirectUri,
      code_verifier: verifier,
    });

    const response = await fetch(CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error_description || payload.error || 'Spotify afviste login.');
    }

    saveTokens(payload);
    removeStorage(sessionStorage, CONFIG.verifierStorageKey);
    removeStorage(sessionStorage, CONFIG.stateStorageKey);
  }

  async function refreshAccessToken() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      const existing = getTokens();
      if (!existing?.refreshToken) throw new Error('Spotify skal forbindes igen.');

      const body = new URLSearchParams({
        client_id: CONFIG.clientId,
        grant_type: 'refresh_token',
        refresh_token: existing.refreshToken,
      });

      const response = await fetch(CONFIG.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        clearAuth();
        throw new Error(payload.error_description || 'Spotify-login er udløbet. Forbind igen.');
      }

      return saveTokens(payload, existing).accessToken;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function getAccessToken(forceRefresh = false) {
    const tokens = getTokens();
    if (!tokens?.accessToken) return null;

    if (forceRefresh || Date.now() >= Number(tokens.expiresAt || 0)) {
      return refreshAccessToken();
    }

    return tokens.accessToken;
  }

  async function apiFetch(path, options = {}, retry = true) {
    let token = await getAccessToken();
    if (!token) return null;

    const headers = { Authorization: `Bearer ${token}` };
    let body;

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await fetch(`${CONFIG.apiBase}${path}`, {
      method: options.method || 'GET',
      headers,
      body,
    });

    if (response.status === 401 && retry) {
      token = await getAccessToken(true);
      if (!token) return null;
      return apiFetch(path, options, false);
    }

    return response;
  }

  function normalizeDevice(device) {
    if (!device) return null;

    return {
      name: device.name || 'Spotify',
      volume: Math.max(0, Math.min(100, Math.round(Number(device.volume_percent) || 0))),
      supportsVolume: device.supports_volume !== false,
      restricted: Boolean(device.is_restricted),
    };
  }

  function normalizeTrack(item) {
    const isEpisode = item.type === 'episode';
    const images = isEpisode
      ? (item.images || item.show?.images || [])
      : (item.album?.images || []);

    return {
      title: item.name || 'Ukendt titel',
      artist: isEpisode
        ? (item.show?.name || 'Podcast')
        : ((item.artists || []).map(entry => entry.name).filter(Boolean).join(', ') || 'Ukendt kunstner'),
      cover: images[0]?.url || '',
      externalUrl: item.external_urls?.spotify || 'https://open.spotify.com/',
      durationMs: Number(item.duration_ms || 0),
    };
  }

  function applyPlayback(data) {
    const device = normalizeDevice(data?.device);
    const item = data?.item;

    if (!item) {
      setState({
        authenticated: true,
        mode: 'idle',
        emptyMessage: 'Spotify er forbundet, men intet afspilles lige nu.',
        errorMessage: '',
        track: null,
        playback: null,
        device,
        volume: device?.volume ?? state.volume,
        volumeSupported: device?.supportsVolume ?? true,
        feedback: null,
      });
      return;
    }

    const track = normalizeTrack(item);
    const isPlaying = Boolean(data.is_playing);

    setState({
      authenticated: true,
      mode: isPlaying ? 'playing' : 'paused',
      emptyMessage: '',
      errorMessage: '',
      track,
      device,
      playback: {
        progressMs: Number(data.progress_ms || 0),
        durationMs: track.durationMs,
        fetchedAt: Date.now(),
        isPlaying,
      },
      volume: device?.volume ?? state.volume,
      volumeSupported: device?.supportsVolume ?? true,
      feedback: null,
    });
  }

  async function updatePlayback() {
    if (polling || !getTokens()) return;
    polling = true;

    try {
      const response = await apiFetch('/me/player');
      if (!response) return;

      if (response.status === 204) {
        setState({
          authenticated: true,
          mode: 'idle',
          emptyMessage: 'Spotify er forbundet, men intet afspilles lige nu.',
          errorMessage: '',
          track: null,
          device: null,
          playback: null,
          volumeSupported: true,
          feedback: null,
        });
        return;
      }

      if (response.status === 403) {
        setState({
          authenticated: true,
          mode: 'idle',
          emptyMessage: 'Spotify afviste adgangen. Kontrollér appens brugeradgang i Spotify Developer Dashboard.',
          errorMessage: '',
          track: null,
          device: null,
          playback: null,
          feedback: null,
        });
        return;
      }

      if (response.status === 429) {
        setState({
          authenticated: true,
          mode: 'idle',
          emptyMessage: 'Spotify beder appen vente et øjeblik. Visningen prøver igen automatisk.',
          errorMessage: '',
          track: null,
          device: null,
          playback: null,
          feedback: null,
        });
        return;
      }

      if (!response.ok) throw new Error(`Spotify svarede med fejl ${response.status}.`);
      applyPlayback(await response.json());
    } catch (error) {
      appLog(`Spotify-fejl: ${error.message}`);
      setState({
        authenticated: Boolean(getTokens()),
        mode: 'error',
        errorMessage: error.message,
        track: null,
        device: null,
        playback: null,
        feedback: null,
      });
    } finally {
      polling = false;
    }
  }

  function startPolling() {
    stopPolling();
    setState({
      authenticated: true,
      mode: 'idle',
      emptyMessage: 'Spotify er forbundet, men intet afspilles lige nu.',
      errorMessage: '',
      feedback: { message: 'Henter aktiv Spotify-enhed…', type: '' },
    });
    void updatePlayback();
    pollTimer = window.setInterval(updatePlayback, CONFIG.pollIntervalMs);
    progressTimer = window.setInterval(renderProgress, 1000);
  }

  async function controlFetch(path, options = {}) {
    const response = await apiFetch(path, { method: options.method || 'PUT', body: options.body });
    if (!response) throw new Error('Forbind Spotify først.');

    if (response.status === 403) {
      setState({ permissionRequired: true });
      throw new Error('Godkend Spotify-styring igen via den grønne knap.');
    }

    if (response.status === 404) {
      throw new Error('Ingen aktiv Spotify-enhed. Start en sang i Spotify først.');
    }

    if (response.status === 429) {
      throw new Error('Spotify beder os vente et øjeblik.');
    }

    if (!response.ok && response.status !== 204) {
      throw new Error(`Spotify afviste kommandoen (${response.status}).`);
    }

    setControlPermission(true);
    setState({ permissionRequired: false });
    return response;
  }

  function refreshPlaybackSoon() {
    window.setTimeout(() => void updatePlayback(), 350);
  }

  async function runCommand(label, action) {
    if (state.busy) return;

    setState({
      busy: true,
      feedback: { message: `${label}…`, type: '' },
    });

    try {
      await action();
      setState({ feedback: { message: `${label} udført`, type: 'success' } });
      refreshPlaybackSoon();
    } catch (error) {
      setState({ feedback: { message: error.message, type: 'error' } });
      toast(error.message);
      appLog(`Spotify-styring: ${error.message}`);
    } finally {
      setState({ busy: false });
    }
  }

  async function setVolume(value, announce = true) {
    const cleanValue = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    setState({ volume: cleanValue });

    try {
      await controlFetch(`/me/player/volume?volume_percent=${cleanValue}`, { method: 'PUT' });
      if (announce) {
        setState({ feedback: { message: `Lydstyrke ${cleanValue}%`, type: 'success' } });
      }
    } catch (error) {
      setState({ feedback: { message: error.message, type: 'error' } });
      toast(error.message);
      appLog(`Spotify-styring: ${error.message}`);
    }
  }

  function bindEvents() {
    ui.connectButton.addEventListener('click', async () => {
      try {
        await beginLogin();
      } catch (error) {
        appLog(`Spotify-loginfejl: ${error.message}`);
        setState({
          mode: 'error',
          errorMessage: error.message,
          feedback: { message: error.message, type: 'error' },
        });
        toast(error.message);
      }
    });

    ui.disconnectButton.addEventListener('click', () => {
      clearAuth();
      toast('Spotify er afbrudt');
    });

    ui.reconnectButton.addEventListener('click', async () => {
      setControlPermission(false);
      clearAuth();
      try {
        await beginLogin();
      } catch (error) {
        appLog(`Spotify-loginfejl: ${error.message}`);
        setState({
          mode: 'error',
          errorMessage: error.message,
          feedback: { message: error.message, type: 'error' },
        });
        toast(error.message);
      }
    });

    ui.previousButton.addEventListener('click', () => runCommand(
      'Forrige nummer',
      () => controlFetch('/me/player/previous', { method: 'POST' }),
    ));

    ui.playButton.addEventListener('click', () => runCommand(
      'Afspilning startet',
      () => controlFetch('/me/player/play', { method: 'PUT' }),
    ));

    ui.pauseButton.addEventListener('click', () => runCommand(
      'Afspilning sat på pause',
      () => controlFetch('/me/player/pause', { method: 'PUT' }),
    ));

    ui.stopButton.addEventListener('click', () => runCommand('Afspilning stoppet', async () => {
      await controlFetch('/me/player/pause', { method: 'PUT' });
      await new Promise(resolve => window.setTimeout(resolve, 180));
      await controlFetch('/me/player/seek?position_ms=1', { method: 'PUT' });
    }));

    ui.nextButton.addEventListener('click', () => runCommand(
      'Næste nummer',
      () => controlFetch('/me/player/next', { method: 'POST' }),
    ));

    ui.volumeSlider.addEventListener('input', () => {
      const value = Number(ui.volumeSlider.value);
      setState({ volume: value });
      window.clearTimeout(volumeTimer);
      volumeTimer = window.setTimeout(() => void setVolume(value), 250);
    });

    ui.volumeDownButton.addEventListener('click', () => void setVolume(state.volume - 5));
    ui.volumeUpButton.addEventListener('click', () => void setVolume(state.volume + 5));

    window.addEventListener('beforeunload', stopPolling);
  }

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    bindEvents();

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthError = params.get('error');
    const returnedState = params.get('state');

    if (oauthError) {
      history.replaceState({}, document.title, CONFIG.redirectUri);
      clearAuth();
      toast('Spotify-login blev annulleret');
      return;
    }

    if (code) {
      const expectedState = readStorage(sessionStorage, CONFIG.stateStorageKey);
      history.replaceState({}, document.title, CONFIG.redirectUri);

      if (!expectedState || returnedState !== expectedState) {
        clearAuth();
        toast('Spotify-login blev afvist af sikkerhedshensyn');
        return;
      }

      setState({
        authenticated: false,
        mode: 'authenticating',
        feedback: { message: 'Færdiggør login', type: '' },
      });

      try {
        await exchangeCode(code);
        toast('Spotify er forbundet');
      } catch (error) {
        clearAuth();
        appLog(`Spotify-loginfejl: ${error.message}`);
        setState({
          mode: 'error',
          errorMessage: error.message,
          feedback: { message: error.message, type: 'error' },
        });
        toast(error.message);
        return;
      }
    }

    if (getTokens()) startPolling();
    else clearAuth();
  }

  window.SpotifyController = Object.freeze({
    initialize,
    connect: beginLogin,
    disconnect: clearAuth,
    refresh: updatePlayback,
    getState: () => ({
      authenticated: state.authenticated,
      mode: state.mode,
      device: state.device ? { ...state.device } : null,
      track: state.track ? { ...state.track } : null,
    }),
  });

  void initialize();
})();
