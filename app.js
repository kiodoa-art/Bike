'use strict';

let toastTimer = null;

function log(message) {
  const target = document.querySelector('#debugLog');
  if (!target) return;
  const stamp = new Date().toLocaleTimeString('da-DK', { hour12: false });
  target.textContent = `[${stamp}] ${message}\n${target.textContent}`.slice(0, 7000);
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3400);
}

// Standard Bluetooth SIG UUIDs. The app only subscribes to notifications.
// It never opens or writes to any control-point characteristic.
const UUID = {
  cyclingPowerService: 0x1818,
  cyclingPowerMeasurement: 0x2a63,
  cscService: 0x1816,
  cscMeasurement: 0x2a5b,
  fitnessMachineService: 0x1826,
  indoorBikeData: 0x2ad2,
  heartRateService: 0x180d,
  heartRateMeasurement: 0x2a37,
};

const els = {
  connectButton: document.querySelector('#connectButton'),
  disconnectButton: document.querySelector('#disconnectButton'),
  resetButton: document.querySelector('#resetButton'),
  demoButton: document.querySelector('#demoButton'),
  installButton: document.querySelector('#installButton'),
  settingsButton: document.querySelector('#settingsButton'),
  closeSettingsButton: document.querySelector('#closeSettingsButton'),
  settingsPanel: document.querySelector('#settingsPanel'),
  settingsBackdrop: document.querySelector('#settingsBackdrop'),
  fullscreenButton: document.querySelector('#fullscreenButton'),
  statusDot: document.querySelector('#statusDot'),
  statusText: document.querySelector('#statusText'),
  deviceText: document.querySelector('#deviceText'),
  powerValue: document.querySelector('#powerValue'),
  cadenceValue: document.querySelector('#cadenceValue'),
  averagePower: document.querySelector('#averagePower'),
  maxPower: document.querySelector('#maxPower'),
  distanceValue: document.querySelector('#distanceValue'),
  elapsedTime: document.querySelector('#elapsedTime'),
  powerHint: document.querySelector('#powerHint'),
  dataSource: document.querySelector('#dataSource'),
  heartRateConnectButton: document.querySelector('#heartRateConnectButton'),
  heartRateDisconnectButton: document.querySelector('#heartRateDisconnectButton'),
  heartRateValue: document.querySelector('#heartRateValue'),
  heartRateState: document.querySelector('#heartRateState'),
  heartStatusDot: document.querySelector('#heartStatusDot'),
  heartRateConnectionText: document.querySelector('#heartRateConnectionText'),
  cadenceRing: document.querySelector('#cadenceRing'),
  heartRateRing: document.querySelector('#heartRateRing'),
  heartChartAverage: document.querySelector('#heartChartAverage'),
  heartChartLine: document.querySelector('#heartChartLine'),
  heartChartArea: document.querySelector('#heartChartArea'),
  heartChartEmpty: document.querySelector('#heartChartEmpty'),
  powerZone: document.querySelector('#powerZone'),
  chartAverage: document.querySelector('#chartAverage'),
  powerChartLine: document.querySelector('#powerChartLine'),
  powerChartArea: document.querySelector('#powerChartArea'),
  powerChartDot: document.querySelector('#powerChartDot'),
  timeProgress: document.querySelector('#timeProgress'),
  lastRideDelta: document.querySelector('#lastRideDelta'),
  thirtyDayDelta: document.querySelector('#thirtyDayDelta'),
  trendText: document.querySelector('#trendText'),
  comparisonKicker: document.querySelector('#comparisonKicker'),
  lastRideCaption: document.querySelector('#lastRideCaption'),
  thirtyDayCaption: document.querySelector('#thirtyDayCaption'),
  historyStatus: document.querySelector('#historyStatus'),
  historySummary: document.querySelector('#historySummary'),
  reloadHistoryButton: document.querySelector('#reloadHistoryButton'),
  stopRideButton: document.querySelector('#stopRideButton'),
  chooseRideFolderButton: document.querySelector('#chooseRideFolderButton'),
  rideFolderStatus: document.querySelector('#rideFolderStatus'),
  rideSaveStatus: document.querySelector('#rideSaveStatus'),
};

let bluetoothDevice = null;
let subscribedCharacteristics = [];
let reconnectCancelled = false;
let wakeLock = null;
let demoTimer = null;
let deferredInstallPrompt = null;
let lastCadencePacketAt = 0;
let heartRateDevice = null;
let heartRateCharacteristic = null;
let heartRateReconnectCancelled = false;
let lastHeartRatePacketAt = 0;
let lastChartRenderAt = 0;
let lastHeartChartRenderAt = 0;
let ftmsPowerEnabled = false;
let currentRide = null;
let rideLoggingTimer = null;
let rideDirectoryHandle = null;
let rideStartArmed = true;

const RIDE_FILE_VERSION = 1;
const RIDE_DB_NAME = 'kickr-live-storage';
const RIDE_DB_STORE = 'handles';
const RIDE_DIRECTORY_KEY = 'ride-directory';
const BLUETOOTH_DEVICE_CACHE_KEY = 'kickr-live-bluetooth-devices-v1';

const HISTORY_URL = './data/training-history.json';
const DAY_MS = 24 * 60 * 60 * 1000;

const crankState = {
  power: { revolutions: null, eventTime: null },
  csc: { revolutions: null, eventTime: null },
};

const session = {
  startedAt: null,
  powerSamples: [],
  power3sSamples: [],
  powerSum: 0,
  powerCount: 0,
  maxPower: 0,
  currentPower: null,
  currentCadence: null,
  currentHeartRate: null,
  heartRateSamples: [],
  heartChartMin: null,
  heartChartMax: null,
  distanceMeters: 0,
  distanceMode: null,
  currentSpeedKph: null,
  previousSpeedKph: null,
  lastSpeedAt: null,
  ftmsLastRawMeters: null,
  ftmsLastAt: null,
};

let trainingReference = {
  lastRideAverage: null,
  thirtyDayAverage: null,
  lastRide: null,
  thirtyDayActivities: 0,
};

const trainingHistory = {
  status: 'loading',
  updatedAt: null,
  activities: [],
  error: null,
};

function activityTimestamp(activity) {
  const source = activity.startTime || (activity.date ? `${activity.date}T12:00:00` : '');
  const timestamp = Date.parse(source);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeHistoryActivity(activity, index) {
  if (!activity || typeof activity !== 'object') return null;

  const averagePower = Number(activity.averagePower);
  if (!Number.isFinite(averagePower) || averagePower <= 0) return null;

  const durationSeconds = Number(activity.durationSeconds);
  const timestamp = activityTimestamp(activity);
  if (!timestamp) return null;

  return {
    id: String(activity.id || `${activity.date || 'activity'}-${index}`),
    date: typeof activity.date === 'string' ? activity.date : new Date(timestamp).toISOString().slice(0, 10),
    startTime: typeof activity.startTime === 'string' ? activity.startTime : null,
    sport: typeof activity.sport === 'string' ? activity.sport : 'indoor_cycling',
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null,
    averagePower: Math.round(averagePower),
    maxPower: Number.isFinite(Number(activity.maxPower)) ? Math.round(Number(activity.maxPower)) : null,
    normalizedPower: Number.isFinite(Number(activity.normalizedPower)) ? Math.round(Number(activity.normalizedPower)) : null,
    averageCadence: Number.isFinite(Number(activity.averageCadence)) ? Math.round(Number(activity.averageCadence)) : null,
    averageHeartRate: Number.isFinite(Number(activity.averageHeartRate)) ? Math.round(Number(activity.averageHeartRate)) : null,
    maxHeartRate: Number.isFinite(Number(activity.maxHeartRate)) ? Math.round(Number(activity.maxHeartRate)) : null,
    distanceKm: Number.isFinite(Number(activity.distanceKm)) ? Number(activity.distanceKm) : null,
    timestamp,
  };
}

function formatHistoryDate(value) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'ukendt dato';
  return new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' }).format(new Date(timestamp));
}

