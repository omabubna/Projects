const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// TRACK WAYPOINTS — Matching the image exactly:
//   LEFT:  Vertical S-curve (3 alternating bends, south→north)
//   TOP:   Outer oval — horizontal top straight + right D-curve + dashed return line
//   MID:   Inner oval — smaller rectangle inside outer oval
//   BTM-R: Figure-8 — two crossing loops at bottom-right
//
// Coordinate system:
//   lon_min=77.5920 (left/west)  lon_max=77.5978 (right/east)
//   lat_max=12.9726 (top/north)  lat_min=12.9700 (bottom/south)
//   1 deg lat ≈ 111 km  →  0.0001 deg ≈ 11.1 m
//   1 deg lon ≈ 94 km @ lat13  → 0.0001 deg ≈ 9.4 m
//   Track spans: ~580 m (E-W) × ~290 m (N-S)
// ─────────────────────────────────────────────────────────────────────────────
const TRACK_WAYPOINTS = [
  // ══════════════════════════════
  // START / FINISH  (south end of S-curve)
  // ══════════════════════════════
  { lat: 12.9703, lon: 77.5926 },   // 0  START

  // ══════════════════════════════
  // S-CURVE  (going northward, 3 bends)
  // The road has a dashed centre line — 2-lane style
  // Bend-1: curve east, Bend-2: curve west, Bend-3: curve east
  // ══════════════════════════════
  { lat: 12.9706, lon: 77.5925 },   // 1
  { lat: 12.9708, lon: 77.5927 },   // 2  bend-1 east peak
  { lat: 12.9710, lon: 77.5926 },   // 3
  { lat: 12.9712, lon: 77.5924 },   // 4  bend-2 west peak
  { lat: 12.9714, lon: 77.5926 },   // 5
  { lat: 12.9716, lon: 77.5928 },   // 6  bend-3 east peak
  { lat: 12.9718, lon: 77.5927 },   // 7
  { lat: 12.9720, lon: 77.5925 },   // 8
  { lat: 12.9722, lon: 77.5926 },   // 9  top of S, entering arena

  // ══════════════════════════════
  // TOP STRAIGHT  (east along top of arena)
  // ══════════════════════════════
  { lat: 12.9722, lon: 77.5930 },   // 10
  { lat: 12.9722, lon: 77.5936 },   // 11
  { lat: 12.9722, lon: 77.5942 },   // 12
  { lat: 12.9722, lon: 77.5948 },   // 13
  { lat: 12.9722, lon: 77.5954 },   // 14
  { lat: 12.9722, lon: 77.5960 },   // 15
  { lat: 12.9722, lon: 77.5965 },   // 16

  // ══════════════════════════════
  // RIGHT D-CURVE  (top-right semicircle)
  // ══════════════════════════════
  { lat: 12.9720, lon: 77.5969 },   // 17
  { lat: 12.9717, lon: 77.5972 },   // 18
  { lat: 12.9713, lon: 77.5974 },   // 19  east-most point
  { lat: 12.9709, lon: 77.5972 },   // 20
  { lat: 12.9706, lon: 77.5969 },   // 21

  // ══════════════════════════════
  // MIDDLE RETURN  (westward — the dashed divider line in image)
  // ══════════════════════════════
  { lat: 12.9706, lon: 77.5964 },   // 22
  { lat: 12.9706, lon: 77.5958 },   // 23
  { lat: 12.9706, lon: 77.5952 },   // 24
  { lat: 12.9706, lon: 77.5946 },   // 25
  { lat: 12.9706, lon: 77.5940 },   // 26
  { lat: 12.9706, lon: 77.5934 },   // 27

  // ══════════════════════════════
  // INNER OVAL  — LEFT END CAP  (turn south)
  // ══════════════════════════════
  { lat: 12.9704, lon: 77.5932 },   // 28
  { lat: 12.9702, lon: 77.5933 },   // 29
  { lat: 12.9701, lon: 77.5935 },   // 30
  { lat: 12.9702, lon: 77.5937 },   // 31
  { lat: 12.9703, lon: 77.5938 },   // 32

  // ══════════════════════════════
  // INNER OVAL  — BOTTOM STRAIGHT  (east)
  // ══════════════════════════════
  { lat: 12.9703, lon: 77.5943 },   // 33
  { lat: 12.9703, lon: 77.5948 },   // 34
  { lat: 12.9703, lon: 77.5953 },   // 35
  { lat: 12.9703, lon: 77.5958 },   // 36

  // ══════════════════════════════
  // FIGURE-8  ENTRY & LEFT LOOP
  // crossing point → left loop → back through crossing
  // ══════════════════════════════
  { lat: 12.9704, lon: 77.5961 },   // 37  approaching figure-8
  { lat: 12.9706, lon: 77.5963 },   // 38  crossing point (X)
  { lat: 12.9707, lon: 77.5961 },   // 39  into left loop
  { lat: 12.9709, lon: 77.5960 },   // 40
  { lat: 12.9710, lon: 77.5958 },   // 41
  { lat: 12.9710, lon: 77.5956 },   // 42
  { lat: 12.9709, lon: 77.5954 },   // 43
  { lat: 12.9707, lon: 77.5953 },   // 44
  { lat: 12.9705, lon: 77.5954 },   // 45
  { lat: 12.9704, lon: 77.5956 },   // 46
  { lat: 12.9704, lon: 77.5958 },   // 47
  { lat: 12.9705, lon: 77.5960 },   // 48
  { lat: 12.9706, lon: 77.5963 },   // 49  crossing point again (X)

  // ══════════════════════════════
  // FIGURE-8  RIGHT LOOP
  // ══════════════════════════════
  { lat: 12.9705, lon: 77.5965 },   // 50
  { lat: 12.9704, lon: 77.5967 },   // 51
  { lat: 12.9704, lon: 77.5970 },   // 52
  { lat: 12.9706, lon: 77.5972 },   // 53
  { lat: 12.9708, lon: 77.5973 },   // 54  east-most of right loop
  { lat: 12.9710, lon: 77.5972 },   // 55
  { lat: 12.9711, lon: 77.5970 },   // 56
  { lat: 12.9711, lon: 77.5967 },   // 57
  { lat: 12.9710, lon: 77.5965 },   // 58
  { lat: 12.9708, lon: 77.5963 },   // 59
  { lat: 12.9706, lon: 77.5963 },   // 60  back to crossing point

  // ══════════════════════════════
  // EXIT FIGURE-8  → head west under inner oval
  // ══════════════════════════════
  { lat: 12.9704, lon: 77.5960 },   // 61
  { lat: 12.9703, lon: 77.5955 },   // 62
  { lat: 12.9703, lon: 77.5948 },   // 63
  { lat: 12.9703, lon: 77.5942 },   // 64
  { lat: 12.9703, lon: 77.5936 },   // 65

  // ══════════════════════════════
  // BOTTOM OF ARENA → south-west back to S-curve return
  // ══════════════════════════════
  { lat: 12.9702, lon: 77.5932 },   // 66
  { lat: 12.9702, lon: 77.5929 },   // 67
  { lat: 12.9703, lon: 77.5927 },   // 68

  // ══════════════════════════════
  // S-CURVE RETURN  (going southward — slight lateral offset for two-lane road)
  // ══════════════════════════════
  { lat: 12.9704, lon: 77.5925 },   // 69
  { lat: 12.9706, lon: 77.5923 },   // 70  bend-3 (south)
  { lat: 12.9708, lon: 77.5925 },   // 71
  { lat: 12.9710, lon: 77.5923 },   // 72  bend-2 west peak
  { lat: 12.9712, lon: 77.5925 },   // 73
  { lat: 12.9714, lon: 77.5924 },   // 74  bend-1 east
  { lat: 12.9716, lon: 77.5926 },   // 75
  { lat: 12.9718, lon: 77.5925 },   // 76
  { lat: 12.9720, lon: 77.5923 },   // 77
  { lat: 12.9722, lon: 77.5924 },   // 78

  // dummy final (same as start, triggers lap)
  { lat: 12.9703, lon: 77.5926 },   // 79  back to START
];

