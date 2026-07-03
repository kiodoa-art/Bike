'use strict';

// Standard Bluetooth SIG UUIDs. The app only subscribes to notifications.
// It never opens or writes to any control-point characteristic.
const UUID = {
  cyclingPowerService: 0x1818,
  cyclingPowerMeasurement: 0x2a63,
  cscService: 0x1816,
  cscMeasurement: 0x2a5b,
  fitnessMachineService: 0x1826,
  indoorBikeData: 0x2ad2,
};

const els = {
  connectButton: document.querySelector('#connectButton'),
  disconnectButton: document.querySelector('#disconnectButton'),
  resetButton: document.querySelector('#resetButton'),
  demoButton: document.querySelector('#demoButton'),
  fullscreenButton: document.querySelector('#fullscreenButton'),
  statusDot: document.querySelector('#statusDot'),
  statusText: document.querySelector('#statusText'),
  deviceText: document.querySelector('#deviceText'),
  powerValue: document.querySelector('#powerValue'),
  cadenceValue: document.querySelector('#cadenceValue'),
  power3s: document.querySelector('#power3s'),
  averagePower: document.querySelector('#averagePower'),
  maxPower: document.querySelector('#maxPower'),
  elapsedTime: document.querySelector('#elapsedTime'),
  powerBarFill: document.querySelector('#powerBarFill'),
  powerHint: document.querySelector('#powerHint'),
  dataSource: document.querySelector('#dataSource'),
  debugLog: document.querySelector('#debugLog'),
  toast: document.querySelector('#toast'),
};

let bluetoothDevice = null;
let subscribedCharacteristics = [];
let reconnectCancelled = false;
let wakeLock = null;
let demoTimer = null;
let elapsedTimer = null;
let toastTimer = null;
let lastCadencePacketAt = 0;

const crankState = {
  power: { revolutions: null, eventTime: null },
  csc: { revolutions: null, eventTime: null },
};

const session = {
  startedAt: null,
  powerSamples: [],
  powerSum: 0,
  powerCount: 0,
  maxPower: 0,
  currentPower: null,
  currentCadence: null,
};

function log(message) {
  const stamp = new Date().toLocaleTimeString('da-DK', { hour12: false });
  els.debugLog.textContent = `[${stamp}] ${message}\n${els.debugLog.textContent}`.slice(0, 7000);
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3400);
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

function ensureSessionStarted(power, cadence) {
  if (!session.startedAt && ((power ?? 0) > 0 || (cadence ?? 0) > 0)) {
    session.startedAt = Date.now();
    log('Turdata startede ved første registrerede bevægelse.');
  }
}

function updatePower(power) {
  if (!Number.isFinite(power)) return;
  const cleanPower = Math.max(0, Math.round(power));
  const now = Date.now();

  session.currentPower = cleanPower;
  ensureSessionStarted(cleanPower, session.currentCadence);

  session.powerSamples.push({ time: now, power: cleanPower });
  session.powerSamples = session.powerSamples.filter(sample => now - sample.time <= 30000);
  session.powerSum += cleanPower;
  session.powerCount += 1;
  session.maxPower = Math.max(session.maxPower, cleanPower);

  const last3s = session.powerSamples.filter(sample => now - sample.time <= 3000);
  const average3s = last3s.length
    ? Math.round(last3s.reduce((sum, sample) => sum + sample.power, 0) / last3s.length)
    : cleanPower;

  els.powerValue.textContent = String(cleanPower);
  els.power3s.textContent = String(average3s);
  els.averagePower.textContent = String(Math.round(session.powerSum / session.powerCount));
  els.maxPower.textContent = String(session.maxPower);
  els.powerBarFill.style.width = `${Math.min(100, (cleanPower / 600) * 100)}%`;
  els.powerHint.textContent = cleanPower === 0 ? 'Ingen belastning registreret' : powerBand(cleanPower);
}

function updateCadence(cadence) {
  if (!Number.isFinite(cadence)) return;
  const cleanCadence = Math.max(0, Math.min(250, Math.round(cadence)));
  session.currentCadence = cleanCadence;
  lastCadencePacketAt = Date.now();
  ensureSessionStarted(session.currentPower, cleanCadence);
  els.cadenceValue.textContent = String(cleanCadence);
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
  }

  if (session.currentCadence !== null && Date.now() - lastCadencePacketAt > 2800) {
    session.currentCadence = 0;
    els.cadenceValue.textContent = '0';
  }
}

