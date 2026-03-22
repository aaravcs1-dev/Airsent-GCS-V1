

let socket = null;
let reconnectTimer = null;

function getEl(id) {
  return document.getElementById(id);
}

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

  if (online) {
    el.classList.add("status-online");
  } else {
    el.classList.add("status-offline");
  }
}

function setSensorStatus(id, text, online) {
  const el = getEl(id);
  if (!el) return;

  el.innerText = text;
  el.classList.remove("sensor-ok", "sensor-offline");

  if (online) {
    el.classList.add("sensor-ok");
  } else {
    el.classList.add("sensor-offline");
  }
}

function setDisconnectedState() {
  setStatusSelect("disarmed");

  setText("topVoltage", "0.0V");
  setText("topCurrent", "0.0A");
  setText("topBattery", "0%");
  setText("cpuLoadTop", "0%");
  setText("missionDistanceVal", "0.0");
  setText("ltVal", "0");

  setText("rollVal", "0.0°");
  setText("pitchVal", "0.0°");
  setText("headingVal", "0°");
  setText("compassHeadingText", "0°");
  setText("altVal", "0.0 m");
  setText("spdVal", "0.0 m/s");

  setText("latVal", "0.0000°");
  setText("lonVal", "0.0000°");
  setText("mapModeVal", "DISCONNECTED");
  setText("positionVal", "NO DATA");
  setText("mslVal", "0.0m");
  setText("rssiVal", "0");

  setText("m1pwm", "0");
  setText("m2pwm", "0");
  setText("m3pwm", "0");
  setText("m4pwm", "0");

  setText("m1out", "0%");
  setText("m2out", "0%");
  setText("m3out", "0%");
  setText("m4out", "0%");

  const gpsFixTop = getEl("gpsFixTop");
  const ekfTop = getEl("ekfTop");
  const linkTop = getEl("linkTop");
  const rcTelemetryState = getEl("rcTelemetryState");

  setOnlineStatus(gpsFixTop, "NO FIX", false);
  setText("satCountTop", "0");
  setOnlineStatus(ekfTop, "OFFLINE", false);
  setOnlineStatus(linkTop, "NO SIGNAL", false);

  if (rcTelemetryState) {
    rcTelemetryState.innerText = "NO SIGNAL";
    rcTelemetryState.classList.remove("green-text", "status-online");
    rcTelemetryState.classList.add("status-offline");
  }

  setSensorStatus("sensorGps", "OFFLINE", false);
  setSensorStatus("sensorLidar", "OFFLINE", false);
  setSensorStatus("sensorOpticalFlow", "OFFLINE", false);
  setSensorStatus("sensorCompass", "OFFLINE", false);
  setSensorStatus("sensorBattery", "OFFLINE", false);
  setSensorStatus("sensorImu", "OFFLINE", false);
  setSensorStatus("sensorBarometer", "OFFLINE", false);

  const arrow = getEl("miniCompassArrow");
  if (arrow) {
    arrow.style.transform = "translate(-50%, -50%) rotate(0deg)";
  }

  const horizonDisc = getEl("horizonDisc");
  if (horizonDisc) {
    horizonDisc.style.transform = "rotate(0deg) translateY(0px)";
  }

  const m1bar = getEl("m1bar");
  const m2bar = getEl("m2bar");
  const m3bar = getEl("m3bar");
  const m4bar = getEl("m4bar");

  if (m1bar) m1bar.style.width = "0%";
  if (m2bar) m2bar.style.width = "0%";
  if (m3bar) m3bar.style.width = "0%";
  if (m4bar) m4bar.style.width = "0%";

  if (window.map) {
    window.map.setView([39.8283, -98.5795], 4);
  }
  if (window.droneMarker) {
    window.droneMarker.setLatLng([39.8283, -98.5795]);
  }
  if (window.homeMarker) {
    window.homeMarker.setLatLng([39.8283, -98.5795]);
  }
  if (window.trailLine) {
    window.trailLine.setLatLngs([[39.8283, -98.5795]]);
  }
}

function setConnectedState() {
  setStatusSelect("armed");

  const gpsFixTop = getEl("gpsFixTop");
  const ekfTop = getEl("ekfTop");
  const linkTop = getEl("linkTop");
  const rcTelemetryState = getEl("rcTelemetryState");

  setOnlineStatus(gpsFixTop, "RTK FIX", true);
  setOnlineStatus(ekfTop, "HEALTHY", true);
  setOnlineStatus(linkTop, "GOOD", true);

  if (rcTelemetryState) {
    rcTelemetryState.innerText = "LINK GOOD";
    rcTelemetryState.classList.remove("status-offline");
    rcTelemetryState.classList.add("green-text", "status-online");
  }

  setSensorStatus("sensorGps", "NOMINAL", true);
  setSensorStatus("sensorLidar", "NOMINAL", true);
  setSensorStatus("sensorOpticalFlow", "NOMINAL", true);
  setSensorStatus("sensorCompass", "NOMINAL", true);
  setSensorStatus("sensorBattery", "NOMINAL", true);
  setSensorStatus("sensorImu", "NOMINAL", true);
  setSensorStatus("sensorBarometer", "NOMINAL", true);
}