// ─────────────────────────────────────────────────────────────────────────────
// ANIMALS – 7 species with emojis
// ─────────────────────────────────────────────────────────────────────────────
const ANIMALS = [
  { type: 'lion',     emoji: '🦁' },
  { type: 'tiger',    emoji: '🐯' },
  { type: 'bull',     emoji: '🐂' },
  { type: 'buffalo',  emoji: '🦬' },
  { type: 'panda',    emoji: '🐼' },
  { type: 'zebra',    emoji: '🦓' },
  { type: 'elephant', emoji: '🐘' },
];

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY STATE
// ─────────────────────────────────────────────────────────────────────────────
let currentRun = {
  id: null,
  startTime: null,
  endTime: null,
  status: 'idle',               // idle | running | stopped
  startPosition: null,
  currentPosition: null,
  trajectory: [],
  detections: [],
  totalDistance: 0,
  currentSpeed: 0,
  laps: [],
};

let lapHistory = [];            // persisted across stop/start
let simulatorTimer = null;
let simulatorWaypointIndex = 0;
let simulatorProgress = 0;      // 0..1 between current and next waypoint
let lapStartTime = null;
let lapTrajectory = [];
let lapDetections = [];
let lapDistance = 0;
let lapNumber = 0;
let lapAnimalPool = [];         // random animal positions for this lap

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // metres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function generateLapAnimalPool() {
  // 3-5 random animals at random waypoints for this lap
  const count = 3 + Math.floor(Math.random() * 3);
  const pool = [];
  const usedIndices = new Set();
  for (let i = 0; i < count; i++) {
    let idx;
    do { idx = 5 + Math.floor(Math.random() * (TRACK_WAYPOINTS.length - 10)); }
    while (usedIndices.has(idx));
    usedIndices.add(idx);
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    pool.push({ waypointIndex: idx, animal, confidence: 70 + Math.random() * 30 });
  }
  return pool;
}