function calculateTrainingReference(activities) {
  const sorted = [...activities].sort((a, b) => b.timestamp - a.timestamp);
  const lastRide = sorted[0] || null;
  const now = Date.now();
  const recent = sorted.filter(activity => activity.timestamp >= now - (30 * DAY_MS) && activity.timestamp <= now + DAY_MS);

  let thirtyDayAverage = null;
  if (recent.length) {
    const withDuration = recent.filter(activity => Number.isFinite(activity.durationSeconds) && activity.durationSeconds > 0);
    if (withDuration.length === recent.length) {
      const totalSeconds = withDuration.reduce((sum, activity) => sum + activity.durationSeconds, 0);
      thirtyDayAverage = totalSeconds > 0
        ? withDuration.reduce((sum, activity) => sum + (activity.averagePower * activity.durationSeconds), 0) / totalSeconds
        : null;
    } else {
      thirtyDayAverage = recent.reduce((sum, activity) => sum + activity.averagePower, 0) / recent.length;
    }
  }

  return {
    lastRideAverage: lastRide?.averagePower ?? null,
    thirtyDayAverage: Number.isFinite(thirtyDayAverage) ? Math.round(thirtyDayAverage) : null,
    lastRide,
    thirtyDayActivities: recent.length,
  };
}

function updateHistoryUi() {
  if (els.comparisonKicker) els.comparisonKicker.textContent = 'Turens gennemsnit · live sammenligning';

  if (trainingHistory.status === 'loading') {
    if (els.historyStatus) els.historyStatus.textContent = 'Indlæser historik…';
    if (els.historySummary) els.historySummary.textContent = 'Venter på data/training-history.json';
    return;
  }

  if (trainingHistory.status === 'error') {
    if (els.historyStatus) els.historyStatus.textContent = 'Historik kunne ikke indlæses';
    if (els.historySummary) els.historySummary.textContent = trainingHistory.error || 'Kontrollér JSON-filen';
    return;
  }

  const count = trainingHistory.activities.length;
  if (els.historyStatus) els.historyStatus.textContent = count ? `${count} træning${count === 1 ? '' : 'er'} indlæst` : 'Historikfilen er tom';
  if (els.historySummary) {
    const updated = trainingHistory.updatedAt ? `Opdateret ${formatHistoryDate(trainingHistory.updatedAt)}` : 'Ingen opdateringsdato';
    const recent = `${trainingReference.thirtyDayActivities} inden for 30 dage`;
    els.historySummary.textContent = `${updated} · ${recent}`;
  }

  if (els.lastRideCaption) {
    els.lastRideCaption.textContent = trainingReference.lastRide
      ? `vs ${formatHistoryDate(trainingReference.lastRide.timestamp)} · ${trainingReference.lastRideAverage} W`
      : 'vs sidste tur';
  }
  if (els.thirtyDayCaption) {
    els.thirtyDayCaption.textContent = trainingReference.thirtyDayAverage
      ? `vs 30 dage · ${trainingReference.thirtyDayAverage} W`
      : 'vs 30 dages snit';
  }
}

async function loadTrainingHistory({ announce = false } = {}) {
  trainingHistory.status = 'loading';
  trainingHistory.error = null;
  updateHistoryUi();

  try {
    const response = await fetch(`${HISTORY_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Filen svarede med HTTP ${response.status}`);

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.activities)) {
      throw new Error('JSON-filen mangler feltet activities');
    }

    const activities = payload.activities
      .map(normalizeHistoryActivity)
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp);

    trainingHistory.status = 'ready';
    trainingHistory.updatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : null;
    trainingHistory.activities = activities;
    trainingReference = calculateTrainingReference(activities);
    updateHistoryUi();
    updateComparisons();
    log(`Træningshistorik indlæst: ${activities.length} gyldige aktiviteter.`);
    if (announce) showToast(`${activities.length} træning${activities.length === 1 ? '' : 'er'} indlæst`);
  } catch (error) {
    trainingHistory.status = 'error';
    trainingHistory.error = error.message;
    trainingHistory.activities = [];
    trainingReference = calculateTrainingReference([]);
    updateHistoryUi();
    updateComparisons();
    log(`Historikfejl: ${error.message}`);
    if (announce) showToast('Historikfilen kunne ikke læses');
  }
}

function formatDelta(current, reference) {
  if (!Number.isFinite(current) || !Number.isFinite(reference) || reference <= 0) return null;
  const delta = Math.round(current - reference);
  return { delta, text: `${delta > 0 ? '+' : ''}${delta} W` };
}

function renderDelta(element, result) {
  if (!element) return;
  element.textContent = result?.text || '—';
  element.classList.toggle('negative', Boolean(result && result.delta < 0));
}

function updateComparisons() {
  const average = session.powerCount ? session.powerSum / session.powerCount : null;
  const lastRide = formatDelta(average, trainingReference.lastRideAverage);
  const thirtyDay = formatDelta(average, trainingReference.thirtyDayAverage);
  renderDelta(els.lastRideDelta, lastRide);
  renderDelta(els.thirtyDayDelta, thirtyDay);

  if (trainingHistory.status === 'loading') {
    els.trendText.textContent = 'Historik indlæses…';
    els.trendText.className = 'trend-line neutral';
    return;
  }
  if (trainingHistory.status === 'error') {
    els.trendText.textContent = 'Kunne ikke læse data/training-history.json';
    els.trendText.className = 'trend-line down';
    return;
  }
  if (!trainingReference.lastRideAverage && !trainingReference.thirtyDayAverage) {
    els.trendText.textContent = 'Ingen gyldige træninger i historikfilen endnu';
    els.trendText.className = 'trend-line neutral';
    return;
  }
  if (!session.powerCount) {
    els.trendText.textContent = 'Sammenligningen starter, når du træder';
    els.trendText.className = 'trend-line neutral';
    return;
  }

  const now = Date.now();
  const recent = session.powerSamples.filter(sample => now - sample.time <= 15000);
  const previous = session.powerSamples.filter(sample => now - sample.time > 15000 && now - sample.time <= 30000);
  const recentAverage = recent.length ? recent.reduce((sum, sample) => sum + sample.power, 0) / recent.length : null;
  const previousAverage = previous.length ? previous.reduce((sum, sample) => sum + sample.power, 0) / previous.length : null;
  const change = recentAverage !== null && previousAverage !== null ? recentAverage - previousAverage : 0;

  if (change > 5) {
    els.trendText.textContent = '↗ Effekten stiger nu';
    els.trendText.className = 'trend-line';
  } else if (change < -5) {
    els.trendText.textContent = '↘ Effekten falder nu';
    els.trendText.className = 'trend-line down';
  } else {
    els.trendText.textContent = '→ Stabil effekt lige nu';
    els.trendText.className = 'trend-line neutral';
  }
}

function setRing(element, value, maximum) {
  if (!element) return;
  const degrees = Math.max(0, Math.min(360, (Number(value) || 0) / maximum * 360));
  element.parentElement?.style.setProperty('--value', `${degrees}deg`);
}

