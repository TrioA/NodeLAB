import {
  circuitState,
  runtimeState,
  formatCurrent
} from './utils.js';

// ===== Oscilloscope State =====
export const plotState = {
  isOpen: false,
  isPaused: false,
  isMinimized: false,
  timebase: 0.1, // total visible window in seconds (e.g. 100ms)
  autoScale: true,
  manualScaleMax: 10,
  manualScaleMin: -10,

  ch1: {
    sourceType: 'comp', // 'comp' | 'node'
    sourceId: null,
    signalType: 'V', // 'V' | 'I' | 'P'
    color: '#00ff88',
    glow: 'rgba(0, 255, 136, 0.4)',
    data: [] // [{ t, v }]
  },

  ch2: {
    sourceType: null,
    sourceId: null,
    signalType: 'V',
    color: '#ffb703',
    glow: 'rgba(255, 183, 3, 0.4)',
    data: []
  },

  maxBufferSeconds: 10.0,
  hoverCrosshair: null
};

let plotCanvas = null;
let plotCtx = null;
let animFrameId = null;

// ===== Oscilloscope Window Controls & Dragging =====
export function initPlotter() {
  const panel = document.getElementById('plotterPanel');
  const header = document.getElementById('plotterHeader');
  const closeBtn = document.getElementById('plotterCloseBtn');
  const minBtn = document.getElementById('plotterMinimizeBtn');
  const pauseBtn = document.getElementById('plotterPauseBtn');
  const clearBtn = document.getElementById('plotterClearBtn');
  const openPlotBtn = document.getElementById('openPlotBtn');

  plotCanvas = document.getElementById('plotterCanvas');
  if (plotCanvas) {
    plotCtx = plotCanvas.getContext('2d');
  }

  // Open/Close
  if (openPlotBtn) {
    openPlotBtn.addEventListener('click', () => {
      togglePlotter();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closePlotter();
    });
  }

  if (minBtn) {
    minBtn.addEventListener('click', () => {
      plotState.isMinimized = !plotState.isMinimized;
      const body = document.getElementById('plotterBody');
      if (body) {
        body.style.display = plotState.isMinimized ? 'none' : 'flex';
      }
      minBtn.innerHTML = plotState.isMinimized ? '<i data-lucide="maximize-2"></i>' : '<i data-lucide="minus"></i>';
      if (window.lucide) window.lucide.createIcons();
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      plotState.isPaused = !plotState.isPaused;
      const badge = document.getElementById('plotterStatusBadge');
      if (badge) {
        badge.textContent = plotState.isPaused ? 'PAUSED' : 'ACTIVE';
        badge.className = plotState.isPaused ? 'plotter-badge paused' : 'plotter-badge';
      }
      pauseBtn.innerHTML = plotState.isPaused ? '<i data-lucide="play"></i>' : '<i data-lucide="pause"></i>';
      if (window.lucide) window.lucide.createIcons();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      plotState.ch1.data = [];
      plotState.ch2.data = [];
    });
  }

  // Probes & Controls Listeners
  const ch1Src = document.getElementById('plotterCh1Source');
  const ch1Sig = document.getElementById('plotterCh1Signal');
  const ch2Src = document.getElementById('plotterCh2Source');
  const ch2Sig = document.getElementById('plotterCh2Signal');
  const tbSelect = document.getElementById('plotterTimebase');
  const autoScaleChk = document.getElementById('plotterAutoScale');

  if (ch1Src) {
    ch1Src.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) {
        plotState.ch1.sourceType = null;
        plotState.ch1.sourceId = null;
      } else {
        const [type, id] = val.split(':');
        plotState.ch1.sourceType = type;
        plotState.ch1.sourceId = parseInt(id, 10);
      }
      plotState.ch1.data = [];
    });
  }

  if (ch1Sig) {
    ch1Sig.addEventListener('change', (e) => {
      plotState.ch1.signalType = e.target.value;
      plotState.ch1.data = [];
    });
  }

  if (ch2Src) {
    ch2Src.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) {
        plotState.ch2.sourceType = null;
        plotState.ch2.sourceId = null;
      } else {
        const [type, id] = val.split(':');
        plotState.ch2.sourceType = type;
        plotState.ch2.sourceId = parseInt(id, 10);
      }
      plotState.ch2.data = [];
    });
  }

  if (ch2Sig) {
    ch2Sig.addEventListener('change', (e) => {
      plotState.ch2.signalType = e.target.value;
      plotState.ch2.data = [];
    });
  }

  if (tbSelect) {
    tbSelect.addEventListener('change', (e) => {
      plotState.timebase = parseFloat(e.target.value) || 0.1;
    });
  }

  if (autoScaleChk) {
    autoScaleChk.addEventListener('change', (e) => {
      plotState.autoScale = e.target.checked;
    });
  }

  // Crosshair mouse tracker
  if (plotCanvas) {
    plotCanvas.addEventListener('mousemove', (e) => {
      const rect = plotCanvas.getBoundingClientRect();
      plotState.hoverCrosshair = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    });

    plotCanvas.addEventListener('mouseleave', () => {
      plotState.hoverCrosshair = null;
    });
  }

  // Window Dragging Support
  if (panel && header) {
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartX = 0;
    let panelStartY = 0;

    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || e.target.closest('select')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = panel.getBoundingClientRect();
      panelStartX = rect.left;
      panelStartY = rect.top;

      panel.style.left = `${panelStartX}px`;
      panel.style.top = `${panelStartY}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';

      document.addEventListener('pointermove', onDragMove);
      document.addEventListener('pointerup', onDragUp);
      e.preventDefault();
    });

    function onDragMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const w = panel.offsetWidth || 560;
      const h = panel.offsetHeight || 380;
      const clampX = Math.max(10, Math.min(window.innerWidth - w - 10, panelStartX + dx));
      const clampY = Math.max(10, Math.min(window.innerHeight - h - 10, panelStartY + dy));
      panel.style.left = `${clampX}px`;
      panel.style.top = `${clampY}px`;
    }

    function onDragUp() {
      isDragging = false;
      document.removeEventListener('pointermove', onDragMove);
      document.removeEventListener('pointerup', onDragUp);
    }
  }

  startPlotLoop();
}

export function openPlotter() {
  const panel = document.getElementById('plotterPanel');
  if (!panel) return;
  plotState.isOpen = true;
  panel.style.display = 'flex';
  populateProbeDropdowns();
  resizePlotCanvas();
}

export function closePlotter() {
  const panel = document.getElementById('plotterPanel');
  if (!panel) return;
  plotState.isOpen = false;
  panel.style.display = 'none';
}

export function togglePlotter() {
  if (plotState.isOpen) closePlotter();
  else openPlotter();
}

export function plotTargetComponent(comp) {
  openPlotter();
  if (!comp) return;
  plotState.ch1.sourceType = 'comp';
  plotState.ch1.sourceId = comp.id;
  plotState.ch1.signalType = (comp.type === 'V' || comp.type === 'ACV' || comp.type === 'BAT' || comp.type === 'VM' || comp.type === 'C') ? 'V' : 'I';
  plotState.ch1.data = [];

  populateProbeDropdowns();

  const ch1Src = document.getElementById('plotterCh1Source');
  const ch1Sig = document.getElementById('plotterCh1Signal');
  if (ch1Src) ch1Src.value = `comp:${comp.id}`;
  if (ch1Sig) ch1Sig.value = plotState.ch1.signalType;
}

export function populateProbeDropdowns() {
  const ch1Src = document.getElementById('plotterCh1Source');
  const ch2Src = document.getElementById('plotterCh2Source');
  if (!ch1Src || !ch2Src) return;

  let compOptions = '<optgroup label="Components">';
  for (const c of circuitState.components) {
    if (c.type === 'GND') continue;
    const name = c.name || `${c.type}${c.id}`;
    compOptions += `<option value="comp:${c.id}">${name} (${c.type})</option>`;
  }
  compOptions += '</optgroup>';

  let nodeOptions = '<optgroup label="Circuit Nodes">';
  for (const n of circuitState.nodes) {
    nodeOptions += `<option value="node:${n.id}">Node #${n.id} (V)</option>`;
  }
  nodeOptions += '</optgroup>';

  ch1Src.innerHTML = '<option value="">Select Probe Target...</option>' + compOptions + nodeOptions;
  ch2Src.innerHTML = '<option value="">None (Disabled)</option>' + compOptions + nodeOptions;

  // Restore or set defaults
  if (plotState.ch1.sourceId) {
    ch1Src.value = `${plotState.ch1.sourceType}:${plotState.ch1.sourceId}`;
  } else if (circuitState.components.length > 0) {
    const firstComp = circuitState.components.find(c => c.type !== 'GND');
    if (firstComp) {
      plotState.ch1.sourceType = 'comp';
      plotState.ch1.sourceId = firstComp.id;
      ch1Src.value = `comp:${firstComp.id}`;
    }
  }

  if (plotState.ch2.sourceId) {
    ch2Src.value = `${plotState.ch2.sourceType}:${plotState.ch2.sourceId}`;
  }
}