function updateMapFromTelemetry(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return;

  setText("latVal", lat.toFixed(4) + "°");
  setText("lonVal", lon.toFixed(4) + "°");

  if (window.map) {
    window.map.setView([lat, lon], 16);
  }

  if (window.droneMarker) {
    window.droneMarker.setLatLng([lat, lon]);
  }

  if (window.homeMarker) {
    window.homeMarker.setLatLng([lat, lon]);
  }

  if (window.trailLine) {
    window.trailLine.setLatLngs([[lat, lon]]);
  }
}

function updateAttitude(data) {
  if (data.yaw !== undefined) {
    const yawDeg = ((data.yaw * 180) / Math.PI + 360) % 360;
    setText("headingVal", Math.round(yawDeg) + "°");
    setText("compassHeadingText", Math.round(yawDeg) + "°");

    const arrow = getEl("miniCompassArrow");
    if (arrow) {
      arrow.style.transform = `translate(-50%, -50%) rotate(${yawDeg}deg)`;
    }
  }

  let rollDeg = null;
  let pitchDeg = null;

  if (data.roll !== undefined) {
    rollDeg = (data.roll * 180) / Math.PI;
    setText("rollVal", `${rollDeg >= 0 ? "+" : ""}${rollDeg.toFixed(1)}°`);
  }

  if (data.pitch !== undefined) {
    pitchDeg = (data.pitch * 180) / Math.PI;
    setText("pitchVal", `${pitchDeg >= 0 ? "+" : ""}${pitchDeg.toFixed(1)}°`);
  }

  const horizonDisc = getEl("horizonDisc");
  if (horizonDisc && rollDeg !== null && pitchDeg !== null) {
    horizonDisc.style.transform = `rotate(${rollDeg * 1.7}deg) translateY(${pitchDeg * 2.6}px)`;
  }
}

function updateMotors(data) {
  if (data.m1 !== undefined) setText("m1pwm", Math.floor(data.m1));
  if (data.m2 !== undefined) setText("m2pwm", Math.floor(data.m2));
  if (data.m3 !== undefined) setText("m3pwm", Math.floor(data.m3));
  if (data.m4 !== undefined) setText("m4pwm", Math.floor(data.m4));

  if (data.m1_out !== undefined) {
    setText("m1out", `${Math.floor(data.m1_out)}%`);
    const bar = getEl("m1bar");
    if (bar) bar.style.width = `${Math.floor(data.m1_out)}%`;
  }

  if (data.m2_out !== undefined) {
    setText("m2out", `${Math.floor(data.m2_out)}%`);
    const bar = getEl("m2bar");
    if (bar) bar.style.width = `${Math.floor(data.m2_out)}%`;
  }

  if (data.m3_out !== undefined) {
    setText("m3out", `${Math.floor(data.m3_out)}%`);
    const bar = getEl("m3bar");
    if (bar) bar.style.width = `${Math.floor(data.m3_out)}%`;
  }

  if (data.m4_out !== undefined) {
    setText("m4out", `${Math.floor(data.m4_out)}%`);
    const bar = getEl("m4bar");
    if (bar) bar.style.width = `${Math.floor(data.m4_out)}%`;
  }
}

function applyTelemetry(data) {
  setConnectedState();

  if (data.voltage !== undefined) setText("topVoltage", data.voltage.toFixed(1) + "V");
  if (data.current !== undefined) setText("topCurrent", data.current.toFixed(1) + "A");
  if (data.battery !== undefined) setText("topBattery", `${Math.round(data.battery)}%`);
  if (data.sats !== undefined) setText("satCountTop", data.sats);

  if (data.alt !== undefined) setText("altVal", data.alt.toFixed(1) + " m");
  if (data.spd !== undefined) setText("spdVal", data.spd.toFixed(1) + " m/s");
  if (data.cpu !== undefined) setText("cpuLoadTop", `${Math.round(data.cpu)}%`);
  if (data.rssi !== undefined) setText("rssiVal", data.rssi.toFixed(1));

  if (data.flight_mode !== undefined) {
    setText("mapModeVal", data.flight_mode);
    const modeSelect = getEl("flightModeSelect");
    if (modeSelect) modeSelect.value = data.flight_mode;
  }

  updateAttitude(data);
  updateMotors(data);

  if (data.lat !== undefined && data.lon !== undefined) {
    updateMapFromTelemetry(data.lat, data.lon);
  }
}