function updatePowerChart(force = false) {
  const now = Date.now();
  if (!force && now - lastChartRenderAt < 900) return;
  lastChartRenderAt = now;

  const samples = session.powerSamples.filter(sample => now - sample.time <= 600000);
  if (!samples.length) {
    els.powerChartLine?.setAttribute('d', '');
    els.powerChartArea?.setAttribute('d', '');
    if (els.powerChartDot) els.powerChartDot.hidden = true;
    if (els.chartAverage) els.chartAverage.textContent = '--';
    return;
  }

  const width = 800;
  const height = 200;
  const maxPower = Math.max(350, ...samples.map(sample => sample.power));
  const firstTime = Math.max(now - 600000, samples[0].time);
  const span = Math.max(1, now - firstTime);
  const points = samples.map(sample => {
    const x = ((sample.time - firstTime) / span) * width;
    const y = height - Math.min(height, (sample.power / maxPower) * (height - 12));
    return [x, y];
  });
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${points.at(-1)[0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  els.powerChartLine?.setAttribute('d', line);
  els.powerChartArea?.setAttribute('d', area);
  if (els.powerChartDot) {
    els.powerChartDot.hidden = false;
    els.powerChartDot.setAttribute('cx', points.at(-1)[0].toFixed(1));
    els.powerChartDot.setAttribute('cy', points.at(-1)[1].toFixed(1));
  }
  if (els.chartAverage) {
    els.chartAverage.textContent = String(Math.round(samples.reduce((sum, sample) => sum + sample.power, 0) / samples.length));
  }
}

function updateHeartRateChart(force = false, connected = true) {
  const now = Date.now();
  if (!force && now - lastHeartChartRenderAt < 900) return;
  lastHeartChartRenderAt = now;
  session.heartRateSamples = session.heartRateSamples.filter(sample => now - sample.time <= 600000);

  if (!connected || !session.heartRateSamples.length) {
    els.heartChartLine?.setAttribute('d', '');
    els.heartChartArea?.setAttribute('d', '');
    if (els.heartChartAverage) els.heartChartAverage.textContent = '--';
    if (els.heartChartEmpty) els.heartChartEmpty.hidden = false;
    return;
  }

  const samples = session.heartRateSamples;
  const values = samples.map(sample => sample.heartRate);
  const average = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const center = (rawMin + rawMax) / 2;
  const halfSpan = Math.max(10, (rawMax - rawMin) / 2 + 5);
  const targetMin = Math.max(30, Math.floor((center - halfSpan) / 5) * 5);
  const targetMax = Math.min(240, Math.ceil((center + halfSpan) / 5) * 5);

  session.heartChartMin = session.heartChartMin === null
    ? targetMin
    : targetMin < session.heartChartMin
      ? targetMin
      : session.heartChartMin + ((targetMin - session.heartChartMin) * 0.08);
  session.heartChartMax = session.heartChartMax === null
    ? targetMax
    : targetMax > session.heartChartMax
      ? targetMax
      : session.heartChartMax + ((targetMax - session.heartChartMax) * 0.08);

  const width = 300;
  const height = 88;
  const firstTime = Math.max(now - 600000, samples[0].time);
  const span = Math.max(1, now - firstTime);
  const ySpan = Math.max(20, session.heartChartMax - session.heartChartMin);
  const points = samples.map(sample => {
    const x = ((sample.time - firstTime) / span) * width;
    const ratio = (sample.heartRate - session.heartChartMin) / ySpan;
    const y = height - 6 - (Math.max(0, Math.min(1, ratio)) * (height - 12));
    return [x, y];
  });
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${points.at(-1)[0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  els.heartChartLine?.setAttribute('d', line);
  els.heartChartArea?.setAttribute('d', area);
  if (els.heartChartAverage) els.heartChartAverage.textContent = String(average);
  if (els.heartChartEmpty) els.heartChartEmpty.hidden = true;
}

function renderDistance() {
  if (!els.distanceValue) return;
  const kilometres = Math.max(0, session.distanceMeters) / 1000;
  els.distanceValue.textContent = `${kilometres.toLocaleString('da-DK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} km`;
}

function updateSpeedDistance(speedKph, now = Date.now()) {
  if (!Number.isFinite(speedKph) || speedKph < 0 || speedKph > 200) return;
  ensureSessionStarted(session.currentPower, session.currentCadence, speedKph);

  if (session.distanceMode !== 'ftms' && session.lastSpeedAt !== null) {
    const elapsedMs = now - session.lastSpeedAt;
    if (elapsedMs > 0 && elapsedMs <= 10000) {
      const previous = Number.isFinite(session.previousSpeedKph) ? session.previousSpeedKph : speedKph;
      const averageMetresPerSecond = ((previous + speedKph) / 2) / 3.6;
      session.distanceMeters += Math.max(0, averageMetresPerSecond * (elapsedMs / 1000));
    }
  }

  if (session.distanceMode === null) session.distanceMode = 'speed';
  session.previousSpeedKph = speedKph;
  session.currentSpeedKph = speedKph;
  session.lastSpeedAt = now;
  renderDistance();
}

function updateFtmsDistance(rawMeters, now = Date.now(), speedKph = null) {
  if (!Number.isFinite(rawMeters) || rawMeters < 0) return;
  ensureSessionStarted(session.currentPower, session.currentCadence, speedKph);

  if (session.ftmsLastRawMeters !== null && session.ftmsLastAt !== null) {
    const elapsedMs = now - session.ftmsLastAt;
    const delta = rawMeters - session.ftmsLastRawMeters;
    const referenceSpeed = Number.isFinite(speedKph) ? speedKph : session.currentSpeedKph;
    const expectedMetres = Number.isFinite(referenceSpeed) && elapsedMs > 0
      ? (referenceSpeed / 3.6) * (elapsedMs / 1000)
      : 0;
    const maximumPlausibleDelta = Math.max(30, (expectedMetres * 3) + 20);

    if (elapsedMs > 0 && elapsedMs <= 15000 && delta >= 0 && delta <= maximumPlausibleDelta) {
      session.distanceMeters += delta;
    }
  }

  session.distanceMode = 'ftms';
  session.ftmsLastRawMeters = rawMeters;
  session.ftmsLastAt = now;
  if (Number.isFinite(speedKph)) {
    session.previousSpeedKph = speedKph;
    session.currentSpeedKph = speedKph;
  }
  session.lastSpeedAt = now;
  renderDistance();
}

function resetPowerSmoothing() {
  session.power3sSamples = [];
  session.currentPower = null;
  els.powerValue.textContent = '--';
}

function prepareForTrainerReconnect() {
  resetPowerSmoothing();
  session.currentCadence = null;
  session.currentSpeedKph = null;
  session.previousSpeedKph = null;
  session.lastSpeedAt = null;
  session.ftmsLastRawMeters = null;
  session.ftmsLastAt = null;
  els.cadenceValue.textContent = '--';
  setRing(els.cadenceRing, 0, 120);
  els.powerHint.textContent = 'Venter på data';
  els.powerZone.textContent = 'Venter på data';
}

function setStatus(state, title, subtitle) {
  els.statusDot.className = `status-dot ${state}`;
  els.statusText.textContent = title;
  els.deviceText.textContent = subtitle;
  const connected = state === 'connected';
  els.connectButton.hidden = connected;
  els.disconnectButton.hidden = !connected;
  els.connectButton.disabled = state === 'connecting';
}

function setHeartRateStatus(state, title, subtitle) {
  els.heartStatusDot.className = `status-dot ${state}`;
  els.heartRateState.textContent = title;
  els.heartRateConnectionText.textContent = subtitle;
}

function readBluetoothDeviceCache() {
  try {
    const raw = localStorage.getItem(BLUETOOTH_DEVICE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    log(`Kunne ikke læse gemt Bluetooth-udstyr: ${error.message}`);
    return {};
  }
}

function writeBluetoothDeviceCache(cache) {
  try {
    localStorage.setItem(BLUETOOTH_DEVICE_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    log(`Kunne ikke gemme Bluetooth-udstyr: ${error.message}`);
  }
}

function rememberBluetoothDevice(type, device) {
  if (!device?.id) return;
  const cache = readBluetoothDeviceCache();
  cache[type] = {
    id: device.id,
    name: device.name || '',
    lastConnected: new Date().toISOString(),
  };
  writeBluetoothDeviceCache(cache);
}

function normalizeDeviceName(device) {
  return String(device?.name || '').trim().toLowerCase();
}

function deviceMatchesSavedDevice(device, saved) {
  if (!device || !saved) return false;
  return Boolean((saved.id && device.id === saved.id) || (saved.name && device.name === saved.name));
}

function isLikelyKickrDevice(device) {
  const name = normalizeDeviceName(device);
  if (!name) return false;
  if (name.includes('kickr')) return true;
  return name.includes('wahoo') && !name.includes('tickr');
}

function isLikelyHeartRateDevice(device) {
  const name = normalizeDeviceName(device);
  if (!name || name.includes('kickr')) return false;
  return /(^|[^a-z])(hr|bpm)([^a-z]|$)|heart|pulse|puls|pulsm|tickr|polar|coospo|igpsport|hr70/.test(name);
}

function findRememberedDevice(devices, type) {
  const cache = readBluetoothDeviceCache();
  const saved = cache[type];
  const savedMatch = devices.find(device => deviceMatchesSavedDevice(device, saved));
  if (savedMatch) return savedMatch;

  if (type === 'kickr') return devices.find(isLikelyKickrDevice) || null;
  if (type === 'heart_rate') return devices.find(isLikelyHeartRateDevice) || null;
  return null;
}

function addBluetoothDisconnectListener(device, handler) {
  if (!device || typeof device.addEventListener !== 'function') return;
  device.removeEventListener('gattserverdisconnected', handler);
  device.addEventListener('gattserverdisconnected', handler);
}

function hasActiveBluetoothDevice(device) {
  return Boolean(device?.gatt?.connected);
}

function ensureSessionStarted(power, cadence, speed = null) {
  const moving = (power ?? 0) > 0 || (cadence ?? 0) > 0 || (speed ?? 0) > 0;
  if (!moving) {
    if (!session.startedAt && !currentRide) rideStartArmed = true;
    return;
  }
  if (!session.startedAt && rideStartArmed) {
    rideStartArmed = false;
    session.startedAt = Date.now();
    startRideRecording(session.startedAt);
    log('Turdata startede ved første registrerede bevægelse.');
  }
}

function createRideId(startedAt) {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `ride-${startedAt}-${Math.random().toString(16).slice(2)}`;
}

function nullableNumber(value, digits = null) {
  if (!Number.isFinite(value)) return null;
  return digits === null ? value : Number(value.toFixed(digits));
}

function setRideActiveUi(active) {
  if (!els.stopRideButton) return;
  els.stopRideButton.hidden = !active;
  els.stopRideButton.disabled = !active;
}

function recordRideSample(force = false) {
  if (!currentRide || currentRide.status !== 'active') return;

  const now = Date.now();
  const elapsedMs = Math.max(0, now - currentRide.startedAtMs);
  const wholeSecond = Math.floor(elapsedMs / 1000);
  if (wholeSecond === currentRide.lastSampleSecond) {
    if (!force || !currentRide.samples.length) return;
    currentRide.samples.pop();
  }

  currentRide.samples.push({
    t: Number((elapsedMs / 1000).toFixed(3)),
    timestamp: new Date(now).toISOString(),
    power: nullableNumber(session.currentPower),
    heartRate: nullableNumber(session.currentHeartRate),
    cadence: nullableNumber(session.currentCadence),
    speedKmh: nullableNumber(session.currentSpeedKph, 2),
    distanceKm: nullableNumber(Math.max(0, session.distanceMeters) / 1000, 4),
  });
  currentRide.lastSampleSecond = wholeSecond;
}

function stopRideLogging() {
  if (rideLoggingTimer !== null) {
    window.clearInterval(rideLoggingTimer);
    rideLoggingTimer = null;
  }
}

function startRideRecording(startedAtMs = Date.now()) {
  if (currentRide || rideLoggingTimer !== null) return;

  currentRide = {
    version: RIDE_FILE_VERSION,
    rideId: createRideId(startedAtMs),
    startTime: new Date(startedAtMs).toISOString(),
    startedAtMs,
    endTime: null,
    endedAtMs: null,
    status: 'active',
    samples: [],
    lastSampleSecond: -1,
  };
  recordRideSample(true);
  rideLoggingTimer = window.setInterval(recordRideSample, 1000);
  setRideActiveUi(true);
  if (els.rideSaveStatus) els.rideSaveStatus.textContent = 'Tur optages';
  log(`Ride recording startet: ${currentRide.rideId}`);
}

function sampleValues(ride, key) {
  return ride.samples.map(sample => sample[key]).filter(Number.isFinite);
}

function averageOrNull(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function maximumOrNull(values) {
  return values.length ? values.reduce((maximum, value) => Math.max(maximum, value), values[0]) : null;
}

function buildRideFile(ride) {
  const power = sampleValues(ride, 'power');
  const heartRate = sampleValues(ride, 'heartRate');
  const cadence = sampleValues(ride, 'cadence');
  return {
    version: ride.version,
    rideId: ride.rideId,
    startTime: ride.startTime,
    endTime: ride.endTime,
    summary: {
      durationSec: Math.max(0, Math.round((ride.endedAtMs - ride.startedAtMs) / 1000)),
      distanceKm: nullableNumber(Math.max(0, session.distanceMeters) / 1000, 4),
      avgPower: averageOrNull(power),
      maxPower: maximumOrNull(power),
      avgHeartRate: averageOrNull(heartRate),
      maxHeartRate: maximumOrNull(heartRate),
      avgCadence: averageOrNull(cadence),
      maxCadence: maximumOrNull(cadence),
    },
    samples: ride.samples,
  };
}

function rideFilename(startTime) {
  const date = new Date(startTime);
  const pad = value => String(value).padStart(2, '0');
  return `ride-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

function openRideDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB understøttes ikke'));
      return;
    }
    const request = indexedDB.open(RIDE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RIDE_DB_STORE)) {
        request.result.createObjectStore(RIDE_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB kunne ikke åbnes'));
  });
}

async function readStoredRideDirectory() {
  const db = await openRideDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(RIDE_DB_STORE, 'readonly').objectStore(RIDE_DB_STORE).get(RIDE_DIRECTORY_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Gemmemappen kunne ikke læses'));
    });
  } finally {
    db.close();
  }
}

async function storeRideDirectory(handle) {
  const db = await openRideDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(RIDE_DB_STORE, 'readwrite').objectStore(RIDE_DB_STORE).put(handle, RIDE_DIRECTORY_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Gemmemappen kunne ikke huskes'));
    });
  } finally {
    db.close();
  }
}

async function directoryPermission(handle, request = false) {
  if (!handle) return false;
  const options = { mode: 'readwrite' };
  if (typeof handle.queryPermission !== 'function') return true;
  if (await handle.queryPermission(options) === 'granted') return true;
  return request && typeof handle.requestPermission === 'function'
    ? (await handle.requestPermission(options)) === 'granted'
    : false;
}

function fileSystemAccessSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

async function updateRideFolderStatus() {
  if (!els.rideFolderStatus) return;
  if (!fileSystemAccessSupported()) {
    els.rideFolderStatus.textContent = 'Mappevalg understøttes ikke – ture downloades i stedet.';
    if (els.chooseRideFolderButton) els.chooseRideFolderButton.hidden = true;
    return;
  }
  if (!rideDirectoryHandle) {
    els.rideFolderStatus.textContent = 'Ingen gemmemappe valgt';
    return;
  }
  const granted = await directoryPermission(rideDirectoryHandle, false).catch(() => false);
  els.rideFolderStatus.textContent = granted
    ? `Valgt mappe: ${rideDirectoryHandle.name}`
    : `Godkend adgang til: ${rideDirectoryHandle.name}`;
  if (els.chooseRideFolderButton) {
    els.chooseRideFolderButton.textContent = granted ? 'Vælg en anden gemmemappe' : 'Godkend gemmemappe';
  }
}

function downloadRideJson(json, filename) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveCompletedRide({ requestPermission = false } = {}) {
  if (!currentRide || currentRide.status !== 'completed') return false;
  const filename = rideFilename(currentRide.startTime);
  const json = `${JSON.stringify(buildRideFile(currentRide), null, 2)}\n`;

  if (!fileSystemAccessSupported()) {
    downloadRideJson(json, filename);
  } else {
    if (!rideDirectoryHandle) {
      showToast('Vælg gemmemappe først');
      if (els.rideSaveStatus) els.rideSaveStatus.textContent = 'Turen er stoppet – vælg en gemmemappe';
      return false;
    }
    const permitted = await directoryPermission(rideDirectoryHandle, requestPermission).catch(() => false);
    if (!permitted) {
      showToast('Godkend gemmemappen igen');
      if (els.rideSaveStatus) els.rideSaveStatus.textContent = 'Turen er stoppet – godkend gemmemappen';
      await updateRideFolderStatus();
      return false;
    }
    const fileHandle = await rideDirectoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();
  }

  log(`Tur gemt: ${filename}`);
  showToast(`Tur gemt · ${filename}`);
  if (els.rideSaveStatus) els.rideSaveStatus.textContent = `Tur gemt: ${filename}`;
  currentRide = null;
  resetSession(false);
  return true;
}

async function stopRide() {
  if (!currentRide || currentRide.status !== 'active') return;
  recordRideSample(true);
  stopRideLogging();
  currentRide.endedAtMs = Date.now();
  currentRide.endTime = new Date(currentRide.endedAtMs).toISOString();
  currentRide.status = 'completed';
  setRideActiveUi(false);
  log(`Tur afsluttet med ${currentRide.samples.length} samples.`);

  try {
    await saveCompletedRide({ requestPermission: true });
  } catch (error) {
    log(`Kunne ikke gemme tur: ${error.message}`);
    showToast('Turen kunne ikke gemmes');
    if (els.rideSaveStatus) els.rideSaveStatus.textContent = `Turen er stoppet – gemmefejl: ${error.message}`;
  }
}

async function chooseRideFolder() {
  if (!fileSystemAccessSupported()) return;
  try {
    const existingPermission = rideDirectoryHandle
      ? await directoryPermission(rideDirectoryHandle, false)
      : false;
    if (rideDirectoryHandle && !existingPermission && await directoryPermission(rideDirectoryHandle, true)) {
      await updateRideFolderStatus();
      showToast(`Gemmemappe godkendt · ${rideDirectoryHandle.name}`);
      if (currentRide?.status === 'completed') await saveCompletedRide();
      return;
    }
    rideDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    try {
      await storeRideDirectory(rideDirectoryHandle);
    } catch (error) {
      log(`Gemmemappen kunne ikke huskes: ${error.message}`);
    }
    await updateRideFolderStatus();
    showToast(`Gemmemappe valgt · ${rideDirectoryHandle.name}`);
    if (currentRide?.status === 'completed') await saveCompletedRide({ requestPermission: true });
  } catch (error) {
    if (error.name !== 'AbortError') {
      log(`Mappefejl: ${error.message}`);
      showToast('Gemmemappen kunne ikke vælges');
    }
  }
}

async function restoreRideDirectory() {
  if (!fileSystemAccessSupported()) {
    await updateRideFolderStatus();
    return;
  }
  try {
    rideDirectoryHandle = await readStoredRideDirectory();
  } catch (error) {
    log(`Kunne ikke genbruge gemmemappen: ${error.message}`);
  }
  await updateRideFolderStatus();
}

function updatePower(power) {
  if (!Number.isFinite(power) || power < 0) return;
  const cleanPower = Math.round(power);
  const now = Date.now();

  session.currentPower = cleanPower;
  ensureSessionStarted(cleanPower, session.currentCadence);

  session.powerSamples.push({ time: now, power: cleanPower });
  session.powerSamples = session.powerSamples.filter(sample => now - sample.time <= 600000);
  session.power3sSamples.push({ time: now, power: cleanPower });
  session.power3sSamples = session.power3sSamples.filter(sample => now - sample.time <= 3000);
  session.powerSum += cleanPower;
  session.powerCount += 1;
  session.maxPower = Math.max(session.maxPower, cleanPower);

  const average3s = session.power3sSamples.length
    ? Math.round(session.power3sSamples.reduce((sum, sample) => sum + sample.power, 0) / session.power3sSamples.length)
    : cleanPower;

  els.powerValue.textContent = String(average3s);
  els.averagePower.textContent = String(Math.round(session.powerSum / session.powerCount));
  els.maxPower.textContent = String(session.maxPower);
  els.powerHint.textContent = average3s === 0 ? 'Ingen belastning registreret' : powerBand(average3s);
  els.powerZone.textContent = powerBand(average3s);
  updateComparisons();
  updatePowerChart();
}

function updateCadence(cadence) {
  if (!Number.isFinite(cadence)) return;
  const cleanCadence = Math.max(0, Math.min(250, Math.round(cadence)));
  session.currentCadence = cleanCadence;
  lastCadencePacketAt = Date.now();
  ensureSessionStarted(session.currentPower, cleanCadence);
  els.cadenceValue.textContent = String(cleanCadence);
  setRing(els.cadenceRing, cleanCadence, 120);
}

function updateHeartRate(heartRate) {
  if (!Number.isFinite(heartRate) || heartRate <= 0) return;
  const cleanHeartRate = Math.min(240, Math.round(heartRate));
  const now = Date.now();
  session.currentHeartRate = cleanHeartRate;
  lastHeartRatePacketAt = now;
  session.heartRateSamples.push({ time: now, heartRate: cleanHeartRate });
  session.heartRateSamples = session.heartRateSamples.filter(sample => now - sample.time <= 600000);
  els.heartRateValue.textContent = String(cleanHeartRate);
  if (demoTimer) {
    setHeartRateStatus('connected', 'Simuleret pulsmåler', 'Testdata');
  } else {
    setHeartRateStatus('connected', heartRateDevice?.name || 'Pulsmåler', 'Forbundet');
  }
  setRing(els.heartRateRing, cleanHeartRate, 200);
  updateHeartRateChart();
}

function powerBand(power) {
  if (power < 100) return 'Let tråd';
  if (power < 180) return 'Roligt arbejde';
  if (power < 260) return 'Solid belastning';
  if (power < 360) return 'Hårdt arbejde';
  return 'Der bliver trådt igennem';
}

function updateElapsed() {
  if (!session.startedAt) {
    els.elapsedTime.textContent = '00:00';
  } else {
    const totalSeconds = Math.floor((Date.now() - session.startedAt) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    els.elapsedTime.textContent = hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (els.timeProgress) els.timeProgress.style.width = `${Math.min(100, (totalSeconds / 3600) * 100)}%`;
  }

  if (session.currentCadence !== null && Date.now() - lastCadencePacketAt > 2800) {
    session.currentCadence = 0;
    els.cadenceValue.textContent = '0';
    setRing(els.cadenceRing, 0, 120);
  }
  if (session.currentHeartRate !== null && Date.now() - lastHeartRatePacketAt > 6000) {
    session.currentHeartRate = null;
    els.heartRateValue.textContent = '--';
    if (heartRateDevice?.gatt?.connected) {
      setHeartRateStatus('connected', heartRateDevice.name || 'Pulsmåler', 'Venter på pulsdata');
    } else {
      setHeartRateStatus('disconnected', 'Pulsmåler', 'Ikke forbundet');
    }
    setRing(els.heartRateRing, 0, 200);
    updateHeartRateChart(true, false);
  }
}

function resetSession(showMessage = true) {
  if (currentRide) {
    if (showMessage) {
      showToast(currentRide.status === 'active'
        ? 'Stop turen, før du nulstiller'
        : 'Gem den afsluttede tur, før du nulstiller');
    }
    return;
  }
  session.startedAt = null;
  session.powerSamples = [];
  session.power3sSamples = [];
  session.powerSum = 0;
  session.powerCount = 0;
  session.maxPower = 0;
  session.currentPower = null;
  session.currentCadence = null;
  session.currentHeartRate = null;
  session.heartRateSamples = [];
  session.heartChartMin = null;
  session.heartChartMax = null;
  session.distanceMeters = 0;
  session.distanceMode = null;
  session.currentSpeedKph = null;
  session.previousSpeedKph = null;
  session.lastSpeedAt = null;
  session.ftmsLastRawMeters = null;
  session.ftmsLastAt = null;
  crankState.power.revolutions = null;
  crankState.power.eventTime = null;
  crankState.csc.revolutions = null;
  crankState.csc.eventTime = null;
  els.powerValue.textContent = '--';
  els.cadenceValue.textContent = '--';
  els.averagePower.textContent = '--';
  els.maxPower.textContent = '--';
  els.elapsedTime.textContent = '00:00';
  els.powerHint.textContent = 'Venter på data';
  els.powerZone.textContent = 'Venter på data';
  els.heartRateValue.textContent = '--';
  renderDistance();
  setRing(els.cadenceRing, 0, 120);
  setRing(els.heartRateRing, 0, 200);
  if (els.timeProgress) els.timeProgress.style.width = '0%';
  updateComparisons();
  updatePowerChart(true);
  updateHeartRateChart(true, false);
  if (showMessage) showToast('Turdata er nulstillet');
}

function readUint24LE(view, offset) {
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
}

function calculateCadence(source, cumulativeRevolutions, eventTime, timeResolution) {
  const previous = crankState[source];
  let cadence = null;

  if (previous.revolutions !== null && previous.eventTime !== null) {
    const revDelta = (cumulativeRevolutions - previous.revolutions + 65536) % 65536;
    const timeDeltaTicks = (eventTime - previous.eventTime + 65536) % 65536;
    const seconds = timeDeltaTicks / timeResolution;

    if (seconds > 0 && revDelta > 0 && revDelta < 20) {
      cadence = (revDelta / seconds) * 60;
    }
  }

  previous.revolutions = cumulativeRevolutions;
  previous.eventTime = eventTime;
  return cadence;
}

function handleCyclingPower(event) {
  const view = event.target.value;
  if (!view || view.byteLength < 4) return;

  const flags = view.getUint16(0, true);
  const power = view.getInt16(2, true);
  let offset = 4;

  updatePower(power);

  if (flags & (1 << 0)) offset += 1; // Pedal Power Balance
  if (flags & (1 << 2)) offset += 2; // Accumulated Torque
  if (flags & (1 << 4)) offset += 6; // Wheel Revolution Data

  if (flags & (1 << 5)) {
    if (offset + 4 <= view.byteLength) {
      const crankRevolutions = view.getUint16(offset, true);
      const crankEventTime = view.getUint16(offset + 2, true);
      const cadence = calculateCadence('power', crankRevolutions, crankEventTime, 1024);
      if (cadence !== null) updateCadence(cadence);
    }
    offset += 4;
  }
}

function handleCsc(event) {
  const view = event.target.value;
  if (!view || view.byteLength < 1) return;

  const flags = view.getUint8(0);
  let offset = 1;

  if (flags & 0x01) offset += 6; // Wheel data
  if ((flags & 0x02) && offset + 4 <= view.byteLength) {
    const crankRevolutions = view.getUint16(offset, true);
    const crankEventTime = view.getUint16(offset + 2, true);
    const cadence = calculateCadence('csc', crankRevolutions, crankEventTime, 1024);
    if (cadence !== null) updateCadence(cadence);
  }
}

function handleIndoorBikeData(event) {
  const view = event.target.value;
  if (!view || view.byteLength < 2) return;

  const flags = view.getUint16(0, true);
  let offset = 2;
  let instantaneousSpeed = null;
  let totalDistance = null;
  let instantaneousCadence = null;
  let instantaneousPower = null;
  let heartRate = null;

  const readField = (size, reader) => {
    const value = offset + size <= view.byteLength ? reader(offset) : null;
    offset += size;
    return value;
  };

  // Bit 0 is "More Data". Instantaneous speed is present when it is NOT set.
  if (!(flags & (1 << 0))) instantaneousSpeed = readField(2, position => view.getUint16(position, true) / 100);
  if (flags & (1 << 1)) readField(2, () => null); // Average speed

  if (flags & (1 << 2)) {
    instantaneousCadence = readField(2, position => view.getUint16(position, true) / 2);
  }
  if (flags & (1 << 3)) readField(2, () => null); // Average cadence
  if (flags & (1 << 4)) totalDistance = readField(3, position => readUint24LE(view, position));
  if (flags & (1 << 5)) readField(2, () => null); // Resistance level

  if (flags & (1 << 6)) {
    instantaneousPower = readField(2, position => view.getInt16(position, true));
  }

  if (flags & (1 << 7)) readField(2, () => null); // Average power
  if (flags & (1 << 8)) readField(5, () => null); // Expended energy
  if (flags & (1 << 9)) {
    heartRate = readField(1, position => view.getUint8(position));
  }
  if (flags & (1 << 10)) readField(1, () => null); // MET
  if (flags & (1 << 11)) readField(2, () => null); // Elapsed time
  if (flags & (1 << 12)) readField(2, () => null); // Remaining time

  const now = Date.now();
  if (totalDistance !== null) updateFtmsDistance(totalDistance, now, instantaneousSpeed);
  else if (instantaneousSpeed !== null) updateSpeedDistance(instantaneousSpeed, now);
  if (instantaneousCadence !== null) updateCadence(instantaneousCadence);
  if (ftmsPowerEnabled && instantaneousPower !== null) updatePower(instantaneousPower);
  if (heartRate !== null) updateHeartRate(heartRate);
}

async function subscribe(service, characteristicUuid, handler, label) {
  const characteristic = await service.getCharacteristic(characteristicUuid);
  characteristic.addEventListener('characteristicvaluechanged', handler);
  await characteristic.startNotifications();
  subscribedCharacteristics.push({ characteristic, handler });
  log(`Abonnerer på ${label}.`);
}

async function setupDataServices(server) {
  subscribedCharacteristics = [];
  const sources = [];
  let hasPower = false;
  ftmsPowerEnabled = false;

  try {
    const powerService = await server.getPrimaryService(UUID.cyclingPowerService);
    await subscribe(powerService, UUID.cyclingPowerMeasurement, handleCyclingPower, 'Cycling Power Measurement');
    sources.push('Cycling Power');
    hasPower = true;
  } catch (error) {
    log(`Cycling Power ikke tilgængelig: ${error.message}`);
  }

  try {
    const cscService = await server.getPrimaryService(UUID.cscService);
    await subscribe(cscService, UUID.cscMeasurement, handleCsc, 'Cycling Speed and Cadence');
    sources.push('CSC');
  } catch (error) {
    log(`CSC ikke tilgængelig: ${error.message}`);
  }

  try {
    const ftmsService = await server.getPrimaryService(UUID.fitnessMachineService);
    ftmsPowerEnabled = !hasPower;
    await subscribe(ftmsService, UUID.indoorBikeData, handleIndoorBikeData, 'FTMS Indoor Bike Data');
    sources.push('FTMS');
    if (ftmsPowerEnabled) hasPower = true;
  } catch (error) {
    ftmsPowerEnabled = false;
    log(`FTMS ikke tilgængelig: ${error.message}`);
  }

  if (!hasPower) {
    throw new Error('KICKR blev fundet, men ingen understøttet watt-datakilde kunne åbnes.');
  }

  els.dataSource.textContent = `Datakilde: ${sources.join(' + ')}`;
  return sources;
}

async function connectToSelectedDevice() {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth findes ikke i denne browser. Brug Microsoft Edge eller Google Chrome.');
  }

  reconnectCancelled = false;
  setStatus('connecting', 'Søger efter KICKR', 'Vælg træneren i Bluetooth-vinduet');
  log('Åbner Bluetooth-vælgeren.');

  bluetoothDevice = await navigator.bluetooth.requestDevice({
    filters: [
      { namePrefix: 'KICKR' },
      { services: [UUID.cyclingPowerService] },
      { services: [UUID.fitnessMachineService] },
    ],
    optionalServices: [
      UUID.cyclingPowerService,
      UUID.cscService,
      UUID.fitnessMachineService,
    ],
  });

  addBluetoothDisconnectListener(bluetoothDevice, handleDisconnected);
  await connectGatt();
}

async function connectGatt() {
  if (!bluetoothDevice) throw new Error('Ingen Bluetooth-enhed er valgt.');

  setStatus('connecting', 'Forbinder', bluetoothDevice.name || 'Wahoo KICKR');
  const server = bluetoothDevice.gatt.connected
    ? bluetoothDevice.gatt
    : await bluetoothDevice.gatt.connect();

  const sources = await setupDataServices(server);
  setStatus('connected', 'Forbundet', bluetoothDevice.name || 'Wahoo KICKR');
  rememberBluetoothDevice('kickr', bluetoothDevice);
  log(`Forbundet. Datakilder: ${sources.join(', ')}.`);
  showToast('KICKR er forbundet');
  await requestWakeLock();
}

async function handleDisconnected() {
  if (reconnectCancelled || !bluetoothDevice) return;
  prepareForTrainerReconnect();
  setStatus('connecting', 'Forbindelsen blev afbrudt', 'Forsøger automatisk igen');
  log('Bluetooth-forbindelsen blev afbrudt.');

  const delays = [1000, 2000, 4000, 8000];
  for (const delay of delays) {
    if (reconnectCancelled) return;
    await new Promise(resolve => setTimeout(resolve, delay));
    try {
      await connectGatt();
      return;
    } catch (error) {
      log(`Genforbindelse mislykkedes: ${error.message}`);
    }
  }

  setStatus('disconnected', 'Forbindelsen er væk', 'Tryk på Forbind til KICKR');
  showToast('Kunne ikke genoprette forbindelsen');
}

async function disconnect() {
  reconnectCancelled = true;
  stopDemo();
  prepareForTrainerReconnect();

  for (const item of subscribedCharacteristics) {
    try {
      item.characteristic.removeEventListener('characteristicvaluechanged', item.handler);
      await item.characteristic.stopNotifications();
    } catch (_) {
      // Characteristic may already be invalid after a disconnect.
    }
  }
  subscribedCharacteristics = [];

  if (bluetoothDevice?.gatt?.connected) bluetoothDevice.gatt.disconnect();
  setStatus('disconnected', 'Ikke forbundet', 'Tryk på Forbind til KICKR');
  els.dataSource.textContent = 'Datakilde: --';
  log('Forbindelsen blev afbrudt manuelt.');
  await releaseWakeLock();
}

function handleHeartRateMeasurement(event) {
  const view = event.target.value;
  if (!view || view.byteLength < 2) return;
  const flags = view.getUint8(0);
  const heartRate = flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1);
  updateHeartRate(heartRate);
}

async function connectHeartRate() {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth findes ikke i denne browser.');
  heartRateReconnectCancelled = false;
  setHeartRateStatus('connecting', 'Pulsmåler', 'Vælg enhed');
  heartRateDevice = await navigator.bluetooth.requestDevice({
    filters: [{ services: [UUID.heartRateService] }],
    optionalServices: [UUID.heartRateService],
  });
  addBluetoothDisconnectListener(heartRateDevice, handleHeartRateDisconnected);
  await connectHeartRateGatt();
}

async function connectHeartRateGatt() {
  if (!heartRateDevice) throw new Error('Ingen pulsmåler er valgt.');
  setHeartRateStatus('connecting', heartRateDevice.name || 'Pulsmåler', 'Forbinder');
  const server = heartRateDevice.gatt.connected ? heartRateDevice.gatt : await heartRateDevice.gatt.connect();
  const service = await server.getPrimaryService(UUID.heartRateService);
  heartRateCharacteristic = await service.getCharacteristic(UUID.heartRateMeasurement);
  heartRateCharacteristic.addEventListener('characteristicvaluechanged', handleHeartRateMeasurement);
  await heartRateCharacteristic.startNotifications();
  setHeartRateStatus('connected', heartRateDevice.name || 'Pulsmåler', 'Forbundet');
  rememberBluetoothDevice('heart_rate', heartRateDevice);
  els.heartRateConnectButton.hidden = true;
  els.heartRateDisconnectButton.hidden = false;
  log(`Pulsmåler forbundet: ${heartRateDevice.name || 'ukendt enhed'}.`);
  showToast('Pulsmåleren er forbundet');
}

async function handleHeartRateDisconnected() {
  if (heartRateReconnectCancelled || !heartRateDevice) return;
  setHeartRateStatus('connecting', heartRateDevice.name || 'Pulsmåler', 'Forsøger igen');
  for (const delay of [1000, 2000, 4000, 8000]) {
    if (heartRateReconnectCancelled) return;
    await new Promise(resolve => setTimeout(resolve, delay));
    try {
      await connectHeartRateGatt();
      return;
    } catch (error) {
      log(`Genforbindelse til puls mislykkedes: ${error.message}`);
    }
  }
  els.heartRateConnectButton.hidden = false;
  els.heartRateDisconnectButton.hidden = true;
  setHeartRateStatus('disconnected', 'Pulsmåler', 'Ikke forbundet');
  session.currentHeartRate = null;
  els.heartRateValue.textContent = '--';
  setRing(els.heartRateRing, 0, 200);
  updateHeartRateChart(true, false);
}

async function disconnectHeartRate() {
  heartRateReconnectCancelled = true;
  try {
    heartRateCharacteristic?.removeEventListener('characteristicvaluechanged', handleHeartRateMeasurement);
    await heartRateCharacteristic?.stopNotifications();
  } catch (_) {
    // Enheden kan allerede være afbrudt.
  }
  if (heartRateDevice?.gatt?.connected) heartRateDevice.gatt.disconnect();
  heartRateCharacteristic = null;
  session.currentHeartRate = null;
  els.heartRateValue.textContent = '--';
  setHeartRateStatus('disconnected', 'Pulsmåler', 'Ikke forbundet');
  els.heartRateConnectButton.hidden = false;
  els.heartRateDisconnectButton.hidden = true;
  setRing(els.heartRateRing, 0, 200);
  updateHeartRateChart(true, false);
  log('Pulsmåleren blev afbrudt manuelt.');
}

async function reconnectTrainerFromRememberedDevice(device) {
  if (!device || hasActiveBluetoothDevice(bluetoothDevice)) return false;
  bluetoothDevice = device;
  reconnectCancelled = false;
  addBluetoothDisconnectListener(bluetoothDevice, handleDisconnected);
  prepareForTrainerReconnect();
  setStatus('connecting', bluetoothDevice.name || 'Wahoo KICKR', 'Forbinder automatisk');
  log(`Forsøger automatisk forbindelse til KICKR: ${bluetoothDevice.name || 'ukendt enhed'}.`);
  await connectGatt();
  return true;
}

async function reconnectHeartRateFromRememberedDevice(device) {
  if (!device || hasActiveBluetoothDevice(heartRateDevice)) return false;
  heartRateDevice = device;
  heartRateReconnectCancelled = false;
  addBluetoothDisconnectListener(heartRateDevice, handleHeartRateDisconnected);
  els.heartRateConnectButton.disabled = true;
  setHeartRateStatus('connecting', heartRateDevice.name || 'Pulsmåler', 'Forbinder automatisk');
  log(`Forsøger automatisk forbindelse til puls: ${heartRateDevice.name || 'ukendt enhed'}.`);
  try {
    await connectHeartRateGatt();
    return true;
  } finally {
    els.heartRateConnectButton.disabled = false;
  }
}

async function autoReconnectBluetoothDevices() {
  if (!navigator.bluetooth) return;

  if (typeof navigator.bluetooth.getDevices !== 'function') {
    log('Automatisk Bluetooth-genforbindelse understøttes ikke af denne browser.');
    return;
  }

  let devices = [];
  try {
    setStatus('connecting', 'Tjekker KICKR', 'Leder efter tidligere godkendt udstyr');
    setHeartRateStatus('connecting', 'Pulsmåler', 'Tjekker tidligere godkendelse');
    devices = await navigator.bluetooth.getDevices();
  } catch (error) {
    log(`Kunne ikke hente tidligere godkendt Bluetooth-udstyr: ${error.message}`);
    setStatus('disconnected', 'Ikke forbundet', 'Tryk på Forbind KICKR');
    setHeartRateStatus('disconnected', 'Pulsmåler', 'Ikke forbundet');
    return;
  }

  if (!devices.length) {
    log('Ingen tidligere godkendte Bluetooth-enheder fundet.');
    setStatus('disconnected', 'Ikke forbundet', 'Tryk på Forbind KICKR');
    setHeartRateStatus('disconnected', 'Pulsmåler', 'Ikke forbundet');
    return;
  }

  log(`Fandt ${devices.length} tidligere godkendt(e) Bluetooth-enhed(er).`);

  const rememberedKickr = findRememberedDevice(devices, 'kickr');
  const rememberedHeartRate = findRememberedDevice(devices, 'heart_rate');

  if (rememberedKickr) {
    try {
      await reconnectTrainerFromRememberedDevice(rememberedKickr);
    } catch (error) {
      log(`Automatisk KICKR-forbindelse mislykkedes: ${error.message}`);
      setStatus('disconnected', 'KICKR ikke forbundet', 'Tryk på Forbind KICKR');
    }
  } else {
    setStatus('disconnected', 'Ikke forbundet', 'Tryk på Forbind KICKR');
  }

  if (rememberedHeartRate && rememberedHeartRate.id !== rememberedKickr?.id) {
    try {
      await reconnectHeartRateFromRememberedDevice(rememberedHeartRate);
    } catch (error) {
      log(`Automatisk puls-forbindelse mislykkedes: ${error.message}`);
      setHeartRateStatus('disconnected', 'Pulsmåler', 'Tryk på Forbind puls');
    }
  } else {
    setHeartRateStatus('disconnected', 'Pulsmåler', 'Tryk på Forbind puls');
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => log('Skærmlås blev frigivet.'));
    log('Skærmen holdes vågen.');
  } catch (error) {
    log(`Kunne ikke holde skærmen vågen: ${error.message}`);
  }
}

async function releaseWakeLock() {
  try { await wakeLock?.release(); } catch (_) { /* no-op */ }
  wakeLock = null;
}

function startDemo() {
  if (demoTimer) {
    stopDemo();
    return;
  }

  let phase = 0;
  resetSession(false);
  els.demoButton.textContent = 'Stop testvisning';
  els.dataSource.textContent = 'Datakilde: testdata';
  if (!trainingReference.lastRideAverage && !trainingReference.thirtyDayAverage) {
    trainingReference = {
      lastRideAverage: 206,
      thirtyDayAverage: 210,
      lastRide: null,
      thirtyDayActivities: 0,
    };
    updateHistoryUi();
    updateComparisons();
  }
  setHeartRateStatus('connected', 'Simuleret pulsmåler', 'Testdata');
  setStatus('connected', 'Testvisning', 'Simulerede tal – ikke KICKR-data');
  log('Testvisning startet.');

  demoTimer = setInterval(() => {
    phase += 0.16;
    const power = 185 + Math.sin(phase) * 55 + Math.sin(phase * 0.37) * 25;
    const cadence = 84 + Math.sin(phase * 0.72) * 8;
    const heartRate = 142 + Math.sin(phase * 0.3) * 11;
    updatePower(power);
    updateCadence(cadence);
    updateHeartRate(heartRate);
  }, 500);
}

function stopDemo() {
  if (!demoTimer) return;
  clearInterval(demoTimer);
  demoTimer = null;
  els.demoButton.textContent = 'Start testvisning';
  setStatus('disconnected', 'Ikke forbundet', 'Tryk på Forbind til KICKR');
  els.dataSource.textContent = 'Datakilde: --';
  trainingReference = calculateTrainingReference(trainingHistory.activities);
  updateHistoryUi();
  updateComparisons();
  if (heartRateDevice?.gatt?.connected) {
    setHeartRateStatus('connected', heartRateDevice.name || 'Pulsmåler', 'Forbundet');
  } else {
    setHeartRateStatus('disconnected', 'Pulsmåler', 'Ikke forbundet');
  }
  log('Testvisning stoppet.');
}


function setSettingsOpen(open) {
  if (!els.settingsPanel || !els.settingsBackdrop) return;
  const wasOpen = !els.settingsPanel.hidden;
  els.settingsPanel.hidden = !open;
  els.settingsBackdrop.hidden = !open;
  els.settingsButton?.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) els.settingsPanel.focus();
  else if (wasOpen) els.settingsButton?.focus();
}

function isInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

function updateInstallButton() {
  if (!els.installButton) return;
  els.installButton.hidden = isInstalledApp() || !deferredInstallPrompt;
}

async function installApp() {
  if (isInstalledApp()) {
    showToast('Appen er allerede installeret');
    return;
  }
  if (!deferredInstallPrompt) {
    showToast('Brug Edge-menuen og vælg Apps → Installér dette websted som app');
    return;
  }
  deferredInstallPrompt.prompt();
  try {
    await deferredInstallPrompt.userChoice;
  } catch (_) {
    // ignore
  }
  deferredInstallPrompt = null;
  updateInstallButton();
}

async function toggleFullscreen() {
  if (window.matchMedia('(display-mode: fullscreen)').matches && !document.fullscreenElement) {
    showToast('Appen kører allerede i fuld skærm');
    return;
  }

  if (!document.fullscreenEnabled || typeof document.documentElement.requestFullscreen !== 'function') {
    showToast('Browseren tillader ikke fuld skærm her');
    return;
  }

  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    log(`Fuldskærmsfejl: ${error.message}`);
    showToast('Fuld skærm blev afvist af browseren');
  }
}

els.connectButton.addEventListener('click', async () => {
  stopDemo();
  try {
    await connectToSelectedDevice();
  } catch (error) {
    setStatus('disconnected', 'Forbindelsen mislykkedes', error.message);
    log(`Fejl: ${error.message}`);
    showToast(error.message);
  }
});

els.disconnectButton.addEventListener('click', disconnect);
els.resetButton.addEventListener('click', resetSession);
els.stopRideButton?.addEventListener('click', stopRide);
els.chooseRideFolderButton?.addEventListener('click', chooseRideFolder);
els.heartRateConnectButton?.addEventListener('click', async () => {
  stopDemo();
  try {
    await connectHeartRate();
  } catch (error) {
    setHeartRateStatus('disconnected', 'Pulsmåler', 'Ikke forbundet');
    log(`Pulsfejl: ${error.message}`);
    showToast(error.message);
  }
});
els.heartRateDisconnectButton?.addEventListener('click', disconnectHeartRate);
els.reloadHistoryButton?.addEventListener('click', () => loadTrainingHistory({ announce: true }));
els.demoButton.addEventListener('click', startDemo);
els.fullscreenButton.addEventListener('click', toggleFullscreen);
els.installButton?.addEventListener('click', installApp);
els.settingsButton?.addEventListener('click', () => setSettingsOpen(true));
els.closeSettingsButton?.addEventListener('click', () => setSettingsOpen(false));
els.settingsBackdrop?.addEventListener('click', () => setSettingsOpen(false));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setSettingsOpen(false);
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && bluetoothDevice?.gatt?.connected) await requestWakeLock();
});

window.addEventListener('beforeunload', () => {
  reconnectCancelled = true;
  stopRideLogging();
  if (bluetoothDevice?.gatt?.connected) bluetoothDevice.gatt.disconnect();
  if (heartRateDevice?.gatt?.connected) heartRateDevice.gatt.disconnect();
});


window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButton();
  showToast('Appen er installeret');
});

setInterval(updateElapsed, 500);
updateHistoryUi();
loadTrainingHistory();
updateComparisons();
updatePowerChart(true);
updateInstallButton();
setRideActiveUi(false);
restoreRideDirectory();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => log(`Service worker-fejl: ${error.message}`));
  });
}

const startupParams = new URLSearchParams(window.location.search);
const shouldStartDemo = startupParams.get('demo') === '1';

if (!navigator.bluetooth) {
  setStatus('disconnected', 'Web Bluetooth mangler', 'Åbn siden i Microsoft Edge eller Google Chrome');
  els.connectButton.disabled = true;
  els.heartRateConnectButton.disabled = true;
  log('Browseren understøtter ikke navigator.bluetooth.');
} else if (!shouldStartDemo) {
  window.setTimeout(() => {
    autoReconnectBluetoothDevices().catch(error => log(`Auto-genforbindelse stoppede: ${error.message}`));
  }, 500);
}

if (shouldStartDemo) {
  window.setTimeout(startDemo, 250);
}