function resetSession() {
  session.startedAt = null;
  session.powerSamples = [];
  session.powerSum = 0;
  session.powerCount = 0;
  session.maxPower = 0;
  session.currentPower = null;
  session.currentCadence = null;
  crankState.power.revolutions = null;
  crankState.power.eventTime = null;
  crankState.csc.revolutions = null;
  crankState.csc.eventTime = null;
  els.powerValue.textContent = '--';
  els.cadenceValue.textContent = '--';
  els.power3s.textContent = '--';
  els.averagePower.textContent = '--';
  els.maxPower.textContent = '--';
  els.elapsedTime.textContent = '00:00';
  els.powerBarFill.style.width = '0%';
  els.powerHint.textContent = 'Venter på data';
  showToast('Turdata er nulstillet');
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

  // Bit 0 is "More Data". Instantaneous speed is present when it is NOT set.
  if (!(flags & (1 << 0))) offset += 2;
  if (flags & (1 << 1)) offset += 2; // Average speed

  if (flags & (1 << 2)) {
    if (offset + 2 <= view.byteLength) updateCadence(view.getUint16(offset, true) / 2);
    offset += 2;
  }
  if (flags & (1 << 3)) offset += 2; // Average cadence
  if (flags & (1 << 4)) offset += 3; // Total distance
  if (flags & (1 << 5)) offset += 2; // Resistance level

  if (flags & (1 << 6)) {
    if (offset + 2 <= view.byteLength) updatePower(view.getInt16(offset, true));
    offset += 2;
  }

  if (flags & (1 << 7)) offset += 2; // Average power
  if (flags & (1 << 8)) offset += 5; // Expended energy
  if (flags & (1 << 9)) offset += 1; // Heart rate
  if (flags & (1 << 10)) offset += 1; // MET
  if (flags & (1 << 11)) offset += 2; // Elapsed time
  if (flags & (1 << 12)) offset += 2; // Remaining time
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

  if (!hasPower) {
    try {
      const ftmsService = await server.getPrimaryService(UUID.fitnessMachineService);
      await subscribe(ftmsService, UUID.indoorBikeData, handleIndoorBikeData, 'FTMS Indoor Bike Data');
      sources.push('FTMS');
      hasPower = true;
    } catch (error) {
      log(`FTMS ikke tilgængelig: ${error.message}`);
    }
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

  bluetoothDevice.addEventListener('gattserverdisconnected', handleDisconnected);
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
  log(`Forbundet. Datakilder: ${sources.join(', ')}.`);
  showToast('KICKR er forbundet');
  await requestWakeLock();
}

async function handleDisconnected() {
  if (reconnectCancelled || !bluetoothDevice) return;
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
  resetSession();
  els.demoButton.textContent = 'Stop testvisning';
  els.dataSource.textContent = 'Datakilde: testdata';
  setStatus('connected', 'Testvisning', 'Simulerede tal – ikke KICKR-data');
  log('Testvisning startet.');

  demoTimer = setInterval(() => {
    phase += 0.16;
    const power = 185 + Math.sin(phase) * 55 + Math.sin(phase * 0.37) * 25;
    const cadence = 84 + Math.sin(phase * 0.72) * 8;
    updatePower(power);
    updateCadence(cadence);
  }, 500);
}

function stopDemo() {
  if (!demoTimer) return;
  clearInterval(demoTimer);
  demoTimer = null;
  els.demoButton.textContent = 'Start testvisning';
  setStatus('disconnected', 'Ikke forbundet', 'Tryk på Forbind til KICKR');
  els.dataSource.textContent = 'Datakilde: --';
  log('Testvisning stoppet.');
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    showToast(`Fuld skærm kunne ikke åbnes: ${error.message}`);
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
els.demoButton.addEventListener('click', startDemo);
els.fullscreenButton.addEventListener('click', toggleFullscreen);

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && bluetoothDevice?.gatt?.connected) await requestWakeLock();
});

window.addEventListener('beforeunload', () => {
  reconnectCancelled = true;
  if (bluetoothDevice?.gatt?.connected) bluetoothDevice.gatt.disconnect();
});

elapsedTimer = setInterval(updateElapsed, 500);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => log(`Service worker-fejl: ${error.message}`));
  });
}

if (!navigator.bluetooth) {
  setStatus('disconnected', 'Web Bluetooth mangler', 'Åbn siden i Microsoft Edge eller Google Chrome');
  els.connectButton.disabled = true;
  log('Browseren understøtter ikke navigator.bluetooth.');
}
