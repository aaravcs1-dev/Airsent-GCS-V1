// telemetry.js — Airsent GCS
// isRealMode declared in script.js which loads before this file

var socket = null;         // var so script.js can reference it globally
let reconnectTimer = null;
let isConnecting = false;
let mapHasZoomed = false;  // auto-zoom to drone once on first GPS fix per connection

// ─── CHART CONFIG ─────────────────────────────────────────────────────────────
const CHART_POINTS = 60;

const chartBuffers = {
  roll:      [], pitch:     [],
  alt:       [], climb:     [],
  voltage:   [], current:   [],
  sats:      [], hdop:      [],
  vib_x:     [], vib_y:    [], vib_z: [],
  motor_avg: [], throttle:  [],
};

function pushBuffer(key, value) {
  if (chartBuffers[key] === undefined) return;
  chartBuffers[key].push(typeof value === "number" ? value : 0);
  if (chartBuffers[key].length > CHART_POINTS) chartBuffers[key].shift();
}

function resetAllBuffers() {
  Object.keys(chartBuffers).forEach(k => { chartBuffers[k] = []; });
  mapHasZoomed = false;
}

function normalize(arr, fixedMin, fixedMax) {
  if (arr.length === 0) return [];
  const min = fixedMin !== undefined ? fixedMin : Math.min(...arr);
  const max = fixedMax !== undefined ? fixedMax : Math.max(...arr);
  if (max === min) return arr.map(() => 0.5);
  return arr.map(v => Math.max(0, Math.min(1, (v - min) / (max - min))));
}

function lastVal(arr, decimals = 1, unit = "") {
  if (arr.length === 0) return "--";
  const v = arr[arr.length - 1];
  return (typeof v === "number" ? v.toFixed(decimals) : v) + unit;
}

