"use strict";

(() => {
  const CONTROL_SCOPE = "user-modify-playback-state";
  const CONTROL_PERMISSION_KEY = "kickrSpotifyControlsGrantedV1";
  const mount = document.querySelector("#spotifyControlMount");

  if (!mount || typeof SPOTIFY === "undefined") return;

  if (!SPOTIFY.scopes.includes(CONTROL_SCOPE)) {
    SPOTIFY.scopes.push(CONTROL_SCOPE);
  }

  mount.innerHTML = `
    <section class="spotify-controller" aria-label="Spotify styring">
      <div id="spotifyPermissionNotice" class="spotify-permission-notice" hidden>
        <span>Spotify skal godkendes igen én gang for at aktivere styring.</span>
        <button id="spotifyReconnectButton" type="button">Godkend styring</button>
      </div>

      <div class="spotify-transport" role="group" aria-label="Afspilningsknapper">
        <button class="spotify-control-button" id="spotifyPreviousButton" type="button" aria-label="Forrige nummer" title="Forrige">
          <span class="spotify-control-icon">⏮</span><span>Forrige</span>
        </button>
        <button class="spotify-control-button spotify-control-primary" id="spotifyPlayButton" type="button" aria-label="Start eller fortsæt" title="Start">
          <span class="spotify-control-icon">▶</span><span>Start</span>
        </button>
        <button class="spotify-control-button" id="spotifyPauseButton" type="button" aria-label="Pause" title="Pause">
          <span class="spotify-control-icon">⏸</span><span>Pause</span>
        </button>
        <button class="spotify-control-button" id="spotifyStopButton" type="button" aria-label="Stop og gå til starten" title="Stop">
          <span class="spotify-control-icon">■</span><span>Stop</span>
        </button>
        <button class="spotify-control-button" id="spotifyNextButton" type="button" aria-label="Næste nummer" title="Næste">
          <span class="spotify-control-icon">⏭</span><span>Næste</span>
        </button>
      </div>

      <div class="spotify-volume-row">
        <button id="spotifyVolumeDownButton" class="spotify-volume-step" type="button" aria-label="Skru ned">−</button>
        <span class="spotify-speaker" aria-hidden="true">🔊</span>
        <input id="spotifyVolumeSlider" type="range" min="0" max="100" step="1" value="50" aria-label="Spotify lydstyrke">
        <output id="spotifyVolumeValue" for="spotifyVolumeSlider">50%</output>
        <button id="spotifyVolumeUpButton" class="spotify-volume-step" type="button" aria-label="Skru op">+</button>
      </div>

      <div id="spotifyControlStatus" class="spotify-control-status" aria-live="polite">
        Forbind Spotify og start afspilning på en enhed.
      </div>
    </section>
  `;

  const ui = {
    controller: mount.querySelector(".spotify-controller"),
    permissionNotice: document.querySelector("#spotifyPermissionNotice"),
    reconnectButton: document.querySelector("#spotifyReconnectButton"),
    previousButton: document.querySelector("#spotifyPreviousButton"),
    playButton: document.querySelector("#spotifyPlayButton"),
    pauseButton: document.querySelector("#spotifyPauseButton"),
    stopButton: document.querySelector("#spotifyStopButton"),
    nextButton: document.querySelector("#spotifyNextButton"),
    volumeDownButton: document.querySelector("#spotifyVolumeDownButton"),
    volumeUpButton: document.querySelector("#spotifyVolumeUpButton"),
    volumeSlider: document.querySelector("#spotifyVolumeSlider"),
    volumeValue: document.querySelector("#spotifyVolumeValue"),
    status: document.querySelector("#spotifyControlStatus"),
  };

  const commandButtons = [
    ui.previousButton,
    ui.playButton,
    ui.pauseButton,
    ui.stopButton,
    ui.nextButton,
    ui.volumeDownButton,
    ui.volumeUpButton,
    ui.volumeSlider,
  ];

  let busy = false;
  let volumeTimer = null;
  let currentVolume = 50;
  let volumeSupported = true;

  function hasSpotifyToken() {
    try {
      return Boolean(getSpotifyTokens?.()?.accessToken);
    } catch (_) {
      return false;
    }
  }

  function setControlStatus(message, type = "") {
    ui.status.textContent = message;
    ui.status.className = `spotify-control-status ${type}`.trim();
  }

  function setButtonsDisabled(disabled) {
    for (const button of commandButtons) {
      button.disabled = disabled || !hasSpotifyToken();
    }
    if (!volumeSupported) {
      ui.volumeSlider.disabled = true;
      ui.volumeDownButton.disabled = true;
      ui.volumeUpButton.disabled = true;
    }
  }

  function updatePermissionNotice(force = false) {
    const tokenExists = hasSpotifyToken();
    const permissionConfirmed = localStorage.getItem(CONTROL_PERMISSION_KEY) === "1";
    ui.permissionNotice.hidden = !(tokenExists && (!permissionConfirmed || force));
    setButtonsDisabled(false);
  }

  function updateVolumeUi(value, supported = true) {
    currentVolume = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    volumeSupported = supported !== false;
    ui.volumeSlider.value = String(currentVolume);
    ui.volumeValue.textContent = `${currentVolume}%`;

    if (!volumeSupported) {
      setControlStatus("Den aktive Spotify-enhed tillader ikke lydstyrkestyring.", "warning");
    }
    setButtonsDisabled(busy);
  }

  async function controlFetch(path, options = {}, retry = true) {
    let token = await getSpotifyAccessToken();
    if (!token) throw new Error("Forbind Spotify først.");

    const response = await fetch(`${SPOTIFY.apiBase}${path}`, {
      method: options.method || "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401 && retry) {
      token = await getSpotifyAccessToken(true);
      return controlFetch(path, options, false);
    }

    if (response.status === 403) {
      updatePermissionNotice(true);
      throw new Error("Godkend Spotify-styring igen via den grønne knap.");
    }

    if (response.status === 404) {
      throw new Error("Ingen aktiv Spotify-enhed. Start en sang i Spotify først.");
    }

    if (response.status === 429) {
      throw new Error("Spotify beder os vente et øjeblik.");
    }

    if (!response.ok && response.status !== 204) {
      throw new Error(`Spotify afviste kommandoen (${response.status}).`);
    }

    localStorage.setItem(CONTROL_PERMISSION_KEY, "1");
    updatePermissionNotice();
    return response;
  }

  async function refreshPlaybackSoon() {
    window.setTimeout(() => {
      if (typeof updateSpotifyPlayback === "function") updateSpotifyPlayback();
    }, 350);
  }

  async function runCommand(label, action) {
    if (busy) return;
    busy = true;
    setButtonsDisabled(true);
    setControlStatus(`${label}…`);

    try {
      await action();
      setControlStatus(`${label} udført`, "success");
      await refreshPlaybackSoon();
    } catch (error) {
      setControlStatus(error.message, "error");
      if (typeof showToast === "function") showToast(error.message);
      if (typeof log === "function") log(`Spotify-styring: ${error.message}`);
    } finally {
      busy = false;
      setButtonsDisabled(false);
    }
  }

  async function setVolume(value, announce = true) {
    const cleanValue = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    updateVolumeUi(cleanValue, volumeSupported);

    try {
      await controlFetch(`/me/player/volume?volume_percent=${cleanValue}`, { method: "PUT" });
      if (announce) setControlStatus(`Lydstyrke ${cleanValue}%`, "success");
    } catch (error) {
      setControlStatus(error.message, "error");
      if (typeof showToast === "function") showToast(error.message);
    }
  }

  ui.previousButton.addEventListener("click", () => runCommand("Forrige nummer", () =>
    controlFetch("/me/player/previous", { method: "POST" })
  ));

  ui.playButton.addEventListener("click", () => runCommand("Afspilning startet", () =>
    controlFetch("/me/player/play", { method: "PUT" })
  ));

  ui.pauseButton.addEventListener("click", () => runCommand("Afspilning sat på pause", () =>
    controlFetch("/me/player/pause", { method: "PUT" })
  ));

  ui.stopButton.addEventListener("click", () => runCommand("Afspilning stoppet", async () => {
    await controlFetch("/me/player/pause", { method: "PUT" });
    await new Promise(resolve => window.setTimeout(resolve, 180));
    await controlFetch("/me/player/seek?position_ms=1", { method: "PUT" });
  }));

  ui.nextButton.addEventListener("click", () => runCommand("Næste nummer", () =>
    controlFetch("/me/player/next", { method: "POST" })
  ));

  ui.volumeSlider.addEventListener("input", () => {
    const value = Number(ui.volumeSlider.value);
    updateVolumeUi(value, volumeSupported);
    window.clearTimeout(volumeTimer);
    volumeTimer = window.setTimeout(() => setVolume(value), 250);
  });

  ui.volumeDownButton.addEventListener("click", () => setVolume(currentVolume - 5));
  ui.volumeUpButton.addEventListener("click", () => setVolume(currentVolume + 5));

  ui.reconnectButton.addEventListener("click", async () => {
    localStorage.removeItem(CONTROL_PERMISSION_KEY);
    try {
      clearSpotifyAuth();
      await beginSpotifyLogin();
    } catch (error) {
      setControlStatus(error.message, "error");
    }
  });

  const originalRenderSpotifyPlayback = renderSpotifyPlayback;
  renderSpotifyPlayback = function patchedRenderSpotifyPlayback(data) {
    originalRenderSpotifyPlayback(data);

    const device = data?.device;
    if (device) {
      updateVolumeUi(device.volume_percent ?? currentVolume, device.supports_volume);
      setControlStatus(
        device.is_restricted
          ? `${device.name || "Spotify-enheden"} tillader ikke fjernstyring.`
          : `Styrer ${device.name || "den aktive Spotify-enhed"}`,
        device.is_restricted ? "warning" : ""
      );
    }

    ui.playButton.classList.toggle("is-active", Boolean(data?.is_playing));
    ui.pauseButton.classList.toggle("is-active", data?.is_playing === false);
  };

  const originalRenderSpotifyDisconnected = renderSpotifyDisconnected;
  renderSpotifyDisconnected = function patchedRenderSpotifyDisconnected() {
    originalRenderSpotifyDisconnected();
    setControlStatus("Forbind Spotify for at bruge knapperne.");
    setButtonsDisabled(true);
    updatePermissionNotice();
  };

  document.querySelector("#spotifyConnectButton")?.addEventListener("click", () => {
    setControlStatus("Åbner Spotify-login…");
  });

  document.querySelector("#spotifyDisconnectButton")?.addEventListener("click", () => {
    window.setTimeout(() => {
      setButtonsDisabled(true);
      setControlStatus("Spotify er afbrudt.");
      updatePermissionNotice();
    }, 0);
  });

  updatePermissionNotice();
  setButtonsDisabled(false);

  if (hasSpotifyToken()) {
    setControlStatus("Henter aktiv Spotify-enhed…");
    if (typeof updateSpotifyPlayback === "function") updateSpotifyPlayback();
  }
})();