// ===== Sample Data Collection =====
export function recordSimulationSample() {
  if (!plotState.isOpen || plotState.isPaused) return;

  const nowTime = runtimeState.simTime;

  function sampleChannel(ch) {
    if (!ch.sourceType || ch.sourceId == null) return;
    let val = 0;

    if (ch.sourceType === 'node') {
      const node = circuitState.nodes.find(n => n.id === ch.sourceId);
      val = node ? (node.vx || 0) : 0;
    } else if (ch.sourceType === 'comp') {
      const comp = circuitState.components.find(c => c.id === ch.sourceId);
      if (!comp) return;

      const vDiff = comp.n1 && comp.n2 ? ((comp.n1.vx || 0) - (comp.n2.vx || 0)) : 0;
      const curr = comp.current || 0;

      if (ch.signalType === 'V') {
        if (comp.type === 'C') val = comp.capacitorVoltage !== undefined ? comp.capacitorVoltage : vDiff;
        else if (comp.type === 'VM') val = comp.measuredVoltage !== undefined ? comp.measuredVoltage : vDiff;
        else val = vDiff;
      } else if (ch.signalType === 'I') {
        val = curr;
      } else if (ch.signalType === 'P') {
        val = Math.abs(vDiff * curr);
      }
    }

    ch.data.push({ t: nowTime, v: Number.isFinite(val) ? val : 0 });

    // Prune old buffer data beyond maxBufferSeconds
    const cutoff = nowTime - plotState.maxBufferSeconds;
    while (ch.data.length > 0 && ch.data[0].t < cutoff) {
      ch.data.shift();
    }
  }

  sampleChannel(plotState.ch1);
  sampleChannel(plotState.ch2);
}