// ─── CHART RENDERER ───────────────────────────────────────────────────────────
function drawLiveChart(canvasId, lines, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const rect = canvas.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  if (W <= 0 || H <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const { gridX = 10, gridY = 5, showLegend = true } = options;

  ctx.fillStyle = "#03070c";
  ctx.fillRect(0, 0, W, H);

  const legendH = showLegend ? 14 : 0;
  const plotTop = legendH + 2;
  const plotH = H - plotTop - 4;

  if (showLegend) {
    let lx = 6;
    ctx.font = "9px Arial";
    lines.forEach(line => {
      const val = lastVal(line.data, line.decimals ?? 1, line.unit ?? "");
      const label = `${line.label ?? ""}: ${val}`;
      ctx.fillStyle = line.color;
      ctx.fillRect(lx, 3, 8, 8);
      ctx.fillStyle = "rgba(200,220,235,0.85)";
      ctx.fillText(label, lx + 11, 11);
      lx += ctx.measureText(label).width + 20;
    });
  }

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= gridX; x++) {
    const px = (x / gridX) * W;
    ctx.beginPath(); ctx.moveTo(px, plotTop); ctx.lineTo(px, plotTop + plotH); ctx.stroke();
  }
  for (let y = 0; y <= gridY; y++) {
    const py = plotTop + (y / gridY) * plotH;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
  }

  const zeroY = plotTop + plotH * 0.5;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.setLineDash([3, 5]);
  ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(W, zeroY); ctx.stroke();
  ctx.setLineDash([]);

  lines.forEach(line => {
    if (!line.data || line.data.length < 2) return;
    const norm = normalize(line.data, line.fixedMin, line.fixedMax);

    ctx.beginPath();
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.width ?? 1.5;
    ctx.lineJoin = "round";

    norm.forEach((v, i) => {
      const x = (i / (norm.length - 1)) * W;
      const y = plotTop + plotH - v * plotH * 0.9 - plotH * 0.05;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    if (norm.length > 0) {
      const lv = norm[norm.length - 1];
      const lx = W - 2;
      const ly = plotTop + plotH - lv * plotH * 0.9 - plotH * 0.05;
      ctx.beginPath();
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = line.color;
      ctx.fill();
    }
  });

  const hasData = lines.some(l => l.data && l.data.length > 0);
  if (!hasData) {
    ctx.fillStyle = "rgba(100,140,160,0.4)";
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    ctx.fillText("NO DATA", W / 2, plotTop + plotH / 2);
    ctx.textAlign = "left";
  }
}

function redrawAllCharts() {
  drawLiveChart("chart1", [
    { data: chartBuffers.roll,  color: "#7fdcff", label: "ROLL",  unit: "°", decimals: 1, fixedMin: -30, fixedMax: 30 },
    { data: chartBuffers.pitch, color: "#bfff88", label: "PITCH", unit: "°", decimals: 1, fixedMin: -30, fixedMax: 30 },
  ], { gridX: 10, gridY: 4 });

  drawLiveChart("chart2", [
    { data: chartBuffers.alt,   color: "#f0bc59", label: "ALT",   unit: "m",   decimals: 1 },
    { data: chartBuffers.climb, color: "#7fdcff", label: "CLIMB", unit: "m/s", decimals: 2 },
  ], { gridX: 10, gridY: 4 });

  drawLiveChart("chart3", [
    { data: chartBuffers.voltage, color: "#c8ff80", label: "VOLT",    unit: "V", decimals: 1, fixedMin: 10, fixedMax: 17 },
    { data: chartBuffers.current, color: "#ff7eb3", label: "CURRENT", unit: "A", decimals: 1 },
  ], { gridX: 10, gridY: 4 });

  drawLiveChart("chart4", [
    { data: chartBuffers.sats, color: "#bfff88", label: "SATS", unit: "", decimals: 0, fixedMin: 0, fixedMax: 25 },
    { data: chartBuffers.hdop, color: "#7fdcff", label: "HDOP", unit: "", decimals: 2, fixedMin: 0, fixedMax: 5 },
  ], { gridX: 10, gridY: 4 });

  drawLiveChart("chart5", [
    { data: chartBuffers.vib_x, color: "#ffffff", label: "VIB X", unit: "", decimals: 3, width: 1.2 },
    { data: chartBuffers.vib_y, color: "#7fdcff", label: "VIB Y", unit: "", decimals: 3, width: 1.2 },
    { data: chartBuffers.vib_z, color: "#ff674e", label: "VIB Z", unit: "", decimals: 3, width: 1.2 },
  ], { gridX: 12, gridY: 4 });

  drawLiveChart("chart6", [
    { data: chartBuffers.motor_avg, color: "#bfff88", label: "MOTOR AVG", unit: "%", decimals: 1, fixedMin: 0, fixedMax: 100 },
    { data: chartBuffers.current,   color: "#7fdcff", label: "CURRENT",   unit: "A", decimals: 1 },
    { data: chartBuffers.voltage,   color: "#ff674e", label: "VOLTAGE",   unit: "V", decimals: 1, fixedMin: 10, fixedMax: 17 },
  ], { gridX: 18, gridY: 4 });

  const vibMag = chartBuffers.vib_x.map((x, i) => {
    const y = chartBuffers.vib_y[i] ?? 0;
    const z = chartBuffers.vib_z[i] ?? 0;
    return Math.sqrt(x*x + y*y + z*z);
  });
  drawLiveChart("chart7", [
    { data: chartBuffers.sats, color: "#7fdcff", label: "SATS",    unit: "",  decimals: 0 },
    { data: chartBuffers.alt,  color: "#bfff88", label: "ALT",     unit: "m", decimals: 1 },
    { data: vibMag,            color: "#ffffff", label: "VIB MAG", unit: "",  decimals: 3, width: 1.2 },
  ], { gridX: 18, gridY: 4 });
}

// ─── RESET BUTTON ─────────────────────────────────────────────────────────────
function injectResetButton() {
  if (document.getElementById("chartResetBtn")) return;
  const timeline = document.querySelector(".bottom-timeline");
  if (!timeline) return;
  const titleEl = timeline.querySelector(".panel-title");
  if (!titleEl) return;

  titleEl.style.display = "flex";
  titleEl.style.justifyContent = "space-between";
  titleEl.style.alignItems = "center";

  const btn = document.createElement("button");
  btn.id = "chartResetBtn";
  btn.textContent = "RESET CHARTS";
  btn.style.cssText = `
    background: transparent;
    border: 1px solid rgba(127,220,255,0.3);
    color: #7fdcff;
    font-size: 9px;
    letter-spacing: 1px;
    padding: 3px 8px;
    cursor: pointer;
    font-family: inherit;
    text-transform: uppercase;
    border-radius: 3px;
    transition: all 0.15s;
  `;
  btn.onmouseover = () => {
    btn.style.background = "rgba(127,220,255,0.1)";
    btn.style.borderColor = "rgba(127,220,255,0.6)";
  };
  btn.onmouseout = () => {
    btn.style.background = "transparent";
    btn.style.borderColor = "rgba(127,220,255,0.3)";
  };
  btn.addEventListener("click", () => {
    resetAllBuffers();
    redrawAllCharts();
  });
  titleEl.appendChild(btn);
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function getEl(id) { return document.getElementById(id); }

function setText(id, value) {
  const el = getEl(id);
  if (el) el.innerText = value;
}

function setStatusSelect(value) {
  const el = getEl("statusSelect");
  if (!el) return;
  el.value = value;
  el.classList.remove("status-armed", "status-prearm", "status-disarmed");
  if (value === "armed") el.classList.add("status-armed");
  if (value === "prearm") el.classList.add("status-prearm");
  if (value === "disarmed") el.classList.add("status-disarmed");
}

function setOnlineStatus(el, text, online) {
  if (!el) return;
  el.innerText = text;
  el.classList.remove("status-online", "status-offline", "sensor-ok", "sensor-offline", "green-text");
  el.classList.add(online ? "status-online" : "status-offline");
}

function setSensorStatus(id, text, online) {
  const el = getEl(id);
  if (!el) return;
  el.innerText = text;
  el.classList.remove("sensor-ok", "sensor-offline");
  el.classList.add(online ? "sensor-ok" : "sensor-offline");
}

function setDisconnectedState() {
  setStatusSelect("disarmed");
  setText("topVoltage", "0.0V"); setText("topCurrent", "0.0A");
  setText("topBattery", "0%");   setText("cpuLoadTop", "0%");
  setText("missionDistanceVal", "0.0"); setText("ltVal", "0");
  setText("rollVal", "0.0°");    setText("pitchVal", "0.0°");
  setText("headingVal", "0°");   setText("compassHeadingText", "0°");
  setText("altVal", "0.0 m");    setText("spdVal", "0.0 m/s");
  setText("lidarAltVal", "-- m");
  setText("latVal", "0.0000°");  setText("lonVal", "0.0000°");
  setText("mapModeVal", "DISCONNECTED");
  setText("positionVal", "NO DATA"); setText("mslVal", "0.0m");
  setText("rssiVal", "0");
  setText("m1pwm","0"); setText("m2pwm","0");
  setText("m3pwm","0"); setText("m4pwm","0");
  setText("m1out","0%"); setText("m2out","0%");
  setText("m3out","0%"); setText("m4out","0%");

  setOnlineStatus(getEl("gpsFixTop"), "NO FIX", false);
  setText("satCountTop", "0");
  setOnlineStatus(getEl("ekfTop"), "OFFLINE", false);
  setOnlineStatus(getEl("linkTop"), "NO SIGNAL", false);

  const rc = getEl("rcTelemetryState");
  if (rc) {
    rc.innerText = "NO SIGNAL";
    rc.classList.remove("green-text", "status-online");
    rc.classList.add("status-offline");
  }

  ["sensorGps","sensorLidar","sensorOpticalFlow","sensorCompass",
   "sensorBattery","sensorImu","sensorBarometer"].forEach(id => {
    setSensorStatus(id, "OFFLINE", false);
  });

  const arrow = getEl("miniCompassArrow");
  if (arrow) arrow.style.transform = "translate(-50%, -50%) rotate(0deg)";
  const disc = getEl("horizonDisc");
  if (disc) disc.style.transform = "rotate(0deg) translateY(0px)";

  ["m1bar","m2bar","m3bar","m4bar"].forEach(id => {
    const el = getEl(id); if (el) el.style.width = "0%";
  });

  mapHasZoomed = false;
  if (window.map) window.map.setView([39.8283, -98.5795], 4);
  if (window.droneMarker) window.droneMarker.setLatLng([39.8283, -98.5795]);
  if (window.homeMarker) window.homeMarker.setLatLng([39.8283, -98.5795]);
  if (window.trailLine) window.trailLine.setLatLngs([[39.8283, -98.5795]]);
}

// ─── LOS DETECTION ────────────────────────────────────────────────────────────
// Detects battery-out / vehicle powered off even if telemetry radio still connected
let losActive = false;
let losTimer = null;

function detectLOS(data) {
  // Battery disconnected = voltage near 0 OR battery% = 0 with no current draw
  const voltageGone = data.voltage !== undefined && data.voltage < 6.0;
  const batteryGone = data.battery !== undefined && data.battery <= 0 && (data.current === undefined || data.current < 0.1);
  return voltageGone || batteryGone;
}

function setLOSState() {
  if (losActive) return; // already in LOS
  losActive = true;

  // Flash topbar red
  const topbar = document.querySelector(".topbar");
  if (topbar) {
    topbar.style.background = "linear-gradient(180deg, rgba(80,10,10,.97), rgba(50,5,5,.99))";
    topbar.style.borderBottomColor = "rgba(248,113,113,.4)";
  }

  // Set LINK to LOS in red
  const linkEl = getEl("linkTop");
  if (linkEl) {
    linkEl.innerText = "LOS";
    linkEl.classList.remove("status-online");
    linkEl.classList.add("status-offline");
    linkEl.style.color = "#f87171";
    linkEl.style.fontWeight = "700";
    linkEl.style.animation = "blink-los 0.8s infinite";
  }

  // RC Telemetry panel
  const rc = getEl("rcTelemetryState");
  if (rc) {
    rc.innerText = "LOSS OF SIGNAL";
    rc.classList.remove("green-text", "status-online");
    rc.classList.add("status-offline");
    rc.style.color = "#f87171";
  }

  // Turn all sensors red
  ["sensorGps","sensorLidar","sensorOpticalFlow","sensorCompass",
   "sensorBattery","sensorImu","sensorBarometer"].forEach(id => {
    setSensorStatus(id, "LOS", false);
  });

  // Zero critical values
  setText("topVoltage", "0.0V");
  setText("topCurrent", "0.0A");
  setText("topBattery", "0%");
  setOnlineStatus(getEl("gpsFixTop"), "LOS", false);
  setOnlineStatus(getEl("ekfTop"), "LOS", false);

  // Inject LOS CSS if not already present
  if (!document.getElementById("los-style")) {
    const style = document.createElement("style");
    style.id = "los-style";
    style.textContent = `
      @keyframes blink-los { 0%,100%{opacity:1} 50%{opacity:.3} }
      #linkTop { animation: blink-los 0.8s infinite; }
    `;
    document.head.appendChild(style);
  }
}

function clearLOSState() {
  if (!losActive) return;
  losActive = false;

  // Restore topbar
  const topbar = document.querySelector(".topbar");
  if (topbar) {
    topbar.style.background = "";
    topbar.style.borderBottomColor = "";
  }

  // Restore link
  const linkEl = getEl("linkTop");
  if (linkEl) {
    linkEl.style.color = "";
    linkEl.style.fontWeight = "";
    linkEl.style.animation = "";
  }
}

function setConnectedState(data) {
  // Check for LOS first
  if (data && detectLOS(data)) {
    setLOSState();
    return; // don't set LINK GOOD
  }

  clearLOSState();
  setOnlineStatus(getEl("linkTop"), "GOOD", true);
  const rc = getEl("rcTelemetryState");
  if (rc) {
    rc.innerText = "LINK GOOD";
    rc.style.color = "";
    rc.classList.remove("status-offline");
    rc.classList.add("green-text", "status-online");
  }
}

function updateMapFromTelemetry(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return;
  setText("latVal", lat.toFixed(4) + "°");
  setText("lonVal", lon.toFixed(4) + "°");

  if (window.droneMarker) window.droneMarker.setLatLng([lat, lon]);

  // Auto-zoom to drone once per connection on first valid GPS fix
  if (window.map && !mapHasZoomed && lat !== 0 && lon !== 0) {
    window.map.setView([lat, lon], 17);
    mapHasZoomed = true;
    // Clear stale trail that accumulated from default USA position
    if (window.trailLine) window.trailLine.setLatLngs([[lat, lon]]);
  }

  if (window.trailLine) {
    const latlngs = window.trailLine.getLatLngs();
    latlngs.push([lat, lon]);
    if (latlngs.length > 500) latlngs.shift();
    window.trailLine.setLatLngs(latlngs);
  }
}

function updateAttitude(data) {
  const r2d = r => (r * 180) / Math.PI;

  if (data.yaw !== undefined) {
    const yawDeg = ((r2d(data.yaw)) + 360) % 360;
    setText("headingVal", Math.round(yawDeg) + "°");
    setText("compassHeadingText", Math.round(yawDeg) + "°");
    const arrow = getEl("miniCompassArrow");
    if (arrow) arrow.style.transform = `translate(-50%, -50%) rotate(${yawDeg}deg)`;
  }

  let rollDeg = null, pitchDeg = null;
  if (data.roll !== undefined) {
    rollDeg = r2d(data.roll);
    setText("rollVal", `${rollDeg >= 0 ? "+" : ""}${rollDeg.toFixed(1)}°`);
    pushBuffer("roll", rollDeg);
  }
  if (data.pitch !== undefined) {
    pitchDeg = r2d(data.pitch);
    setText("pitchVal", `${pitchDeg >= 0 ? "+" : ""}${pitchDeg.toFixed(1)}°`);
    pushBuffer("pitch", pitchDeg);
  }

  const disc = getEl("horizonDisc");
  if (disc && rollDeg !== null && pitchDeg !== null) {
    // disc is 200% size offset -50%/-50%, so transform-origin 25%/25% = center of ring
    disc.style.transformOrigin = "25% 25%";
    // pitch: clamp to ±40px travel, positive pitch = more sky (move down)
    const pitchPx = Math.max(-40, Math.min(40, pitchDeg * 1.2));
    disc.style.transform = `rotate(${rollDeg}deg) translateY(${pitchPx}px)`;
  }
}

function updateMotors(data) {
  ["m1","m2","m3","m4"].forEach(m => {
    if (data[m] !== undefined) setText(`${m}pwm`, Math.floor(data[m]));
    const outKey = `${m}_out`;
    if (data[outKey] !== undefined) {
      setText(`${m}out`, `${Math.floor(data[outKey])}%`);
      const bar = getEl(`${m}bar`);
      if (bar) bar.style.width = `${Math.floor(data[outKey])}%`;
    }
  });

  const outs = ["m1","m2","m3","m4"]
    .map(m => data[`${m}_out`])
    .filter(v => v !== undefined);
  if (outs.length > 0) {
    pushBuffer("motor_avg", outs.reduce((a,b) => a+b, 0) / outs.length);
  }
}

// ─── MAIN APPLY ───────────────────────────────────────────────────────────────
function applyTelemetry(data) {
  setConnectedState(data);

  // If LOS detected, don't update the rest of the UI with fake values
  if (losActive) return;

  if (data.voltage !== undefined) {
    setText("topVoltage", data.voltage.toFixed(1) + "V");
    pushBuffer("voltage", data.voltage);
  }
  if (data.current !== undefined) {
    setText("topCurrent", data.current.toFixed(1) + "A");
    pushBuffer("current", data.current);
  }
  if (data.battery !== undefined) setText("topBattery", `${Math.round(data.battery)}%`);
  if (data.cpu !== undefined) setText("cpuLoadTop", `${Math.round(data.cpu)}%`);

  if (data.sats !== undefined) {
    setText("satCountTop", data.sats);
    pushBuffer("sats", data.sats);
  }
  if (data.fix_type !== undefined) {
    const ok = data.fix_type !== "NO FIX";
    setOnlineStatus(getEl("gpsFixTop"), data.fix_type, ok);
    setSensorStatus("sensorGps", ok ? "NOMINAL" : "NO FIX", ok);
  }
  if (data.hdop != null) pushBuffer("hdop", data.hdop);

  if (data.ekf_healthy !== undefined) {
    setOnlineStatus(getEl("ekfTop"), data.ekf_healthy ? "HEALTHY" : "DEGRADED", data.ekf_healthy);
  }

  if (data.alt !== undefined) {
    setText("altVal", data.alt.toFixed(1) + " m");
    pushBuffer("alt", data.alt);
  }
  if (data.rangefinder !== undefined) {
    setText("lidarAltVal", data.rangefinder.toFixed(2) + " m");
  }
  if (data.groundspeed !== undefined) setText("spdVal", data.groundspeed.toFixed(1) + " m/s");
  if (data.climb !== undefined) pushBuffer("climb", data.climb);
  if (data.throttle !== undefined) pushBuffer("throttle", data.throttle);
  if (data.rssi !== undefined) setText("rssiVal", data.rssi.toFixed(1));

  if (data.flight_mode !== undefined) {
    setText("mapModeVal", data.flight_mode);
    const modeSelect = getEl("flightModeSelect");
    if (modeSelect) modeSelect.value = data.flight_mode;
  }
  if (data.armed !== undefined) setStatusSelect(data.armed ? "armed" : "disarmed");

  if (data.vib_x !== undefined) pushBuffer("vib_x", data.vib_x);
  if (data.vib_y !== undefined) pushBuffer("vib_y", data.vib_y);
  if (data.vib_z !== undefined) pushBuffer("vib_z", data.vib_z);

  if (data.sensors_health !== undefined) {
    const h = data.sensors_health;
    setSensorStatus("sensorImu",        !!(h & 0x3F) ? "NOMINAL" : "FAULT",  !!(h & 0x3F));
    setSensorStatus("sensorCompass",    !!(h & 0x100) ? "NOMINAL" : "FAULT", !!(h & 0x100));
    setSensorStatus("sensorBarometer",  !!(h & 0x20000000) ? "NOMINAL" : "FAULT", !!(h & 0x20000000));
    setSensorStatus("sensorBattery",    "NOMINAL", true);
    setSensorStatus("sensorLidar",      "NOMINAL", true);
    setSensorStatus("sensorOpticalFlow","NOMINAL", true);
  }

  updateAttitude(data);
  updateMotors(data);

  if (data.lat !== undefined && data.lon !== undefined) {
    updateMapFromTelemetry(data.lat, data.lon);
  }

  redrawAllCharts();
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
function connectTelemetry() {
  if (isConnecting) return;
  if (socket && socket.readyState === WebSocket.OPEN) return;
  if (socket && socket.readyState === WebSocket.CONNECTING) return;
  if (!isRealMode) return;

  isConnecting = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  socket = new WebSocket("ws://localhost:8765");

  socket.onopen = () => {
    console.log("✅ WebSocket connected");
    isConnecting = false;
    mapHasZoomed = false; // re-zoom to drone on every new connection
  };

  socket.onclose = () => {
    console.log("WebSocket disconnected. Retrying in 3s...");
    isConnecting = false;
    socket = null;
    setDisconnectedState();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectTelemetry, 3000);
  };

  socket.onerror = () => { isConnecting = false; };

  socket.onmessage = (event) => {
    try { applyTelemetry(JSON.parse(event.data)); }
    catch (e) { console.error("Bad telemetry data:", e); }
  };
}

// ─── DEMO MODE ────────────────────────────────────────────────────────────────
function rnd(min, max) { return Math.random() * (max - min) + min; }

function updateDemoTelemetry() {
  const roll    = rnd(-4, 4);
  const pitch   = rnd(-3, 3);
  const hdg     = rnd(100, 140);
  const alt     = rnd(80, 90);
  const spd     = rnd(4, 7);
  const climb   = rnd(-0.5, 0.5);
  const voltage = rnd(15.4, 16.1);
  const current = rnd(9.0, 12.0);
  const sats    = Math.floor(rnd(17, 22));
  const hdop    = rnd(0.6, 1.4);
  const vib_x   = rnd(0.1, 0.4);
  const vib_y   = rnd(0.1, 0.4);
  const vib_z   = rnd(0.2, 0.6);
  const lat     = 33.4242 + rnd(-0.0008, 0.0008);
  const lon     = -111.9281 + rnd(-0.0008, 0.0008);
  const lidar   = rnd(0.5, 3.5);

  setStatusSelect("armed");
  setText("topVoltage", voltage.toFixed(1) + "V");
  setText("topCurrent", current.toFixed(1) + "A");
  setText("topBattery", Math.floor(rnd(68, 75)) + "%");
  setText("cpuLoadTop", Math.floor(rnd(20, 40)) + "%");

  setOnlineStatus(getEl("gpsFixTop"), "RTK FIX", true);
  setText("satCountTop", sats);
  setOnlineStatus(getEl("ekfTop"), "HEALTHY", true);
  setOnlineStatus(getEl("linkTop"), "GOOD", true);

  setText("rollVal",  `${roll  >= 0 ? "+" : ""}${roll.toFixed(1)}°`);
  setText("pitchVal", `${pitch >= 0 ? "+" : ""}${pitch.toFixed(1)}°`);
  setText("headingVal", Math.round(hdg) + "°");
  setText("compassHeadingText", Math.round(hdg) + "°");
  setText("altVal", alt.toFixed(1) + " m");
  setText("lidarAltVal", lidar.toFixed(2) + " m");
  setText("spdVal", spd.toFixed(1) + " m/s");
  setText("missionDistanceVal", rnd(22.0, 24.0).toFixed(1));
  setText("ltVal", Math.floor(rnd(10, 13)));
  setText("mapModeVal", "POSHOLD");
  setText("positionVal", "17.20 WAYPOINT");
  setText("mslVal", "-1.5m");
  setText("rssiVal", rnd(82, 86).toFixed(1));

  const arrow = getEl("miniCompassArrow");
  if (arrow) arrow.style.transform = `translate(-50%, -50%) rotate(${hdg}deg)`;
  const disc = getEl("horizonDisc");
  if (disc) {
    disc.style.transformOrigin = "25% 25%";
    const pitchPx = Math.max(-40, Math.min(40, pitch * 1.2));
    disc.style.transform = `rotate(${roll}deg) translateY(${pitchPx}px)`;
  }

  updateMapFromTelemetry(lat, lon);

  ["sensorGps","sensorLidar","sensorOpticalFlow","sensorCompass",
   "sensorBattery","sensorImu","sensorBarometer"].forEach(id => {
    setSensorStatus(id, "NOMINAL", true);
  });

  const motors = [
    { pwm: Math.floor(rnd(1400,1500)), out: Math.floor(rnd(39,43)) },
    { pwm: Math.floor(rnd(1400,1500)), out: Math.floor(rnd(40,44)) },
    { pwm: Math.floor(rnd(1400,1500)), out: Math.floor(rnd(38,42)) },
    { pwm: Math.floor(rnd(1400,1500)), out: Math.floor(rnd(41,45)) },
  ];
  motors.forEach((m, i) => {
    setText(`m${i+1}pwm`, m.pwm);
    setText(`m${i+1}out`, `${m.out}%`);
    const bar = getEl(`m${i+1}bar`);
    if (bar) bar.style.width = `${m.out}%`;
  });

  pushBuffer("roll", roll);      pushBuffer("pitch", pitch);
  pushBuffer("alt", alt);        pushBuffer("climb", climb);
  pushBuffer("voltage", voltage); pushBuffer("current", current);
  pushBuffer("sats", sats);      pushBuffer("hdop", hdop);
  pushBuffer("vib_x", vib_x);   pushBuffer("vib_y", vib_y);
  pushBuffer("vib_z", vib_z);
  pushBuffer("motor_avg", motors.reduce((a,m) => a + m.out, 0) / 4);
  pushBuffer("throttle", rnd(30, 45));

  redrawAllCharts();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  injectResetButton();
  redrawAllCharts();
});

window.addEventListener("resize", () => redrawAllCharts());

if (isRealMode) {
  setDisconnectedState();
  connectTelemetry();
} else {
  updateDemoTelemetry();
  setInterval(updateDemoTelemetry, 1000);
}