function interpolate(p1, p2, t) {
  return {
    lat: p1.lat + (p2.lat - p1.lat) * t,
    lon: p1.lon + (p2.lon - p1.lon) * t,
  };
}

function computeHeading(p1, p2) {
  const dLon = p2.lon - p1.lon;
  const dLat = p2.lat - p1.lat;
  return (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAP HANDLING
// ─────────────────────────────────────────────────────────────────────────────
function startNewLap() {
  lapNumber++;
  lapStartTime = Date.now();
  lapTrajectory = [];
  lapDetections = [];
  lapDistance = 0;
  lapAnimalPool = generateLapAnimalPool();
  console.log(`🏁 Lap ${lapNumber} started. Animals: ${lapAnimalPool.map(a => a.animal.type).join(', ')}`);
}

function completeLap() {
  const duration = Date.now() - lapStartTime;
  const avgSpeed = lapDistance / (duration / 1000);
  const lapData = {
    lapNumber,
    duration,
    durationFormatted: formatDuration(duration),
    distance: Math.round(lapDistance * 10) / 10,
    avgSpeed: Math.round(avgSpeed * 100) / 100,
    detections: [...lapDetections],
    trajectory: [...lapTrajectory],
    completedAt: new Date().toISOString(),
  };
  currentRun.laps.push(lapData);
  lapHistory.push(lapData);

  io.emit('lap_completed', lapData);
  console.log(`🏁 Lap ${lapNumber} complete! Duration: ${lapData.durationFormatted}, Distance: ${lapData.distance}m`);
  return lapData;
}

// ─────────────────────────────────────────────────────────────────────────────
// GPS PROCESSING  (called by HTTP endpoint AND simulator)
// ─────────────────────────────────────────────────────────────────────────────
function processGPS(lat, lon, timestamp, speed = 0, heading = 0, aqi = 0, ir_left = true, ir_right = true) {
  if (currentRun.status !== 'running') return;

  const pos = { lat, lon, timestamp };
  const prev = currentRun.currentPosition;

  if (prev) {
    const dist = haversine(prev.lat, prev.lon, lat, lon);
    currentRun.totalDistance += dist;
    lapDistance += dist;
  }

  currentRun.currentPosition = pos;
  currentRun.currentSpeed = speed;
  currentRun.trajectory.push({ ...pos, speed, heading });
  lapTrajectory.push(pos);

  const update = {
    lat, lon, timestamp, speed, heading, aqi, ir_left, ir_right,
    totalDistance: Math.round(currentRun.totalDistance * 10) / 10,
    lapDistance: Math.round(lapDistance * 10) / 10,
    lapNumber,
    runTime: Date.now() - currentRun.startTime,
    waypointIndex: simulatorWaypointIndex,
  };
  io.emit('position_update', update);

  // Check animal detection triggers
  const wi = simulatorWaypointIndex;
  lapAnimalPool.forEach((item, idx) => {
    if (!item.triggered && Math.abs(item.waypointIndex - wi) <= 1) {
      item.triggered = true;
      setTimeout(() => processDetection(
        item.animal.type, item.animal.emoji,
        item.confidence, lat, lon, Date.now()
      ), 200);
    }
  });

  // Lap detection: back within 5m of start AND > 50m covered this lap
  if (currentRun.startPosition && lapDistance > 50) {
    const distToStart = haversine(
      lat, lon,
      currentRun.startPosition.lat,
      currentRun.startPosition.lon
    );
    if (distToStart < 5) {
      completeLap();
      startNewLap();
    }
  }
}

function processDetection(animalType, emoji, confidence, lat, lon, timestamp) {
  if (currentRun.status !== 'running') return;

  const detection = {
    id: uuidv4(),
    animalType,
    emoji,
    confidence: Math.round(confidence * 10) / 10,
    lat, lon, timestamp,
    lapNumber,
    timeInLap: Date.now() - lapStartTime,
    waypointIndex: simulatorWaypointIndex,
  };
  currentRun.detections.push(detection);
  lapDetections.push(detection);

  io.emit('animal_detected', detection);
  console.log(`🐾 ${emoji} ${animalType} (${detection.confidence.toFixed(1)}%) at [${lat.toFixed(6)}, ${lon.toFixed(6)}]`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATOR
// ─────────────────────────────────────────────────────────────────────────────
const SIM_SPEED = 0.5;          // m/s
const SIM_TICK_MS = 500;        // update every 500ms → 0.25m per tick

function stopSimulator() {
  if (simulatorTimer) {
    clearInterval(simulatorTimer);
    simulatorTimer = null;
  }
}

function startSimulator() {
  if (simulatorTimer) return;

  simulatorWaypointIndex = 0;
  simulatorProgress = 0;

  // Kick off run if not already running
  if (currentRun.status !== 'running') {
    startRun();
  }

  simulatorTimer = setInterval(() => {
    if (currentRun.status !== 'running') { stopSimulator(); return; }

    const wp = TRACK_WAYPOINTS;
    const cur = simulatorWaypointIndex;
    const next = (cur + 1) % wp.length;

    const segLen = haversine(wp[cur].lat, wp[cur].lon, wp[next].lat, wp[next].lon);
    const stepMetres = SIM_SPEED * (SIM_TICK_MS / 1000);
    simulatorProgress += segLen > 0 ? stepMetres / segLen : 1;

    if (simulatorProgress >= 1) {
      simulatorProgress -= 1;
      simulatorWaypointIndex = next;
    }

    const pos = interpolate(wp[cur], wp[next], simulatorProgress);
    const heading = computeHeading(wp[cur], wp[next]);
    processGPS(pos.lat, pos.lon, Date.now(), SIM_SPEED, heading);
  }, SIM_TICK_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN CONTROL
// ─────────────────────────────────────────────────────────────────────────────
function startRun() {
  const startPos = TRACK_WAYPOINTS[0];
  currentRun = {
    id: uuidv4(),
    startTime: Date.now(),
    endTime: null,
    status: 'running',
    startPosition: { lat: startPos.lat, lon: startPos.lon },
    currentPosition: null,
    trajectory: [],
    detections: [],
    totalDistance: 0,
    currentSpeed: 0,
    laps: [],
  };
  lapNumber = 0;
  startNewLap();
  io.emit('run_status', { status: 'running', startTime: currentRun.startTime });
  console.log('▶️  Run started');
}

function stopRun() {
  stopSimulator();
  currentRun.status = 'stopped';
  currentRun.endTime = Date.now();
  io.emit('run_status', { status: 'stopped', endTime: currentRun.endTime });
  console.log('⏹️  Run stopped');
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP ROUTES
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/gps', (req, res) => {
  const { lat, lon, timestamp, speed = 0, heading = 0, aqi = 0, ir_left = false, ir_right = false } = req.body;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  processGPS(parseFloat(lat), parseFloat(lon), timestamp || Date.now(), parseFloat(speed), parseFloat(heading), parseInt(aqi), ir_left, ir_right);
  res.json({ ok: true });
});

app.post('/api/detection', (req, res) => {
  const { animalType, emoji = '🐾', confidence, lat, lon, timestamp } = req.body;
  if (!animalType || !lat || !lon) return res.status(400).json({ error: 'animalType, lat, lon required' });
  processDetection(animalType, emoji, parseFloat(confidence) || 85, parseFloat(lat), parseFloat(lon), timestamp || Date.now());
  res.json({ ok: true });
});

app.post('/api/control/start', (req, res) => {
  if (currentRun.status === 'running') return res.json({ ok: true, msg: 'already running' });
  startRun();
  res.json({ ok: true });
});

app.post('/api/control/stop', (req, res) => {
  stopRun();
  res.json({ ok: true });
});

app.post('/api/simulator/start', (req, res) => {
  startSimulator();
  res.json({ status: 'simulator started' });
});

app.post('/api/simulator/stop', (req, res) => {
  stopSimulator();
  res.json({ status: 'simulator stopped' });
});

app.get('/api/status', (req, res) => {
  res.json({
    run: {
      ...currentRun,
      lapNumber,
      lapDistance: Math.round(lapDistance * 10) / 10,
      runTime: currentRun.startTime ? Date.now() - currentRun.startTime : 0,
    },
    lapHistory,
    trackWaypoints: TRACK_WAYPOINTS,
    animals: ANIMALS,
  });
});

app.get('/api/track', (req, res) => {
  res.json({ waypoints: TRACK_WAYPOINTS, animals: ANIMALS });
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Send current state immediately on connect
  socket.emit('run_status', {
    status: currentRun.status,
    startTime: currentRun.startTime,
    totalDistance: currentRun.totalDistance,
    laps: currentRun.laps,
    lapNumber,
    trajectory: currentRun.trajectory,
    detections: currentRun.detections,
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║  🦁 Safari Navigation Server          ║
║  Port: ${PORT}                           ║
║  Track waypoints: ${TRACK_WAYPOINTS.length}                  ║
╚═══════════════════════════════════════╝
  `);
});