function connectTelemetry() {
  if (!isRealMode) return;

  socket = new WebSocket("ws://localhost:8765");

  socket.onopen = () => {
    console.log("Connected to telemetry server");
  };

  socket.onclose = () => {
    console.log("Disconnected from telemetry server. Retrying...");
    setDisconnectedState();

    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectTelemetry, 2000);
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      applyTelemetry(data);
    } catch (e) {
      console.error("Bad telemetry data:", e);
    }
  };
}

function updateDemoTelemetry() {
  setStatusSelect("armed");
  setText("topVoltage", random(15.4, 16.1).toFixed(1) + "V");
  setText("topCurrent", random(9.0, 12.0).toFixed(1) + "A");
  setText("topBattery", Math.floor(random(68, 75)) + "%");
  setText("cpuLoadTop", Math.floor(random(20, 40)) + "%");

  setOnlineStatus(getEl("gpsFixTop"), "RTK FIX", true);
  setText("satCountTop", Math.floor(random(17, 22)));
  setOnlineStatus(getEl("ekfTop"), "HEALTHY", true);
  setOnlineStatus(getEl("linkTop"), "GOOD", true);

  const roll = random(-4, 4);
  const pitch = random(-3, 3);
  const hdg = random(100, 140);
  const alt = random(80, 90);
  const spd = random(4, 7);
  const lat = 33.4242 + random(-0.0008, 0.0008);
  const lon = -111.9281 + random(-0.0008, 0.0008);

  setText("rollVal", `${roll >= 0 ? "+" : ""}${roll.toFixed(1)}°`);
  setText("pitchVal", `${pitch >= 0 ? "+" : ""}${pitch.toFixed(1)}°`);
  setText("headingVal", Math.round(hdg) + "°");
  setText("compassHeadingText", Math.round(hdg) + "°");
  setText("altVal", alt.toFixed(1) + " m");
  setText("spdVal", spd.toFixed(1) + " m/s");
  setText("missionDistanceVal", random(22.0, 24.0).toFixed(1));
  setText("ltVal", Math.floor(random(10, 13)));
  setText("mapModeVal", "POSHOLD");
  setText("positionVal", "17.20 WAYPOINT");
  setText("mslVal", "-1.5m");
  setText("rssiVal", random(82, 86).toFixed(1));

  if (getEl("miniCompassArrow")) {
    getEl("miniCompassArrow").style.transform = `translate(-50%, -50%) rotate(${hdg}deg)`;
  }

  if (getEl("horizonDisc")) {
    getEl("horizonDisc").style.transform = `rotate(${roll * 1.7}deg) translateY(${pitch * 2.6}px)`;
  }

  updateMapFromTelemetry(lat, lon);

  setSensorStatus("sensorGps", "NOMINAL", true);
  setSensorStatus("sensorLidar", "NOMINAL", true);
  setSensorStatus("sensorOpticalFlow", "NOMINAL", true);
  setSensorStatus("sensorCompass", "NOMINAL", true);
  setSensorStatus("sensorBattery", "NOMINAL", true);
  setSensorStatus("sensorImu", "NOMINAL", true);
  setSensorStatus("sensorBarometer", "NOMINAL", true);

  const m1 = Math.floor(random(1400, 1500));
  const m2 = Math.floor(random(1400, 1500));
  const m3 = Math.floor(random(1400, 1500));
  const m4 = Math.floor(random(1400, 1500));

  setText("m1pwm", m1);
  setText("m2pwm", m2);
  setText("m3pwm", m3);
  setText("m4pwm", m4);

  const m1Out = Math.floor(random(39, 43));
  const m2Out = Math.floor(random(40, 44));
  const m3Out = Math.floor(random(38, 42));
  const m4Out = Math.floor(random(41, 45));

  setText("m1out", `${m1Out}%`);
  setText("m2out", `${m2Out}%`);
  setText("m3out", `${m3Out}%`);
  setText("m4out", `${m4Out}%`);

  if (getEl("m1bar")) getEl("m1bar").style.width = `${m1Out}%`;
  if (getEl("m2bar")) getEl("m2bar").style.width = `${m2Out}%`;
  if (getEl("m3bar")) getEl("m3bar").style.width = `${m3Out}%`;
  if (getEl("m4bar")) getEl("m4bar").style.width = `${m4Out}%`;
}

if (isRealMode) {
  setDisconnectedState();
  connectTelemetry();
} else {
  updateDemoTelemetry();
  setInterval(updateDemoTelemetry, 1000);
} 