// ===== Plot Rendering Loop =====
function resizePlotCanvas() {
  if (!plotCanvas) return;
  const container = plotCanvas.parentElement;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width || 520;
  const h = rect.height || 220;
  plotCanvas.width = w * dpr;
  plotCanvas.height = h * dpr;
  plotCanvas.style.width = `${w}px`;
  plotCanvas.style.height = `${h}px`;
  if (plotCtx) {
    plotCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function startPlotLoop() {
  function render() {
    if (plotState.isOpen && !plotState.isMinimized) {
      drawPlot();
    }
    animFrameId = requestAnimationFrame(render);
  }
  render();
}

function drawPlot() {
  if (!plotCanvas || !plotCtx) return;
  const container = plotCanvas.parentElement;
  if (!container) return;
  const width = container.clientWidth || 520;
  const height = container.clientHeight || 220;

  plotCtx.clearRect(0, 0, width, height);

  // Background
  plotCtx.fillStyle = '#0a0d12';
  plotCtx.fillRect(0, 0, width, height);

  const padLeft = 46;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 24;
  const graphW = width - padLeft - padRight;
  const graphH = height - padTop - padBottom;

  if (graphW <= 10 || graphH <= 10) return;

  // Time window: [tEnd - timebase, tEnd]
  const tEnd = runtimeState.simTime;
  const tStart = tEnd - plotState.timebase;

  // Filter visible data
  const ch1Data = plotState.ch1.data.filter(d => d.t >= tStart && d.t <= tEnd);
  const ch2Data = plotState.ch2.data.filter(d => d.t >= tStart && d.t <= tEnd);

  // Calculate Value Range (Y-Axis)
  let yMin = -1;
  let yMax = 1;

  if (plotState.autoScale) {
    const allVals = [...ch1Data.map(d => d.v), ...ch2Data.map(d => d.v)];
    if (allVals.length > 0) {
      yMin = Math.min(...allVals);
      yMax = Math.max(...allVals);
      if (Math.abs(yMax - yMin) < 1e-6) {
        yMax += 1.0;
        yMin -= 1.0;
      } else {
        const span = yMax - yMin;
        yMax += span * 0.15;
        yMin -= span * 0.15;
      }
    } else {
      yMin = -5;
      yMax = 5;
    }
  } else {
    yMin = plotState.manualScaleMin;
    yMax = plotState.manualScaleMax;
  }

  // Draw OLED Scope Grid
  plotCtx.save();
  plotCtx.beginPath();
  plotCtx.rect(padLeft, padTop, graphW, graphH);
  plotCtx.clip();

  // Vertical Time Divs (10 divs)
  const numDivsX = 10;
  plotCtx.strokeStyle = 'rgba(30, 41, 59, 0.7)';
  plotCtx.lineWidth = 1;
  plotCtx.beginPath();
  for (let i = 0; i <= numDivsX; i++) {
    const x = padLeft + (graphW / numDivsX) * i;
    plotCtx.moveTo(x, padTop);
    plotCtx.lineTo(x, padTop + graphH);
  }
  // Horizontal Value Divs (8 divs)
  const numDivsY = 8;
  for (let j = 0; j <= numDivsY; j++) {
    const y = padTop + (graphH / numDivsY) * j;
    plotCtx.moveTo(padLeft, y);
    plotCtx.lineTo(padLeft + graphW, y);
  }
  plotCtx.stroke();

  // Zero Center Baseline
  if (yMin <= 0 && yMax >= 0) {
    const zeroY = padTop + graphH * (1 - (0 - yMin) / (yMax - yMin));
    plotCtx.strokeStyle = 'rgba(71, 85, 105, 0.9)';
    plotCtx.setLineDash([4, 4]);
    plotCtx.beginPath();
    plotCtx.moveTo(padLeft, zeroY);
    plotCtx.lineTo(padLeft + graphW, zeroY);
    plotCtx.stroke();
    plotCtx.setLineDash([]);
  }

  // Helper coordinate mapper
  function mapX(t) {
    return padLeft + ((t - tStart) / plotState.timebase) * graphW;
  }
  function mapY(v) {
    const clamped = Math.max(yMin, Math.min(yMax, v));
    return padTop + graphH * (1 - (clamped - yMin) / (yMax - yMin));
  }

  // Draw Channel 2 Trace
  if (ch2Data.length > 1) {
    plotCtx.save();
    plotCtx.strokeStyle = plotState.ch2.color;
    plotCtx.lineWidth = 2.0;
    plotCtx.shadowColor = plotState.ch2.glow;
    plotCtx.shadowBlur = 8;
    plotCtx.beginPath();
    plotCtx.moveTo(mapX(ch2Data[0].t), mapY(ch2Data[0].v));
    for (let i = 1; i < ch2Data.length; i++) {
      plotCtx.lineTo(mapX(ch2Data[i].t), mapY(ch2Data[i].v));
    }
    plotCtx.stroke();
    plotCtx.restore();
  }

  // Draw Channel 1 Trace
  if (ch1Data.length > 1) {
    plotCtx.save();
    plotCtx.strokeStyle = plotState.ch1.color;
    plotCtx.lineWidth = 2.2;
    plotCtx.shadowColor = plotState.ch1.glow;
    plotCtx.shadowBlur = 10;
    plotCtx.beginPath();
    plotCtx.moveTo(mapX(ch1Data[0].t), mapY(ch1Data[0].v));
    for (let i = 1; i < ch1Data.length; i++) {
      plotCtx.lineTo(mapX(ch1Data[i].t), mapY(ch1Data[i].v));
    }
    plotCtx.stroke();
    plotCtx.restore();
  }

  // Interactive Hover Crosshairs
  if (plotState.hoverCrosshair) {
    const hx = Math.max(padLeft, Math.min(padLeft + graphW, plotState.hoverCrosshair.x));
    const hy = Math.max(padTop, Math.min(padTop + graphH, plotState.hoverCrosshair.y));

    plotCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    plotCtx.lineWidth = 1;
    plotCtx.setLineDash([2, 2]);
    plotCtx.beginPath();
    plotCtx.moveTo(hx, padTop); plotCtx.lineTo(hx, padTop + graphH);
    plotCtx.moveTo(padLeft, hy); plotCtx.lineTo(padLeft + graphW, hy);
    plotCtx.stroke();
    plotCtx.setLineDash([]);

    // Compute hovered values
    const hoverT = tStart + ((hx - padLeft) / graphW) * plotState.timebase;
    const hoverVal = yMin + (1 - (hy - padTop) / graphH) * (yMax - yMin);

    plotCtx.fillStyle = '#1e293b';
    plotCtx.strokeStyle = '#00ff88';
    plotCtx.lineWidth = 1;
    const badgeW = 90;
    const badgeH = 22;
    const badgeX = Math.min(width - badgeW - 10, hx + 8);
    const badgeY = Math.max(10, hy - badgeH - 4);

    plotCtx.fillRect(badgeX, badgeY, badgeW, badgeH);
    plotCtx.strokeRect(badgeX, badgeY, badgeW, badgeH);
    plotCtx.fillStyle = '#00ff88';
    plotCtx.font = 'bold 9.5px monospace';
    plotCtx.textAlign = 'left';
    plotCtx.textBaseline = 'middle';
    plotCtx.fillText(`${hoverVal >= 0 ? '+' : ''}${hoverVal.toFixed(2)} | ${(hoverT * 1000).toFixed(0)}ms`, badgeX + 4, badgeY + badgeH / 2);
  }

  plotCtx.restore();

  // Draw Y-Axis Labels
  plotCtx.save();
  plotCtx.font = '9.5px monospace';
  plotCtx.textAlign = 'right';
  plotCtx.textBaseline = 'middle';
  plotCtx.fillStyle = '#94a3b8';

  const numLabelsY = 5;
  for (let k = 0; k < numLabelsY; k++) {
    const val = yMax - (k / (numLabelsY - 1)) * (yMax - yMin);
    const y = padTop + (graphH / (numLabelsY - 1)) * k;
    let label = val.toFixed(2);
    if (Math.abs(val) < 0.01) label = '0.00';
    plotCtx.fillText(label, padLeft - 6, y);
  }

  // Draw X-Axis Time Labels
  plotCtx.textAlign = 'center';
  plotCtx.textBaseline = 'top';
  const numLabelsX = 5;
  for (let m = 0; m < numLabelsX; m++) {
    const tVal = tStart + (m / (numLabelsX - 1)) * plotState.timebase;
    const x = padLeft + (graphW / (numLabelsX - 1)) * m;
    const tMs = (tVal * 1000).toFixed(0);
    plotCtx.fillText(`${tMs}ms`, x, padTop + graphH + 5);
  }
  plotCtx.restore();

  // Compute and Update Telemetry Statistics
  computeStats(ch1Data, ch2Data);
}

function computeStats(ch1Data, ch2Data) {
  function analyze(data) {
    if (!data || data.length < 2) {
      return { vpp: 0, vrms: 0, avg: 0, freq: null };
    }
    const vals = data.map(d => d.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const vpp = max - min;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const rms = Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / vals.length);

    // Estimate Frequency via zero/midpoint crossings
    let freq = null;
    const mid = (max + min) / 2;
    const hyst = vpp * 0.1;
    let lastCrossingT = null;
    const periods = [];
    let state = vals[0] > mid;

    for (let i = 1; i < data.length; i++) {
      const v = data[i].v;
      const t = data[i].t;
      if (!state && v > mid + hyst) {
        state = true;
        if (lastCrossingT !== null) {
          periods.push(t - lastCrossingT);
        }
        lastCrossingT = t;
      } else if (state && v < mid - hyst) {
        state = false;
      }
    }

    if (periods.length >= 1) {
      const avgPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;
      if (avgPeriod > 1e-5) freq = 1 / avgPeriod;
    }

    return { vpp, vrms: rms, avg, freq };
  }

  const s1 = analyze(ch1Data);
  const s2 = analyze(ch2Data);

  const sig1 = plotState.ch1.signalType;
  const sig2 = plotState.ch2.signalType;

  const elVpp1 = document.getElementById('statCh1Vpp');
  const elVrms1 = document.getElementById('statCh1Vrms');
  const elAvg1 = document.getElementById('statCh1Avg');
  const elFreq1 = document.getElementById('statCh1Freq');

  if (elVpp1) elVpp1.textContent = `${s1.vpp.toFixed(2)} ${sig1}`;
  if (elVrms1) elVrms1.textContent = `${s1.vrms.toFixed(2)} ${sig1}`;
  if (elAvg1) elAvg1.textContent = `${s1.avg.toFixed(2)} ${sig1}`;
  if (elFreq1) elFreq1.textContent = s1.freq ? `${s1.freq >= 1000 ? (s1.freq / 1000).toFixed(1) + ' kHz' : s1.freq.toFixed(1) + ' Hz'}` : '-- Hz';

  const elVpp2 = document.getElementById('statCh2Vpp');
  const elVrms2 = document.getElementById('statCh2Vrms');
  const elAvg2 = document.getElementById('statCh2Avg');

  if (elVpp2) elVpp2.textContent = `${s2.vpp.toFixed(2)} ${sig2}`;
  if (elVrms2) elVrms2.textContent = `${s2.vrms.toFixed(2)} ${sig2}`;
  if (elAvg2) elAvg2.textContent = `${s2.avg.toFixed(2)} ${sig2}`;
}
