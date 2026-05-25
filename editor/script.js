const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const info = document.getElementById('info');

let width, height;
const GRID_SIZE = 10;
const SUBSTEPS = 20;
const SIM_DT = 0.05 / SUBSTEPS;

const stats = new Stats();

stats.showPanel(0);

document.body.appendChild(stats.dom);

stats.dom.style.position = "fixed";
stats.dom.style.left = "auto";
stats.dom.style.right = "10px";
stats.dom.style.bottom = "10px";
stats.dom.style.top = "auto";

function resize() {
  width = canvas.clientWidth || canvas.parentElement.clientWidth;
  height = canvas.clientHeight || canvas.parentElement.clientHeight;
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ===== State =====
const state = {
  nodes: [],          // {x,y,vx,id,electricalNode,electricalIndex,hasError}
  components: [],     // {type,n1,n2,value,id,current,hasError}
  nextId: 1,

  placing: null,      // {type,value,n1,n2}
  draggingNode: null,
  activeTool: null,   // 'R'|'V'|'W' or null
  mode: 'SELECT',   // SELECT | CREATE_NODE | CREATE_RESISTOR | CREATE_VOLTAGE | CREATE_WIRE | DELETE
  selectedObject: null,
  time: 0,

  mouse: { x: 0, y: 0, rawX: 0, rawY: 0 },
  ctrlPressed: false,
  panX: 0,
  panY: 0,
  panning: false,
  lastMouseX: 0,
  lastMouseY: 0,
  scale: 1
};

const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 100;

let currentAnimTime = 0;
let simTime = 0; // tracks real simulation time (seconds)

// ===== Component registry =====
const COMPONENT_TYPES = {
  R: {
    key: 'R',
    label: 'Resistor',
    inputId: 'resistorValue',
    getDefaultValue() { return 1000; },
    stamp(G, I, comp, ctxStamp) {
      const { n1Idx, n2Idx, value } = ctxStamp;
      const g = 1 / value;
      G[n1Idx][n1Idx] += g;
      G[n2Idx][n2Idx] += g;
      G[n1Idx][n2Idx] -= g;
      G[n2Idx][n1Idx] -= g;
    },
    draw(ctx2d, comp) {
      // Midpoint between nodes
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;

      // Vector from n1 to n2
      const dx = comp.n2.x - comp.n1.x;
      const dy = comp.n2.y - comp.n1.y;

      // Angle of the resistor line
      const angle = Math.atan2(dy, dx);

      const rectLength = 24;  // along the line
      const rectHeight = 12;  // thickness

      // Rotate only the rectangle
      ctx2d.save();
      ctx2d.translate(mx, my);
      ctx2d.rotate(angle);

      ctx2d.fillStyle = '#f39c12';
      ctx2d.fillRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);

      ctx2d.restore();

      // Draw text in normal (unrotated) coordinates above the midpoint
      ctx2d.fillStyle = '#eee';
      ctx2d.font = '12px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'bottom';
      ctx2d.fillText(`${comp.value}Ω`, mx, my - 12);
    }
  },
  C: {
    key: 'C',
    label: 'Capacitor',
    inputId: 'capacitorValue',

    getDefaultValue() {
      return 1e-6;
    },

    stamp(A, b, comp, ctx) {
      let { n1Idx, n2Idx } = ctx;

      let G = comp.value / SIM_DT;

      A[n1Idx][n1Idx] += G;
      A[n2Idx][n2Idx] += G;
      A[n1Idx][n2Idx] -= G;
      A[n2Idx][n1Idx] -= G;

      b[n1Idx] += comp.historyCurrent;
      b[n2Idx] -= comp.historyCurrent;
    },

    draw(ctx2d, comp) {
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;

      const dx = comp.n2.x - comp.n1.x;
      const dy = comp.n2.y - comp.n1.y;

      const angle = Math.atan2(dy, dx);

      ctx2d.save();
      ctx2d.translate(mx, my);
      ctx2d.rotate(angle);

      ctx2d.strokeStyle = '#2ecc71';
      ctx2d.lineWidth = 2;

      // capacitor plates
      ctx2d.beginPath();

      ctx2d.moveTo(-6, -10);
      ctx2d.lineTo(-6, 10);

      ctx2d.moveTo(6, -10);
      ctx2d.lineTo(6, 10);

      ctx2d.stroke();

      ctx2d.restore();

      ctx2d.fillStyle = '#eee';
      ctx2d.font = '12px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'bottom';

      ctx2d.fillText(`${comp.value}F`, mx, my - 12);
    }
  },
  V: {
    key: 'V',
    label: 'Voltage',
    inputId: 'voltageValue',
    getDefaultValue() { return 5; },
    stamp(G, I, comp, ctxStamp) {
      const { n1Idx, n2Idx, vSrcBaseIndex, vSrcMap, N } = ctxStamp;
      if (!vSrcMap.has(comp.id)) {
        vSrcMap.set(comp.id, vSrcBaseIndex.value++);
      }
      const k = vSrcMap.get(comp.id);
      const row = N + k;
      G[n1Idx][row] += 1;
      G[n2Idx][row] -= 1;
      G[row][n1Idx] += 1;
      G[row][n2Idx] -= 1;

      const polarity = comp.polarity || 1; // default +1 if not set
      I[row] += comp.value * polarity;
    },
    draw(ctx2d, comp) {
      // Midpoint between nodes
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;

      // Main circle
      const radius = 10;
      ctx2d.fillStyle = '#3498db';
      ctx2d.beginPath();
      ctx2d.arc(mx, my, radius, 0, Math.PI * 2);
      ctx2d.fill();

      // Voltage label (inside or near the circle; optional)
      ctx2d.fillStyle = '#fff';
      ctx2d.font = 'bold 12px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText(`${comp.value}V`, mx, my);

      // Direction vector from n1 to n2
      const dx = comp.n2.x - comp.n1.x;
      const dy = comp.n2.y - comp.n1.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      // Normal vector (perpendicular to line); pick one side
      const nx = -uy;
      const ny = ux;

      // distance from center for symbols
      const radialOffset = radius - 4;   // away from circle
      const alongOffset = 16;           // along line to separate + and -

      const polarity = comp.polarity || 1; // 1: n1 +, n2 -, -1: n1 -, n2 +

      // Base positions on one side of the line (using the normal)
      const baseX = mx + nx * radialOffset;
      const baseY = my + ny * radialOffset;

      // Offset along the line in opposite directions so + and - don't overlap
      const plusXPos = baseX - ux * alongOffset;
      const plusYPos = baseY - uy * alongOffset;
      const minusXPos = baseX + ux * alongOffset;
      const minusYPos = baseY + uy * alongOffset;

      ctx2d.fillStyle = '#fff';
      ctx2d.font = '10px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';

      if (polarity === 1) {
        // n1 is +, n2 is -
        ctx2d.fillText('+', plusXPos, plusYPos);
        ctx2d.fillText('-', minusXPos, minusYPos);
      } else {
        // n1 is -, n2 is +
        ctx2d.fillText('-', plusXPos, plusYPos);
        ctx2d.fillText('+', minusXPos, minusYPos);
      }
    }
  },
  D: {
    key: 'D',
    label: 'Diode',
    inputId: 'diodeValue',

    getDefaultValue() {
      return 0.7; // forward voltage drop
    },

    stamp(G, I, comp, ctxStamp) {
      const { n1Idx, n2Idx } = ctxStamp;

      const v1 = comp.n1.vx || 0;
      const v2 = comp.n2.vx || 0;

      const vd = v1 - v2;

      // ON/OFF approximation
      const on = vd > comp.value;

      comp.isOn = on;

      const resistance = on ? 1 : 1e9;
      const g = 1 / resistance;

      G[n1Idx][n1Idx] += g;
      G[n2Idx][n2Idx] += g;
      G[n1Idx][n2Idx] -= g;
      G[n2Idx][n1Idx] -= g;
    },

    draw(ctx2d, comp) {
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;

      const dx = comp.n2.x - comp.n1.x;
      const dy = comp.n2.y - comp.n1.y;

      const angle = Math.atan2(dy, dx);

      ctx2d.save();
      ctx2d.translate(mx, my);
      ctx2d.rotate(angle);

      ctx2d.strokeStyle = '#ff66aa';
      ctx2d.lineWidth = 2;

      // triangle
      ctx2d.beginPath();
      ctx2d.moveTo(-10, -8);
      ctx2d.lineTo(-10, 8);
      ctx2d.lineTo(4, 0);
      ctx2d.closePath();
      ctx2d.stroke();

      // line
      ctx2d.beginPath();
      ctx2d.moveTo(6, -10);
      ctx2d.lineTo(6, 10);
      ctx2d.stroke();

      ctx2d.restore();
    }
  },
  LED: {
    key: 'LED',
    label: 'LED',
    inputId: 'ledValue',

    getDefaultValue() {
      return 2.0;
    },

    stamp(G, I, comp, ctxStamp) {
      const { n1Idx, n2Idx } = ctxStamp;

      const v1 = comp.n1.vx || 0;
      const v2 = comp.n2.vx || 0;

      const vd = v1 - v2;

      // LED parameters
      const Vf = comp.value || 2.0;
      const softness = 0.03;

      // smooth transition
      const t =
        1 / (1 + Math.exp(-(vd - Vf) / softness));

      // MUCH smaller resistance range
      const offResistance = 1e6;
      const onResistance = 8;

      const resistance =
        offResistance -
        t * (offResistance - onResistance);

      const g = 1 / resistance;

      comp.isOn = t > 0.15;

      G[n1Idx][n1Idx] += g;
      G[n2Idx][n2Idx] += g;
      G[n1Idx][n2Idx] -= g;
      G[n2Idx][n1Idx] -= g;
    },

    draw(ctx2d, comp) {
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;

      const dx = comp.n2.x - comp.n1.x;
      const dy = comp.n2.y - comp.n1.y;

      const angle = Math.atan2(dy, dx);

      ctx2d.save();
      ctx2d.translate(mx, my);
      ctx2d.rotate(angle);

      const glow = 5 + (comp.displayBrightness || 0) * 55;

      if (comp.isOn) {
        ctx2d.shadowColor = comp.ledColor || '#00ff88';
        ctx2d.shadowBlur = glow;
      }

      // white outline
      const brightness =
        0.25 + (comp.displayBrightness || 0) * 0.75;

      ctx2d.globalAlpha = brightness;

      ctx2d.strokeStyle = comp.ledColor || '#00ff88';
      ctx2d.lineWidth = 4;

      // diode shape
      ctx2d.beginPath();
      ctx2d.moveTo(-10, -8);
      ctx2d.lineTo(-10, 8);
      ctx2d.lineTo(4, 0);
      ctx2d.closePath();
      ctx2d.stroke();

      // line
      ctx2d.beginPath();
      ctx2d.moveTo(6, -10);
      ctx2d.lineTo(6, 10);
      ctx2d.stroke();

      // actual LED color
      ctx2d.strokeStyle = comp.ledColor || '#00ff88';
      ctx2d.lineWidth = 2;

      // triangle
      ctx2d.beginPath();
      ctx2d.moveTo(-10, -8);
      ctx2d.lineTo(-10, 8);
      ctx2d.lineTo(4, 0);
      ctx2d.closePath();
      ctx2d.stroke();

      // line
      ctx2d.beginPath();
      ctx2d.moveTo(6, -10);
      ctx2d.lineTo(6, 10);
      ctx2d.stroke();

      // glow arrows
      if (comp.isOn) {
        ctx2d.beginPath();
        ctx2d.moveTo(0, -12);
        ctx2d.lineTo(8, -20);

        ctx2d.moveTo(5, -8);
        ctx2d.lineTo(13, -16);
        ctx2d.stroke();
      }

      ctx2d.restore();
    }
  },
  SW: {
    key: 'SW',
    label: 'Switch',
    inputId: null,

    getDefaultValue() {
      return 0;
    },

    stamp(G, I, comp, ctxStamp) {
      if (!comp.closed) return;

      const { n1Idx, n2Idx } = ctxStamp;

      const g = 1 / 0.05;

      G[n1Idx][n1Idx] += g;
      G[n2Idx][n2Idx] += g;
      G[n1Idx][n2Idx] -= g;
      G[n2Idx][n1Idx] -= g;
    },

    draw(ctx2d, comp) {
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;

      const dx = comp.n2.x - comp.n1.x;
      const dy = comp.n2.y - comp.n1.y;

      const angle = Math.atan2(dy, dx);

      ctx2d.save();
      ctx2d.translate(mx, my);
      ctx2d.rotate(angle);

      ctx2d.strokeStyle = '#ffffff';
      ctx2d.lineWidth = 2;

      ctx2d.beginPath();

      if (comp.closed) {
        ctx2d.moveTo(-10, 0);
        ctx2d.lineTo(10, 0);
      } else {
        ctx2d.moveTo(-10, 0);
        ctx2d.lineTo(4, -8);
      }

      ctx2d.stroke();

      ctx2d.restore();
    }
  },
  ACV: {
    key: 'ACV',
    label: 'AC Voltage',
    inputId: 'acvAmplitude',
    getDefaultValue() { return 5; },

    stamp(G, I, comp, ctxStamp) {
      const { n1Idx, n2Idx, vSrcBaseIndex, vSrcMap, N } = ctxStamp;
      if (!vSrcMap.has(comp.id)) vSrcMap.set(comp.id, vSrcBaseIndex.value++);
      const k = vSrcMap.get(comp.id);
      const row = N + k;
      G[n1Idx][row] += 1; G[n2Idx][row] -= 1;
      G[row][n1Idx] += 1; G[row][n2Idx] -= 1;
      const freq = comp.frequency || 50;
      const amplitude = comp.value || 5;
      const phase = comp.phase || 0;
      I[row] += amplitude * Math.sin(2 * Math.PI * freq * simTime + phase);
    },

    draw(ctx2d, comp) {
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;
      const radius = 12;

      // filled circle (purple-tinted to distinguish from DC)
      ctx2d.fillStyle = '#8e44ad';
      ctx2d.beginPath();
      ctx2d.arc(mx, my, radius, 0, Math.PI * 2);
      ctx2d.fill();

      // sine wave drawn inside the circle via clipping
      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.arc(mx, my, radius - 2, 0, Math.PI * 2);
      ctx2d.clip();
      ctx2d.strokeStyle = '#fff';
      ctx2d.lineWidth = 1.5;
      ctx2d.lineJoin = 'round';
      ctx2d.beginPath();
      const steps = 32;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const sx2 = mx - (radius - 2) + t * (radius - 2) * 2;
        const sy2 = my - Math.sin(t * Math.PI * 2) * (radius * 0.6);
        if (i === 0) ctx2d.moveTo(sx2, sy2); else ctx2d.lineTo(sx2, sy2);
      }
      ctx2d.stroke();
      ctx2d.restore();

      // label above: amplitude + freq
      ctx2d.fillStyle = '#eee';
      ctx2d.font = '10px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'bottom';
      const freq = comp.frequency || 50;
      const freqLabel = freq >= 1000 ? `${(freq / 1000).toFixed(1)}kHz` : `${freq}Hz`;
      ctx2d.fillText(`${comp.value}V ${freqLabel}`, mx, my - radius - 2);

      // ~ symbol along the terminal direction
      const dx = comp.n2.x - comp.n1.x;
      const dy = comp.n2.y - comp.n1.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const nx2 = -uy, ny2 = ux;
      ctx2d.fillStyle = '#dda0ff';
      ctx2d.font = 'bold 10px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText('~', mx + nx2 * 8 - ux * (radius + 5), my + ny2 * 8 - uy * (radius + 5));
      ctx2d.fillText('~', mx + nx2 * 8 + ux * (radius + 5), my + ny2 * 8 + uy * (radius + 5));
    }
  },
  W: {
    key: 'W',
    label: 'Wire',
    inputId: 'wireValue',
    getDefaultValue() { return 0.01; },
    stamp() {
      // wires handled via node union; no MNA stamp
    },
    draw(ctx2d, comp) {
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;

      /* const v1 = comp.n1.vx || 0;
      const v2 = comp.n2.vx || 0;

      const avgV = (v1 + v2) * 0.5;

      let wireColor = "#cfd8dc";
      const maxVisualVoltage = 12;
      const t = Math.max(-1, Math.min(1, avgV / maxVisualVoltage));

      if (t > 0) {
        // positive voltage = blue
        const strength = Math.floor(t * 180);

        wireColor = `rgb(${180 + strength}, ${60}, ${60})`;
      } else if (t < 0) {
        // negative voltage = red
        const strength = Math.floor(-t * 180);

        wireColor = `rgb(${40}, ${40}, ${220 + strength})`;
      }
      ctx2d.fillStyle = wireColor;

      const currentGlow = Math.min(Math.abs(comp.current) * 0.2, 1);
      ctx2d.shadowBlur = 10 * currentGlow;
      ctx2d.shadowColor = wireColor; */

      ctx2d.fillStyle = "#cfd8dc";
      ctx2d.beginPath();
      ctx2d.arc(mx, my, 3, 0, Math.PI * 2);
      ctx2d.fill();
    }
  },
  GND: {
    key: "GND",
    label: "Ground",

    inputId: null,

    getDefaultValue: () => 0,

    stamp() { },

    draw(ctx, comp) {

      const x = comp.n1.x;
      const y = comp.n1.y;

      ctx.strokeStyle = "#00e5ff"; // Bluish color like of negative nodes
      ctx.lineWidth = 2.2;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();

      // stem
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 12);

      // bars
      ctx.moveTo(x - 12, y + 12);
      ctx.lineTo(x + 12, y + 12);

      ctx.moveTo(x - 8, y + 18);
      ctx.lineTo(x + 8, y + 18);

      ctx.moveTo(x - 4, y + 24);
      ctx.lineTo(x + 4, y + 24);

      ctx.stroke();
    }
  },
};

// ===== Notification =====
function showSolveError(message = 'Circuit solving failed') {
  let el = document.getElementById('solveError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'solveError';
    el.style.position = 'fixed';
    el.style.right = '16px';
    el.style.top = '80px';
    el.style.padding = '8px 12px';
    el.style.background = 'rgba(192,57,43,0.9)';
    el.style.color = '#fff';
    el.style.fontFamily = 'system-ui, sans-serif';
    el.style.fontSize = '13px';
    el.style.borderRadius = '4px';
    el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
    el.style.zIndex = '9999';
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s ease';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = '1';
  setTimeout(() => {
    el.style.opacity = '0';
  }, 2000);
}

// ===== Keyboard =====
window.addEventListener('keydown', (e) => {
  // existing Ctrl handling
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
    state.ctrlPressed = true;
  }

  // ignore if typing in an input
  const activeTag = document.activeElement && document.activeElement.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

  switch (e.code) {
    case 'Digit1': // 1 = Select
      setMode('SELECT');
      break;
    case 'Digit2': // 2 = Node
      setMode('CREATE_NODE');
      break;
    case 'Digit3': // 3 = Resistor
      setMode('CREATE_WIRE');
      break;
    case 'Digit4': // 4 = Voltage
      setMode('CREATE_VOLTAGE');
      break;
    case 'Digit5': // 5 = Wire (if you want)
      setMode('CREATE_RESISTOR');
      break;
    case 'Digit6':
      setMode('CREATE_CAPACITOR');
      break;
    case 'Delete': {
      const obj = state.selectedObject;
      if (obj) {
        // if a node is selected
        if (state.nodes.includes(obj)) {
          deleteNode(obj);
          clearSelection();
        } else {
          // assume it's a component
          deleteComponent(obj);
          clearSelection();
        }
      } else {
        // no selection → toggle delete mode
        if (state.mode === 'DELETE') setMode('SELECT');
        else setMode('DELETE');
      }
      break;
    }
    /* case 'Delete':
      // optional: toggle delete mode with Delete key
      if (state.mode === 'DELETE') setMode('SELECT');
      else setMode('DELETE');
      break; */
  }

  // Node Moving
  const activeTag2 = document.activeElement && document.activeElement.tagName;
  if (activeTag2 === 'INPUT' || activeTag2 === 'TEXTAREA') return;

  const obj = state.selectedObject;
  const isNode = obj && state.nodes.includes(obj);
  const step = GRID_SIZE; // or 10, or whatever you like

  switch (e.code) {
    // existing Digit1–5 + Delete cases...

    case 'ArrowLeft':
      if (isNode) {
        obj.x = snapToGrid(obj.x - step);
      }
      break;
    case 'ArrowRight':
      if (isNode) {
        obj.x = snapToGrid(obj.x + step);
      }
      break;
    case 'ArrowUp':
      if (isNode) {
        obj.y = snapToGrid(obj.y - step);
      }
      break;
    case 'ArrowDown':
      if (isNode) {
        obj.y = snapToGrid(obj.y + step);
      }
      break;
  }

  // Undo and Redo
  if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();

    if (e.shiftKey) {
      redo();
    } else {
      undo();
    }
  }

  if (e.ctrlKey && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
    state.ctrlPressed = false;
  }
});

// ===== Utilities =====
function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function distSq(v, w) {
  return (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
}
function distToSegment(p, v, w) {
  const l2 = distSq(v, w);
  if (l2 === 0) return dist(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}
function formatCurrent(amperes) {
  const abs = Math.abs(amperes);
  const sign = amperes < 0 ? '-' : '';
  if (abs < 1e-6) return '0.00 A';
  if (abs < 1e-3) return `${sign}${(abs * 1e6).toFixed(2)} µA`;
  if (abs < 1) return `${sign}${(abs * 1000).toFixed(2)} mA`;
  return `${sign}${abs.toFixed(3)} A`;
}
function snapToGrid(x) {
  return Math.round(x / GRID_SIZE) * GRID_SIZE;
}
function findNodeAt(x, y) {
  const threshold = 12;
  for (const n of state.nodes) {
    if (dist(n, { x, y }) < threshold) return n;
  }
  return null;
}
function findComponentAt(x, y) {
  for (const c of state.components) {
    if (c.type === "GND") {

      const dx = x - c.n1.x;
      const dy = y - (c.n1.y + 12);

      if (Math.sqrt(dx * dx + dy * dy) < 16) {
        return c;
      }
    }
    if (distToSegment({ x, y }, c.n1, c.n2) < 12) return c;
  }
  return null;
}

function addNode(x, y) {
  pushUndoState();
  const n = {
    x: snapToGrid(x),
    y: snapToGrid(y),
    vx: 0,
    id: state.nextId++,
    electricalNode: null,
    electricalIndex: 0,
    hasError: false
  };
  state.nodes.push(n);
  saveCircuitToURL();
  return n;
}
function addComponent(type, n1, n2, value, extra) {
  pushUndoState();
  const comp = {
    type,
    n1,
    n2,
    value,
    id: state.nextId++,
    current: 0,
    displayBrightness: 0,
    hasError: false,
    ledColor: '#00ff88',

    // capacitor state
    capacitorVoltage: 0,
    prevCurrent: 0,
    historyCurrent: 0
  };

  if (type === 'V') {
    comp.polarity = 1;
  }
  if (type === 'ACV') {
    comp.frequency = (extra && extra.frequency) ? extra.frequency : 50;
    comp.phase = 0;
  }
  if (type === 'GND') {
    setGroundNode(n1);
  }

  state.components.push(comp);
  saveCircuitToURL();
}

function createCircuitSnapshot() {
  return JSON.stringify(exportCircuitData());
}

function loadCircuitSnapshot(snapshot) {
  importCircuitData(JSON.parse(snapshot));
}

function pushUndoState() {
  undoStack.push(createCircuitSnapshot());

  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }

  redoStack.length = 0;
}

function undo() {
  if (!undoStack.length) return;

  redoStack.push(createCircuitSnapshot());

  const snapshot = undoStack.pop();

  loadCircuitSnapshot(snapshot);

  clearSelection();
}

function redo() {
  if (!redoStack.length) return;

  undoStack.push(createCircuitSnapshot());

  const snapshot = redoStack.pop();

  loadCircuitSnapshot(snapshot);

  clearSelection();
}

function exportCircuitData() {
  return {
    nodes: state.nodes.map(n => ({
      id: n.id,
      x: n.x,
      y: n.y
    })),

    components: state.components.map(c => ({
      id: c.id,
      type: c.type,

      n1: c.n1.id,
      n2: c.n2.id,

      value: c.value,

      polarity: c.polarity,
      frequency: c.frequency,
      phase: c.phase,

      ledColor: c.ledColor,
      closed: !!c.closed   // use 'closed' consistently (was wrongly 'isClosed')
    })),

    nextId: state.nextId
  };
}
function importCircuitData(data) {
  state.nodes = [];
  state.components = [];

  const nodeMap = new Map();

  for (const n of data.nodes) {
    const node = {
      id: n.id,
      x: n.x,
      y: n.y,
      vx: 0,
      electricalNode: null,
      electricalIndex: 0,
      hasError: false
    };

    nodeMap.set(node.id, node);
    state.nodes.push(node);
  }

  for (const c of data.components) {
    const n1 = nodeMap.get(Number(c.n1));
    const n2 = nodeMap.get(Number(c.n2));

    if (!n1 || !n2) continue;

    state.components.push({
      id: c.id,
      type: c.type,
      n1: n1,
      n2: n2,
      value: c.value ?? 1,
      polarity: c.polarity ?? 1,
      frequency: c.frequency ?? 50,
      phase: c.phase ?? 0,
      ledColor: c.ledColor ?? '#00ff88',
      closed: !!c.closed,
      current: 0,
      displayBrightness: 0,
      capacitorVoltage: 0,
      historyCurrent: 0,
      isOn: false
    });
  }

  state.nextId = data.nextId || 1;

  saveCircuitToURL();
}

function saveCircuitToURL() {

  const nodeIndexMap = new Map();

  state.nodes.forEach((n, i) => {
    nodeIndexMap.set(n.id, i);
  });

  const data = [
    state.nodes.map(n => [
      n.id,       // [0] id — needed so loadCircuitFromURL can rebuild nodeRefs by index
      n.x,        // [1]
      n.y,        // [2]
      n.isGround ? 1 : 0  // [3]
    ]),

    state.components.map(c => [
      c.type,                         // [0]
      c.id,                           // [1] component id
      nodeIndexMap.get(c.n1.id),      // [2] n1 index into nodes array
      nodeIndexMap.get(c.n2.id),      // [3] n2 index into nodes array
      c.value,                        // [4]
      c.polarity || 0,                // [5]
      c.frequency || 0,               // [6]
      c.phase || 0,                   // [7]
      c.ledColor || "",               // [8]
      c.closed ? 1 : 0                // [9]
    ]),

    state.nextId                      // [2] top-level nextId
  ];

  const compressed =
    LZString.compressToEncodedURIComponent(
      JSON.stringify(data)
    );

  history.replaceState(
    null,
    "",
    "?c=" + compressed
  );
}

function loadCircuitFromURL() {

  const params =
    new URLSearchParams(window.location.search);

  const encoded = params.get("c");

  if (!encoded) return;

  try {

    const json =
      LZString.decompressFromEncodedURIComponent(
        encoded
      );

    const data = JSON.parse(json);

    const [savedNodes, savedComponents, savedNextId] = data;

    state.nodes = [];
    state.components = [];

    // nodeRefs[i] = node object, indexed the same as savedNodes[i]
    const nodeRefs = [];

    for (const n of savedNodes) {
      const node = {
        id: n[0],           // restored id
        x: n[1],
        y: n[2],
        vx: 0,
        isGround: !!n[3],
        electricalNode: null,
        electricalIndex: 0,
        hasError: false
      };

      state.nodes.push(node);
      nodeRefs.push(node);
    }

    for (const c of savedComponents) {
      const n1 = nodeRefs[c[2]];   // n1 index is now at [2]
      const n2 = nodeRefs[c[3]];   // n2 index is now at [3]

      if (!n1 || !n2) {
        console.warn('Skipping component with missing node refs:', c);
        continue;
      }

      state.components.push({
        type: c[0],
        id: c[1],           // component id restored
        n1,
        n2,
        value: c[4],
        polarity: c[5] || 1,
        frequency: c[6] || 50,
        phase: c[7] || 0,
        ledColor: c[8] || '#00ff88',
        closed: !!c[9],
        current: 0,
        displayBrightness: 0,
        capacitorVoltage: 0,
        historyCurrent: 0,
        hasError: false
      });
    }

    // Restore nextId so new additions don't collide
    if (savedNextId != null) {
      state.nextId = savedNextId;
    } else {
      // fallback: derive from max existing id
      const allIds = [
        ...state.nodes.map(n => n.id || 0),
        ...state.components.map(c => c.id || 0)
      ];
      state.nextId = (allIds.length ? Math.max(...allIds) : 0) + 1;
    }

  } catch (err) {

    console.error("Failed to load circuit:", err);

  }
}

const SAVE_KEY = 'circuitsim_saves';


function saveCircuitToLocalStorage() {
  const name = prompt('Save name?');

  if (!name) return;

  const saves =
    JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');

  // Reuse exportCircuitData — the same format used for undo/redo
  const raw = JSON.stringify(exportCircuitData());

  const compressed =
    LZString.compressToEncodedURIComponent(raw);

  saves.unshift({
    id: Date.now(),
    name,
    data: compressed,
    createdAt: Date.now()
  });

  localStorage.setItem(
    SAVE_KEY,
    JSON.stringify(saves)
  );

  refreshSaveMenu();
}

function loadCircuitSave(save) {
  const raw =
    LZString.decompressFromEncodedURIComponent(save.data);

  if (!raw) return;

  const data = JSON.parse(raw);

  // importCircuitData handles all node/component reconstruction correctly
  importCircuitData(data);

  clearSelection();
}

function refreshSaveMenu() {
  const saveList =
    document.getElementById('saveList');

  if (!saveList) return;

  const saves =
    JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');

  saveList.innerHTML = '';

  for (const save of saves) {
    const el = document.createElement('div');

    el.className = 'save-entry';

    const date =
      new Date(save.createdAt).toLocaleString();

    el.innerHTML = `
    <div class="save-entry-main">
      <div class="save-entry-title">${save.name}</div>
      <div class="save-entry-date">${date}</div>
    </div>

    <button class="save-delete-btn">×</button>
`;

    const deleteBtn =
      el.querySelector('.save-delete-btn');

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      const saves =
        JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');

      const filtered =
        saves.filter(s => s.id !== save.id);

      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify(filtered)
      );

      refreshSaveMenu();
    });

    el.addEventListener('click', () => {
      loadCircuitSave(save);

      document.getElementById('saveMenu').classList.remove('open');
    });

    saveList.appendChild(el);
  }
}

function drawCurrentFlow(ctx2d, comp) {
  const n1 = comp.n1;
  const n2 = comp.n2;

  const I = comp.current || 0;
  const absI = Math.abs(I);

  // Don't draw if no current flowing
  if (absI < 1e-9) return;

  const speed = Math.min(120, 15 + absI * 200); // px/s, scales with current magnitude
  const direction = I >= 0 ? 1 : -1;

  // Dash style varies by component type
  let dashLength, gapLength, lineWidth, color, alpha;
  if (comp.type === 'W') {
    dashLength = 8;
    gapLength = 5;
    lineWidth = 2.5;
    color = '255,255,255';
    alpha = 0.9;
  } else if (comp.type === 'R') {
    dashLength = 6;
    gapLength = 6;
    lineWidth = 2;
    color = '243, 156, 18';
    alpha = 0.75;
  } else if (comp.type === 'V') {
    dashLength = 10;
    gapLength = 4;
    lineWidth = 2;
    color = '52, 152, 219';
    alpha = 0.75;
  } else if (comp.type === 'ACV') {
    dashLength = 6;
    gapLength = 4;
    lineWidth = 2;
    color = '186, 85, 211';
    alpha = 0.85;
  } else if (comp.type === 'C') {
    dashLength = 7;
    gapLength = 5;
    lineWidth = 2;
    color = '46, 204, 113';
    alpha = 0.8;
  } else {
    dashLength = 7;
    gapLength = 5;
    lineWidth = 2;
    color = '0, 229, 255';
    alpha = 0.7;
  }

  // color = '255, 255, 255';

  const t = currentAnimTime * 0.001;
  const offset = (t * speed * direction) % (dashLength + gapLength);

  ctx2d.save();
  ctx2d.shadowColor = `rgba(${color}, ${alpha * 2})`;
  ctx2d.shadowBlur = 20;
  ctx2d.strokeStyle = `rgba(${'255, 255, 255'}, ${alpha})`;
  ctx2d.lineWidth = lineWidth / state.scale;
  ctx2d.setLineDash([dashLength, gapLength]);
  ctx2d.lineDashOffset = -offset;
  ctx2d.lineCap = 'round';

  ctx2d.beginPath();
  ctx2d.moveTo(n1.x, n1.y);
  ctx2d.lineTo(n2.x, n2.y);
  ctx2d.stroke();

  ctx2d.restore();
}

// Delete helpers
function getConnectionsForNode(node) {
  let count = 0;
  for (const c of state.components) {
    if (c.n1 === node || c.n2 === node) count++;
  }
  return count;
}
function deleteComponent(comp) {
  pushUndoState();
  state.components = state.components.filter(c => c !== comp);
  if (state.selectedObject === comp) {
    state.selectedObject = null;
    updatePropertiesBox();
  }
  saveCircuitToURL();
}
function deleteNode(node) {
  pushUndoState();
  const connectedCount = getConnectionsForNode(node);
  if (connectedCount > 3) {
    const ok = confirm(
      `This node has ${connectedCount} components connected. Delete it and all its connections?`
    );
    if (!ok) return;
  }
  state.components = state.components.filter(c => c.n1 !== node && c.n2 !== node);
  state.nodes = state.nodes.filter(n => n !== node);
  if (state.selectedObject === node) {
    state.selectedObject = null;
    updatePropertiesBox();
  }
  saveCircuitToURL();
}

// ===== Electrical grouping =====
function findElectricalRoot(node, parentMap, nodesList) {
  if (node.electricalNode === null || node.electricalNode === node.id) {
    return node.id;
  }
  const parentNode = nodesList.find(n => n.id === node.electricalNode);
  if (!parentNode) return node.id;
  const root = findElectricalRoot(parentNode, parentMap, nodesList);
  node.electricalNode = root;
  return root;
}
function unionElectricalNodes(n1, n2, parentMap, nodesList) {
  const root1 = findElectricalRoot(n1, parentMap, nodesList);
  const root2 = findElectricalRoot(n2, parentMap, nodesList);
  if (root1 !== root2) {
    for (const n of nodesList) {
      if (findElectricalRoot(n, parentMap, nodesList) === root2) {
        n.electricalNode = root1;
      }
    }
  }
}

function getConnectedNodes(startNode) {
  const visited = new Set();
  const stack = [startNode];

  while (stack.length) {
    const node = stack.pop();

    if (visited.has(node)) continue;
    visited.add(node);

    for (const c of state.components) {
      if (c.n1 === node && !visited.has(c.n2)) {
        stack.push(c.n2);
      }

      if (c.n2 === node && !visited.has(c.n1)) {
        stack.push(c.n1);
      }
    }
  }

  return Array.from(visited);
}

function validateGrounds() {
  for (const node of state.nodes) {
    if (!node.isGround) continue;

    const connected = getConnectedNodes(node);

    const grounds = connected.filter(n => n.isGround);

    const uniqueVoltages = [...new Set(
      grounds.map(g => g.groundVoltage || 0)
    )];

    if (uniqueVoltages.length > 1) {
      alert("Ground conflict detected in connected circuit!");
      return false;
    }
  }

  return true;
}

function setGroundNode(node) {
  pushUndoState();
  const connectedNodes = getConnectedNodes(node);

  // grounds only in THIS connected group
  const groupGrounds = state.components.filter(c =>
    c.type === 'GND' &&
    connectedNodes.includes(c.n1)
  );

  // toggle OFF if already grounded
  const existing = groupGrounds.find(c => c.n1 === node);

  if (existing) {
    state.components = state.components.filter(c => c !== existing);
    saveCircuitToURL();
    return;
  }

  // check conflicting grounds
  for (const gnd of groupGrounds) {
    const otherNode = gnd.n1;

    if (
      otherNode.vx != null &&
      node.vx != null &&
      Math.abs(otherNode.vx - node.vx) > 0.001
    ) {
      showSolveError(
        'Conflicting grounds detected in same circuit group'
      );
      return;
    }
  }

  // add ground component
  state.components.push({
    id: state.nextId++,
    type: 'GND',
    n1: node,
    n2: node
  });

  saveCircuitToURL();
}

// DSU for independent circuits
function getCircuitGroups() {
  if (state.nodes.length === 0) return [];

  const parent = {};
  for (const n of state.nodes) parent[n.id] = n.id;

  function find(id) {
    if (parent[id] === id) return id;
    return parent[id] = find(parent[id]);
  }
  function union(id1, id2) {
    const r1 = find(id1);
    const r2 = find(id2);
    if (r1 !== r2) parent[r2] = r1;
  }

  for (const c of state.components) {
    union(c.n1.id, c.n2.id);
  }

  const groupsMap = new Map();
  for (const n of state.nodes) {
    const rep = find(n.id);
    if (!groupsMap.has(rep)) {
      groupsMap.set(rep, { nodes: [], components: [] });
    }
    groupsMap.get(rep).nodes.push(n);
  }

  for (const c of state.components) {
    const rep = find(c.n1.id);
    if (groupsMap.has(rep)) groupsMap.get(rep).components.push(c);
  }
  return Array.from(groupsMap.values());
}

// Wire currents via tree-based DFS
function calculateWireCurrents(groupNodes, groupComponents) {
  for (const c of groupComponents) {
    if (c.type === 'W') c.current = 0;
  }

  const wireAdjacency = new Map();
  for (const n of groupNodes) wireAdjacency.set(n.id, []);
  for (const c of groupComponents) {
    if (c.type === 'W') {
      wireAdjacency.get(c.n1.id).push({ wire: c, to: c.n2 });
      wireAdjacency.get(c.n2.id).push({ wire: c, to: c.n1 });
    }
  }

  const I_ext = {};
  for (const n of groupNodes) {
    let current = 0;
    for (const c of groupComponents) {
      if (c.type === 'R') {
        if (c.n1 === n) current -= (c.n1.vx - c.n2.vx) / c.value;
        if (c.n2 === n) current -= (c.n2.vx - c.n1.vx) / c.value;
      } else if (c.type === 'V') {
        if (c.n1 === n) current += (c.current || 0);
        if (c.n2 === n) current -= (c.current || 0);
      }
    }
    I_ext[n.id] = current;
  }

  const visited = new Set();
  for (const n of groupNodes) {
    if (visited.has(n.id)) continue;

    const componentNodes = [];
    const queue = [n];
    visited.add(n.id);
    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      componentNodes.push(curr);
      const neighbors = wireAdjacency.get(curr.id) || [];
      for (const edge of neighbors) {
        if (!visited.has(edge.to.id)) {
          visited.add(edge.to.id);
          queue.push(edge.to);
        }
      }
    }

    const dfsVisited = new Set();
    function dfs(u) {
      dfsVisited.add(u.id);
      let sumChildCurrents = 0;
      const neighbors = wireAdjacency.get(u.id) || [];

      for (const edge of neighbors) {
        const v = edge.to;
        if (!dfsVisited.has(v.id)) {
          const childCurrent = dfs(v);
          if (u === edge.wire.n1) edge.wire.current = childCurrent;
          else edge.wire.current = -childCurrent;
          sumChildCurrents += childCurrent;
        }
      }
      return sumChildCurrents - I_ext[u.id];
    }

    dfs(componentNodes[0]);
  }
}

// MNA solver per circuit group
function solveCircuit() {
  if (state.nodes.length === 0) return;

  const groups = getCircuitGroups();
  let hasError = false;

  for (const group of groups) {
    const groupNodes = group.nodes;
    const groupComponents = group.components;
    if (groupNodes.length === 0) continue;

    if (groupComponents.length === 0) {
      for (const n of groupNodes) {
        n.vx = 0;
        n.hasError = false;
      }
      continue;
    }

    const parentMap = {};
    for (const n of groupNodes) {
      n.electricalNode = n.id;
      parentMap[n.id] = n.id;
    }

    for (const c of groupComponents) {
      if (c.type === 'W') {
        unionElectricalNodes(c.n1, c.n2, parentMap, groupNodes);
      }
    }

    const electricalNodes = [];
    const nodeToElectricalIndex = new Map();
    for (const n of groupNodes) {
      const root = findElectricalRoot(n, parentMap, groupNodes);
      if (!nodeToElectricalIndex.has(root)) {
        const idx = electricalNodes.length;
        nodeToElectricalIndex.set(root, idx);
        electricalNodes.push(groupNodes.find(nd => nd.id === root));
      }
      n.electricalIndex = nodeToElectricalIndex.get(root);
    }

    const N = electricalNodes.length;
    const numV = groupComponents.filter(c => c.type === 'V' || c.type === 'ACV').length;
    const size = N + numV;

    const G = Array.from({ length: size }, () => Array(size).fill(0));
    const I = Array(size).fill(0);

    const vSrcMap = new Map();
    const vSrcBaseIndex = { value: 0 };

    for (const c of groupComponents) {
      const def = COMPONENT_TYPES[c.type];
      if (!def || typeof def.stamp !== 'function') continue;
      const n1Idx = c.n1.electricalIndex;
      const n2Idx = c.n2.electricalIndex;
      const ctxStamp = {
        n1Idx,
        n2Idx,
        value: c.value,
        N,
        vSrcMap,
        vSrcBaseIndex
      };
      def.stamp(G, I, c, ctxStamp);
    }

    if (N > 0) {
      const grounds = groupComponents.filter(c => c.type === "GND");
      if (grounds.length > 0) {
        for (const gnd of grounds) {
          const idx = gnd.n1.electricalIndex;

          G[idx].fill(0);
          G[idx][idx] = 1;
          I[idx] = 0;
        }
      } else {
        // fallback if no ground exists
        G[0].fill(0);

        G[0][0] = 1;

        I[0] = 0;
      }
    }

    const v = gaussSolve(G, I);
    if (!v) {
      hasError = true;
      for (const nd of groupNodes) {
        nd.vx = 0;
        nd.hasError = true;
      }
      for (const c of groupComponents) {
        c.current = 0;
        c.hasError = true;
      }
    } else {
      for (const nd of groupNodes) {
        nd.hasError = false;
        nd.vx = v[nd.electricalIndex];
      }
      for (const c of groupComponents) {
        c.hasError = false;
        if (c.type === 'V' || c.type === 'ACV') {
          const k = vSrcMap.get(c.id);
          c.current = v[N + k];
        } else if (
          c.type === 'R' ||
          c.type === 'D' ||
          c.type === 'LED' ||
          c.type === 'SW'
        ) {
          let resistance = c.value;

          if (c.type === 'D') {
            resistance = c.isOn ? 1 : 1e9;
          }

          if (c.type === 'LED') {
            resistance = c.isOn ? 8 : 1e6;
          }

          if (c.type === 'SW') {
            resistance = c.closed ? 0.001 : 1e9;
          }

          c.current = (c.n1.vx - c.n2.vx) / resistance;

          if (c.type === 'LED') {
            const targetBrightness =
              c.isOn ? Math.min(1, Math.abs(c.current) * 20) : 0;

            // smooth averaging
            c.displayBrightness += (targetBrightness - c.displayBrightness) * 0.15;
          }
        }
        else if (c.type === 'C') {
          const voltageNow = c.n1.vx - c.n2.vx;

          c.current = c.value * ((voltageNow - c.capacitorVoltage) / SIM_DT);

          // save voltage for next timestep
          c.capacitorVoltage += (voltageNow - c.capacitorVoltage) * 0.15;

          c.historyCurrent = (c.value / SIM_DT) * c.capacitorVoltage;
        }
      }
      calculateWireCurrents(groupNodes, groupComponents);
    }
  }

  if (hasError) {
    showSolveError('Some circuit components could not be solved');
  }
}

// ===== Properties / selection =====
let selectedObject = null;

function clearSelection() {
  state.selectedObject = null;
  updatePropertiesBox();
}

function updatePropertiesBox() {
  const box = document.getElementById('propertiesBox');
  const content = document.getElementById('propertiesContent');
  if (!box || !content) return;

  const obj = state.selectedObject;
  if (!obj) {
    box.style.display = 'none';
    content.innerHTML = '';
    return;
  }

  box.style.display = 'block';

  const isNode = state.nodes.includes(obj);
  if (isNode) {
    const n = obj;

    const isGround = state.components.some(c => c.type === 'GND' && c.n1 === n);

    content.innerHTML = `
    <div class="properties-field">
      <label>Node Type</label>
      <div style="
        font-weight:bold;
        color:${isGround ? '#4af' : '#fff'};
      ">
        ${isGround ? 'Ground Node (0V reference)' : 'Normal Node'}
      </div>
    </div>

    <div class="properties-field">
      <label>Voltage</label>
      <div style="font-weight:bold;font-family:monospace;" id="propVoltText">
        ${n.vx?.toFixed(2) ?? '-'} V
      </div>
    </div>

    <div class="properties-field">
      <label>X Position</label>
      <input type="number" id="propX" value="${n.x}" step="10" />
    </div>

    <div class="properties-field">
      <label>Y Position</label>
      <input type="number" id="propY" value="${n.y}" step="10" />
    </div>

    <div class="properties-field">
      <button class="tool-btn" id="propSetGround">
        ${isGround ? 'Unset Ground' : 'Set As Ground'}
      </button>
    </div>

    <button class="delete-btn" id="propDelete">
      Delete Node
    </button>
  `;

    document.getElementById('propX').addEventListener('input', (e) => {
      pushUndoState();
      const v = snapToGrid(parseFloat(e.target.value));
      if (!isNaN(v)) n.x = v;
      saveCircuitToURL();
    });

    document.getElementById('propY').addEventListener('input', (e) => {
      pushUndoState();
      const v = snapToGrid(parseFloat(e.target.value));
      if (!isNaN(v)) n.y = v;
      saveCircuitToURL();
    });

    document.getElementById('propSetGround').addEventListener('click', () => {
      pushUndoState();
      if (!state.groundNode) {
        setGroundNode(n);
      }

      updatePropertiesBox();
      saveCircuitToURL();
    });

    document.getElementById('propDelete').addEventListener('click', () => {
      pushUndoState();
      state.components = state.components.filter(c =>
        !(c.type === 'GND' && c.n1 === n)
      );

      deleteNode(n);
      clearSelection();
      saveCircuitToURL();
    });
  } else {
    const c = obj;
    const def = COMPONENT_TYPES[c.type];
    const label = c.type === 'W' ? 'Wire' : (def ? def.label : 'Component');

    let valueLabel = 'Value';
    if (c.type === 'R') valueLabel = 'Resistance (Ω)';
    else if (c.type === 'V') valueLabel = 'Voltage (V)';
    else if (c.type === 'W') valueLabel = 'Wire Resistance (Ω)';
    else if (c.type === 'C') valueLabel = 'Capacitance (F)';
    else if (c.type === 'D') valueLabel = 'Forward Voltage (V)';
    else if (c.type === 'LED') valueLabel = 'Forward Voltage (V)';
    else if (c.type === 'S') valueLabel = 'Resistance (Ω)';
    else if (c.type === 'ACV') valueLabel = 'Amplitude (V)';

    const v1 = c.n1.vx?.toFixed(2) ?? '-';
    const v2 = c.n2.vx?.toFixed(2) ?? '-';
    const diff = (c.n1.vx - c.n2.vx)?.toFixed(2) ?? '-';

    const isVoltage = c.type === 'V';
    const canFlip =
      c.type === 'D' ||
      c.type === 'LED' ||
      c.type === 'V' ||
      c.type === 'ACV';
    const polarity = c.polarity || 1;
    const polarityText = polarity === 1 ? 'N1 is +,<br>N2 is -' : 'N1 is -,<br>N2 is +';

    content.innerHTML = `
    <div class="properties-field">
      <label>Type</label>
      <div style="font-weight:bold;">${label} (ID: ${c.id})</div>
    </div>
    ${c.type !== 'SW' ? `<div class="properties-field">
      <label>${valueLabel}</label>
      <input type="number" id="propValue" value="${c.value}" step="any" min="0.0001" />
    </div>` : ''}
    ${c.type === 'LED' ? `
      <div class="properties-field">
        <label>LED Color</label>
        <input type="color" id="propLedColor" value="${c.ledColor || '#00ff88'}" />
      </div>
    ` : ''}
    ${isVoltage ? `
      <div class="properties-field">
        <label>Polarity</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="font-family:monospace;" id="propPolarityText">${polarityText}</span>
          <button type="button" class="tool-btn" id="propPolarityToggle">Reverse polarity</button>
        </div>
      </div>
    ` : ''}
    ${c.type === 'ACV' ? `
      <div class="properties-field">
        <label>Frequency (Hz)</label>
        <input type="number" id="propFrequency" value="${c.frequency || 50}" step="any" min="0.001" />
      </div>
      <div class="properties-field">
        <label>Phase Offset (°)</label>
        <input type="number" id="propPhase" value="${((c.phase || 0) * 180 / Math.PI).toFixed(1)}" step="any" />
      </div>
      <div class="properties-field">
        <label>Instantaneous V</label>
        <div style="font-family:monospace;" id="propInstV">—</div>
      </div>
    ` : ''}
    <div class="properties-field">
      <label>Node Voltages</label>
      <div style="font-family:monospace;" id="propVoltText">
        V1: ${v1}V | V2: ${v2}V<br>
        (ΔV: ${diff}V)
      </div>
    </div>
    ${canFlip ? `
    <div class="properties-field">
      <label>Direction</label>
      <button type="button" class="tool-btn" id="propFlipBtn">Flip Component</button>
    </div>
` : ''}
    <div class="properties-field">
      <label>Measured Current</label>
      <div style="font-weight:bold;font-family:monospace;" id="propCurrText">
        ${formatCurrent(c.current || 0)}
      </div>
    </div>
    <button class="delete-btn" id="propDelete">Delete Component</button>
  `;
    document.getElementById('propValue')?.addEventListener('input', (e) => {
      pushUndoState();
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > 0) c.value = v;
      saveCircuitToURL();
    });

    if (c.type === 'ACV') {
      document.getElementById('propFrequency')?.addEventListener('input', (e) => {
        pushUndoState();
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v > 0) c.frequency = v;
        saveCircuitToURL();
      });
      document.getElementById('propPhase')?.addEventListener('input', (e) => {
        pushUndoState();
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) c.phase = v * Math.PI / 180;
        saveCircuitToURL();
      });
    }

    if (isVoltage) {
      const toggleBtn = document.getElementById('propPolarityToggle');
      const polTextEl = document.getElementById('propPolarityText');
      if (toggleBtn && polTextEl) {
        toggleBtn.addEventListener('click', () => {
          pushUndoState();
          c.polarity = (c.polarity || 1) * -1;
          const pTxt = c.polarity === 1 ? 'N1 is +, N2 is -' : 'N1 is -, N2 is +';
          polTextEl.textContent = pTxt;
          saveCircuitToURL();
        });
      }
    }

    if (canFlip) {
      const flipBtn = document.getElementById('propFlipBtn');
      if (flipBtn) {
        flipBtn.addEventListener('click', () => {
          // swap nodes
          const temp = c.n1;
          c.n1 = c.n2;
          c.n2 = temp;

          // keep voltage polarity synced too
          if (c.type === 'V') {
            c.polarity = (c.polarity || 1) * -1;
          }

          saveCircuitToURL();
          updatePropertiesBox();
        });
      }
    }

    const ledColorEl = document.getElementById('propLedColor');

    if (ledColorEl) {
      ledColorEl.addEventListener('input', (e) => {
        pushUndoState();
        c.ledColor = e.target.value;
        saveCircuitToURL();
      });
    }

    document.getElementById('propDelete').addEventListener('click', () => {
      pushUndoState();
      deleteComponent(c);
      clearSelection();
    });
  }
}

function updateSelectedPropertiesDynamics() {
  const obj = state.selectedObject;
  if (!obj) return;
  const isNode = state.nodes.includes(obj);
  if (isNode) {
    const el = document.getElementById('propVoltText');
    if (el) el.textContent = `${obj.vx?.toFixed(2) ?? '-'} V`;
  } else {
    const c = obj;
    const v1 = c.n1.vx?.toFixed(2) ?? '-';
    const v2 = c.n2.vx?.toFixed(2) ?? '-';
    const diff = (c.n1.vx - c.n2.vx)?.toFixed(2) ?? '-';
    const elVolt = document.getElementById('propVoltText');
    if (elVolt) elVolt.textContent = `V1: ${v1}V | V2: ${v2}V (ΔV: ${diff}V)`;
    const elCurr = document.getElementById('propCurrText');
    if (elCurr) elCurr.textContent = formatCurrent(c.current || 0);
    if (c.type === 'ACV') {
      const elInstV = document.getElementById('propInstV');
      if (elInstV) {
        const freq = c.frequency || 50;
        const inst = (c.value || 0) * Math.sin(2 * Math.PI * freq * simTime + (c.phase || 0));
        elInstV.textContent = `${inst.toFixed(3)} V`;
      }
    }
  }
}

// ===== Gaussian solver =====
function gaussSolve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let c = col; c <= n; c++) {
        M[row][c] -= factor * M[col][c];
      }
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
    x[i] = sum / M[i][i];
  }
  return x;
}

// ===== Rendering =====
function voltageColor(v) {
  const eps = 1e-3; // treat tiny values as 0

  if (Math.abs(v) < eps) {
    // neutral / ~0 V → light gray
    return 'rgb(200, 200, 200)';
  }
  if (v < 0) {
    // negative → blue
    return 'rgb(0, 0, 255)';
  }
  // positive → red
  return 'rgb(255, 0, 0)';
}

function wireVoltageColor(v) {
  const maxV = 50;
  const t = Math.max(-1, Math.min(1, v / maxV));

  let r = 180;
  let g = 180;
  let b = 180;

  let colorP = [5, 0, 0];
  let colorN = [0, 0, 5];

  if (t > 0) {
    r += 75 * t * colorP[0];
    g += 75 * t * colorP[1];
    b += 75 * t * colorP[2];

  } else {
    r += 75 * (-t) * colorN[0];
    g += 75 * (-t) * colorN[1];
    b += 75 * (-t) * colorN[2];
  }
  let normCol = normalize(r, g, b);
  r = normCol[0] * 255;
  g = normCol[1] * 255;
  b = normCol[2] * 255;

  return [r, g, b];
}

function normalize(r, g, b) {
  const max = Math.hypot(r, g, b);
  return [r / max, g / max, b / max];
}

let prevTime = Date.now();

function draw() {
  stats.begin();
  const now = Date.now();
  const deltaTime = now - prevTime;
  currentAnimTime += deltaTime;
  prevTime = now;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(state.panX, state.panY);
  ctx.scale(state.scale, state.scale);

  // Hover / group highlight
  let hoveredComp = null;
  let hoveredNode = null;
  let hoveredGroup = null;

  if (state.ctrlPressed) {
    for (const c of state.components) {
      if (distToSegment({ x: state.mouse.x, y: state.mouse.y }, c.n1, c.n2) < 10) {
        hoveredComp = c;
        break;
      }
    }
    if (!hoveredComp) hoveredNode = findNodeAt(state.mouse.x, state.mouse.y);
    if (hoveredComp || hoveredNode) {
      const groups = getCircuitGroups();
      for (const g of groups) {
        if (hoveredComp && g.components.includes(hoveredComp)) {
          hoveredGroup = g; break;
        }
        if (hoveredNode && g.nodes.includes(hoveredNode)) {
          hoveredGroup = g; break;
        }
      }
    }
  }

  // Grid
  // Grid
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1 / state.scale; // keep grid lines thin when zoomed

  ctx.beginPath();

  // visible world bounds
  const worldLeft = -state.panX / state.scale;
  const worldTop = -state.panY / state.scale;
  const worldRight = (width - state.panX) / state.scale;
  const worldBottom = (height - state.panY) / state.scale;

  // align grid lines to GRID_SIZE
  const startX = Math.floor(worldLeft / GRID_SIZE) * GRID_SIZE;
  const endX = Math.ceil(worldRight / GRID_SIZE) * GRID_SIZE;
  const startY = Math.floor(worldTop / GRID_SIZE) * GRID_SIZE;
  const endY = Math.ceil(worldBottom / GRID_SIZE) * GRID_SIZE;

  for (let x = startX; x <= endX; x += GRID_SIZE) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y <= endY; y += GRID_SIZE) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();

  // Group highlight
  if (hoveredGroup) {
    const hoverPulse = 0.22 + 0.05 * Math.sin(currentAnimTime * 0.003);
    ctx.save();
    ctx.strokeStyle = `rgba(52,152,219,${hoverPulse})`;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const c of hoveredGroup.components) {
      ctx.moveTo(c.n1.x, c.n1.y);
      ctx.lineTo(c.n2.x, c.n2.y);
    }
    ctx.stroke();
    ctx.fillStyle = `rgba(52,152,219,${hoverPulse * 0.65})`;
    for (const n of hoveredGroup.nodes) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Component lines
  for (const c of state.components) {
    let wireColor = "#888";

    const grad = ctx.createLinearGradient(
      c.n1.x,
      c.n1.y,
      c.n2.x,
      c.n2.y
    );

    let col1 = wireVoltageColor(c.n1.vx);
    let col2 = wireVoltageColor(c.n2.vx);
    let avgCol = [
      (col1[0] + col2[0]) / 2,
      (col1[1] + col2[1]) / 2,
      (col1[2] + col2[2]) / 2
    ];

    grad.addColorStop(0, `rgb(${col1[0]}, ${col1[1]}, ${col1[2]})`);
    grad.addColorStop(1, `rgb(${col2[0]}, ${col2[1]}, ${col2[2]})`);

    const currentGlow = Math.min(Math.abs(c.current) * 0.2, 1);

    ctx.shadowBlur = 5;
    // ctx.shadowColor = `rgb(${avgCol[0]}, ${avgCol[1]}, ${avgCol[2]})`;
    const avgV =
      ((c.n1.vx || 0) +
        (c.n2.vx || 0)) * 0.5;

    let avgVCol = wireVoltageColor(avgV);
    ctx.shadowColor = `rgba(${avgVCol[0]}, ${avgVCol[1]}, ${avgVCol[2]}, ${currentGlow * 10})`;

    ctx.strokeStyle = c.hasError ? '#e74c3c' : grad;
    ctx.lineWidth = c.hasError ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(c.n1.x, c.n1.y);
    ctx.lineTo(c.n2.x, c.n2.y);
    ctx.stroke();
  }

  // Current flow animation — drawn on top of base lines when Ctrl is held
  if (state.ctrlPressed) {
    for (const c of state.components) {
      drawCurrentFlow(ctx, c);
    }
  }

  // Nodes
  for (const n of state.nodes) {
    const color = n.hasError ? '#e74c3c' : (n.vx !== undefined ? voltageColor(n.vx) : '#fff');
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = n.hasError ? '#e74c3c' : '#eee';
    ctx.font = '12px monospace';
    ctx.fillText(`V=${n.vx?.toFixed(2) ?? '-'}V`, n.x + 10, n.y - 10);
  }

  // Component symbols + error halo
  for (const c of state.components) {
    const def = COMPONENT_TYPES[c.type];
    if (def && typeof def.draw === 'function') def.draw(ctx, c);
    if (c.hasError) {
      const mx = (c.n1.x + c.n2.x) / 2;
      const my = (c.n1.y + c.n2.y) / 2;
      ctx.save();
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(mx, my, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Selection halo (pulsing, shape-aware)
  if (state.selectedObject) {
    const selPulse = 0.78 + 0.18 * Math.sin(currentAnimTime * 0.003);
    const selBlur = 8 + 6 * (Math.sin(currentAnimTime * 0.003) * 0.5 + 0.5);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse})`;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = selBlur;
    ctx.lineWidth = 1.5;
    const obj = state.selectedObject;
    const isNode = state.nodes.includes(obj);
    if (isNode) {
      // Circle outline around node
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    } else if (obj.type === 'W') {
      // Outlined wire line
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.35})`;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(obj.n1.x, obj.n1.y);
      ctx.lineTo(obj.n2.x, obj.n2.y);
      ctx.stroke();
      // Inner bright line
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse})`;
      ctx.shadowBlur = selBlur;
      ctx.beginPath();
      ctx.moveTo(obj.n1.x, obj.n1.y);
      ctx.lineTo(obj.n2.x, obj.n2.y);
      ctx.stroke();
    } else if (obj.type === 'R') {
      // Outlined rect matching resistor shape
      const mx = (obj.n1.x + obj.n2.x) / 2;
      const my = (obj.n1.y + obj.n2.y) / 2;
      const dx = obj.n2.x - obj.n1.x;
      const dy = obj.n2.y - obj.n1.y;
      const angle = Math.atan2(dy, dx);
      const rectLength = 24 + 6;
      const rectHeight = 12 + 6;
      // Outer soft glow rect
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.45})`;
      ctx.shadowBlur = 0;
      ctx.strokeRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);
      // Inner crisp rect
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse})`;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = selBlur;
      ctx.strokeRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);
      ctx.restore();
      // Line segments from nodes to rect
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.8})`;
      ctx.shadowBlur = 0;
      const ux = Math.cos(angle), uy = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(obj.n1.x, obj.n1.y);
      ctx.lineTo(mx - ux * rectLength / 2, my - uy * rectLength / 2);
      ctx.moveTo(obj.n2.x, obj.n2.y);
      ctx.lineTo(mx + ux * rectLength / 2, my + uy * rectLength / 2);
      ctx.stroke();
    } else if (obj.type === 'V' || obj.type === 'ACV') {
      // Circle outline around voltage source / AC source center
      const mx = (obj.n1.x + obj.n2.x) / 2;
      const my = (obj.n1.y + obj.n2.y) / 2;
      // Outer glow ring
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.4})`;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(mx, my, 16, 0, Math.PI * 2);
      ctx.stroke();
      // Inner crisp ring
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse})`;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = selBlur;
      ctx.beginPath();
      ctx.arc(mx, my, 16, 0, Math.PI * 2);
      ctx.stroke();
      // Line segments from nodes to circle edge
      const dx = obj.n2.x - obj.n1.x;
      const dy = obj.n2.y - obj.n1.y;
      const angle = Math.atan2(dy, dx);
      const ux = Math.cos(angle), uy = Math.sin(angle);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.8})`;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(obj.n1.x, obj.n1.y);
      ctx.lineTo(mx - ux * 16, my - uy * 16);
      ctx.moveTo(obj.n2.x, obj.n2.y);
      ctx.lineTo(mx + ux * 16, my + uy * 16);
      ctx.stroke();
    } else if (obj.type === 'C') {
      // Outlined rect matching resistor shape
      const mx = (obj.n1.x + obj.n2.x) / 2;
      const my = (obj.n1.y + obj.n2.y) / 2;
      const dx = obj.n2.x - obj.n1.x;
      const dy = obj.n2.y - obj.n1.y;
      const angle = Math.atan2(dy, dx);
      const rectLength = 24 + 6;
      const rectHeight = 12 + 6;
      // Outer soft glow rect
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(46, 204, 113, ${selPulse * 0.45})`;
      ctx.shadowBlur = 0;
      ctx.strokeRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);
      // Inner crisp rect
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(46, 204, 113, ${selPulse})`;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = selBlur;
      ctx.strokeRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);
      ctx.restore();
      // Line segments from nodes to rect
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(46, 204, 113, ${selPulse * 0.8})`;
      ctx.shadowBlur = 0;
      const ux = Math.cos(angle), uy = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(obj.n1.x, obj.n1.y);
      ctx.lineTo(mx - ux * rectLength / 2, my - uy * rectLength / 2);
      ctx.moveTo(obj.n2.x, obj.n2.y);
      ctx.lineTo(mx + ux * rectLength / 2, my + uy * rectLength / 2);
      ctx.stroke();
    } else if (obj.type === 'GND') {
      const x = obj.n1.x;
      const y = obj.n1.y + 12;
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(0,229,255,${0.35 * selPulse})`;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(0,229,255,${selPulse})`;
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = selBlur;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  updateSelectedPropertiesDynamics();

  // Ctrl hover halo — shape-aware outline on hovered component/node
  if (state.ctrlPressed) {
    const hPulse = 0.55 + 0.2 * Math.sin(currentAnimTime * 0.003);
    const hBlur = 3 + 3 * (Math.sin(currentAnimTime * 0.003) * 0.5 + 0.5);
    if (hoveredNode) {
      ctx.save();
      ctx.strokeStyle = `rgba(52, 152, 219, ${hPulse})`;
      ctx.shadowColor = 'rgba(52,152,219,0.6)';
      ctx.shadowBlur = hBlur;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hoveredNode.x, hoveredNode.y, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (hoveredComp) {
      const c = hoveredComp;
      ctx.save();
      ctx.strokeStyle = `rgba(52, 152, 219, ${hPulse})`;
      ctx.shadowColor = 'rgba(52,152,219,0.6)';
      ctx.shadowBlur = hBlur;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (c.type === 'W') {
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(52, 152, 219, ${hPulse * 0.3})`;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(c.n1.x, c.n1.y);
        ctx.lineTo(c.n2.x, c.n2.y);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(52, 152, 219, ${hPulse})`;
        ctx.shadowBlur = hBlur;
        ctx.beginPath();
        ctx.moveTo(c.n1.x, c.n1.y);
        ctx.lineTo(c.n2.x, c.n2.y);
        ctx.stroke();
      } else if (c.type === 'R') {
        const mx = (c.n1.x + c.n2.x) / 2;
        const my = (c.n1.y + c.n2.y) / 2;
        const dx = c.n2.x - c.n1.x;
        const dy = c.n2.y - c.n1.y;
        const angle = Math.atan2(dy, dx);
        const rl = 30, rh = 18;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(angle);
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(52, 152, 219, ${hPulse * 0.2})`;
        ctx.shadowBlur = 0;
        ctx.strokeRect(-rl / 2, -rh / 2, rl, rh);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(52, 152, 219, ${hPulse})`;
        ctx.shadowColor = 'rgba(52,152,219,0.6)';
        ctx.shadowBlur = hBlur;
        ctx.strokeRect(-rl / 2, -rh / 2, rl, rh);
        ctx.restore();
        const ux = Math.cos(angle), uy = Math.sin(angle);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(52, 152, 219, ${hPulse * 0.5})`;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(c.n1.x, c.n1.y);
        ctx.lineTo(mx - ux * rl / 2, my - uy * rl / 2);
        ctx.moveTo(c.n2.x, c.n2.y);
        ctx.lineTo(mx + ux * rl / 2, my + uy * rl / 2);
        ctx.stroke();
      } else if (c.type === 'V' || c.type === 'ACV' || c.type === 'LED' || c.type === 'D' || c.type === 'SW') {
        const mx = (c.n1.x + c.n2.x) / 2;
        const my = (c.n1.y + c.n2.y) / 2;
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(52, 152, 219, ${hPulse * 0.2})`;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(mx, my, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(52, 152, 219, ${hPulse})`;
        ctx.shadowColor = 'rgba(52,152,219,0.6)';
        ctx.shadowBlur = hBlur;
        ctx.beginPath();
        ctx.arc(mx, my, 16, 0, Math.PI * 2);
        ctx.stroke();
        const dx = c.n2.x - c.n1.x;
        const dy = c.n2.y - c.n1.y;
        const angle = Math.atan2(dy, dx);
        const ux = Math.cos(angle), uy = Math.sin(angle);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(52, 152, 219, ${hPulse * 0.5})`;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(c.n1.x, c.n1.y);
        ctx.lineTo(mx - ux * 16, my - uy * 16);
        ctx.moveTo(c.n2.x, c.n2.y);
        ctx.lineTo(mx + ux * 16, my + uy * 16);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Placement preview
  if (state.activeTool && state.placing && state.placing.n1) {
    ctx.strokeStyle = '#666';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(state.placing.n1.x, state.placing.n1.y);
    ctx.lineTo(state.mouse.x, state.mouse.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Tooltip
  const tooltipEl = document.getElementById('tooltipBox');
  if (tooltipEl) {
    if (state.ctrlPressed && (hoveredComp || hoveredNode)) {
      tooltipEl.style.display = 'flex';
      tooltipEl.style.left = `${state.mouse.rawX + 15}px`;
      tooltipEl.style.top = `${state.mouse.rawY + 15}px`;
      if (hoveredComp) {
        const c = hoveredComp;
        const def = COMPONENT_TYPES[c.type];
        const label = c.type === 'W' ? 'Wire' : (def ? def.label : 'Component');

        let settingsHtml = '';
        let resHtml = '';
        if (c.type === 'R') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Setting:</span><span class="tooltip-val">${c.value} Ω</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Resistance:</span><span class="tooltip-val">${c.value} Ω</span></div>`;
        } else if (c.type === 'V') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Setting:</span><span class="tooltip-val">${c.value} V</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Resistance:</span><span class="tooltip-val">0 Ω (Ideal)</span></div>`;
        } else if (c.type === 'W') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Setting:</span><span class="tooltip-val">${c.value} Ω</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Resistance:</span><span class="tooltip-val">${c.value} Ω</span></div>`;
        } else if (c.type === 'C') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Setting:</span><span class="tooltip-val">${c.value} F</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-val">Capacitor</span></div>`;
        } else if (c.type === 'D') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Setting:</span><span class="tooltip-val">${c.value} V</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-val">Diode</span></div>`;
        } else if (c.type === 'LED') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Setting:</span><span class="tooltip-val">${c.value} V</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-val">LED</span></div>`;
        } else if (c.type === 'S') {
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-val">Switch</span></div>`;
        }

        const v1 = c.n1.vx != null ? `${c.n1.vx.toFixed(2)} V` : '-';
        const v2 = c.n2.vx != null ? `${c.n2.vx.toFixed(2)} V` : '-';
        const diff = (c.n1.vx != null && c.n2.vx != null)
          ? `${(c.n1.vx - c.n2.vx).toFixed(2)} V` : '-';
        const current = formatCurrent(c.current || 0);

        tooltipEl.innerHTML = `
          <div class="tooltip-title">${label} (ID: ${c.id})</div>
          ${settingsHtml}
          <div class="tooltip-row"><span class="tooltip-label">Terminal 1:</span><span class="tooltip-val">${v1}</span></div>
          <div class="tooltip-row"><span class="tooltip-label">Terminal 2:</span><span class="tooltip-val">${v2}</span></div>
          <div class="tooltip-row"><span class="tooltip-label">Voltage Drop:</span><span class="tooltip-val">${diff}</span></div>
          ${resHtml}
          <div class="tooltip-row"><span class="tooltip-label">Current:</span><span class="tooltip-val" style="color:#2ecc71;">${current}</span></div>
        `;
      } else if (hoveredNode) {
        const n = hoveredNode;
        const v = n.vx != null ? `${n.vx.toFixed(2)} V` : '-';
        const list = [];
        for (const c of state.components) {
          if (c.n1 === n) list.push(`${c.type}${c.id} (leaves: ${formatCurrent(c.current || 0)})`);
          else if (c.n2 === n) list.push(`${c.type}${c.id} (enters: ${formatCurrent(c.current || 0)})`);
        }
        const connectedText = list.length ? list.join('<br>') : 'None';
        tooltipEl.innerHTML = `
          <div class="tooltip-title">Node (ID: ${n.id})</div>
          <div class="tooltip-row"><span class="tooltip-label">Voltage:</span><span class="tooltip-val" style="color:#3498db;">${v}</span></div>
          <div class="tooltip-row"><span class="tooltip-label">Coordinates:</span><span class="tooltip-val">(${n.x}, ${n.y})</span></div>
          <div style="border-top:1px solid #444;margin-top:6px;padding-top:4px;">
            <div class="tooltip-label" style="margin-bottom:2px;">Connected Branches:</div>
            <div style="font-size:11px;line-height:1.3;color:#bbb;">${connectedText}</div>
          </div>
        `;
      }
    } else {
      tooltipEl.style.display = 'none';
    }
  }

  const modeText = state.mode === 'SELECT' ? 'Select' :
    state.mode === 'DELETE' ? 'Delete' :
      state.mode === 'CREATE_NODE' ? 'Node' :
        state.mode === 'CREATE_RESISTOR' ? 'Resistor' :
          state.mode === 'CREATE_VOLTAGE' ? 'Voltage' :
            state.mode === 'CREATE_WIRE' ? 'Wire' :
              (state.activeTool || 'Select');
  let infoText = `Nodes: ${state.nodes.length} | Components: ${state.components.length} | Mode: ${modeText}`;
  if (state.ctrlPressed && hoveredComp) {
    const label = hoveredComp.type === 'W'
      ? 'Wire'
      : COMPONENT_TYPES[hoveredComp.type].label;
    infoText += ` | Current: ${label} = ${formatCurrent(hoveredComp.current || 0)}`;
  }
  info.textContent = infoText;

  stats.end();
  ctx.restore();
  requestAnimationFrame(draw);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ===== Interaction =====
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  // right button panning uses screen space
  if (e.button === 2) {
    state.panning = true;
    state.lastMouseX = sx;
    state.lastMouseY = sy;
    return;
  }

  // convert to world space for everything else
  const { x, y } = screenToWorld(sx, sy);
  const gx = snapToGrid(x);
  const gy = snapToGrid(y);

  // use gx, gy for findNodeAt / addNode / placement
  if (state.mode === 'SELECT') {
    const n = findNodeAt(gx, gy);
    if (n) {
      pushUndoState();
      state.selectedObject = n;
      state.draggingNode = n;
      updatePropertiesBox();
      return;
    }
    const c = findComponentAt(gx, gy);
    if (c) {
      if (c.type === 'SW') {
        c.closed = !c.closed;
        saveCircuitToURL();
      }

      state.selectedObject = c;
      updatePropertiesBox();
      return;
    }
    clearSelection();
    return;
  }

  if (state.mode === 'CREATE_NODE') {
    addNode(gx, gy);
    return;
  }

  if (state.mode === "CREATE_GROUND") {
    const node = findNodeAt(gx, gy);
    if (!node) return;
    addComponent("GND", node, node, 0);
    return;
  }

  if (state.mode === 'CREATE_RESISTOR' ||
    state.mode === 'CREATE_VOLTAGE' ||
    state.mode === 'CREATE_ACV' ||
    state.mode === 'CREATE_WIRE' ||
    state.mode === 'CREATE_CAPACITOR' ||
    state.mode === 'CREATE_DIODE' ||
    state.mode === 'CREATE_LED' ||
    state.mode === 'CREATE_SWITCH') {

    const n = findNodeAt(gx, gy);
    if (!n) return;

    const toolMap = {
      CREATE_RESISTOR: 'R',
      CREATE_VOLTAGE: 'V',
      CREATE_ACV: 'ACV',
      CREATE_WIRE: 'W',
      CREATE_CAPACITOR: 'C',
      CREATE_DIODE: 'D',
      CREATE_LED: 'LED',
      CREATE_SWITCH: 'SW',
      CREATE_GROUND: "GND"
    };
    const toolType = toolMap[state.mode];
    const value = getCurrentToolValue(toolType);

    if (!state.placing || !state.placing.n1) {
      const extra = {};
      if (toolType === 'ACV') {
        const freqEl = document.getElementById('acvFrequency');
        extra.frequency = freqEl ? (parseFloat(freqEl.value) || 50) : 50;
      }
      state.placing = { type: toolType, value, n1: n, n2: null, extra };
    } else {
      state.placing.n2 = n;
      addComponent(state.placing.type, state.placing.n1, state.placing.n2, state.placing.value, state.placing.extra);
      state.placing = null;
    }
    return;
  }
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (state.panning) {
    state.panX += sx - state.lastMouseX;
    state.panY += sy - state.lastMouseY;
    state.lastMouseX = sx;
    state.lastMouseY = sy;
    return;
  }

  state.mouse.rawX = sx;
  state.mouse.rawY = sy;

  const world = screenToWorld(sx, sy);
  state.mouse.x = snapToGrid(world.x);
  state.mouse.y = snapToGrid(world.y);

  if (state.ctrlPressed) {
    document.getElementById("mouseCoords").innerText = `X: ${world.x.toFixed(2)} · Y: ${world.y.toFixed(2)}`
  } else {
    document.getElementById("mouseCoords").innerText = `X: ${state.mouse.x} · Y: ${state.mouse.y}`
  }

  if (state.draggingNode) {
    state.draggingNode.x = state.mouse.x;
    state.draggingNode.y = state.mouse.y;
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  // world position before zoom (to zoom around cursor)
  const worldBefore = screenToWorld(sx, sy);

  const zoomFactor = 1.1;  // ~10% per notch
  if (e.deltaY < 0) {
    // zoom in
    state.scale *= zoomFactor;
  } else {
    // zoom out
    state.scale /= zoomFactor;
  }

  // clamp scale
  state.scale = Math.max(0.2, Math.min(5, state.scale));

  // adjust pan so the point under cursor stays under cursor
  const worldAfter = worldBefore;
  const screenAfter = {
    x: worldAfter.x * state.scale + state.panX,
    y: worldAfter.y * state.scale + state.panY
  };

  state.panX += sx - screenAfter.x;
  state.panY += sy - screenAfter.y;
});

canvas.addEventListener('mouseup', () => {
  if (state.draggingNode) {
    saveCircuitToURL();
  }
  state.draggingNode = null;
});

window.addEventListener('mouseup', () => {
  state.panning = false;
});

document.getElementById('newCircuitBtn').addEventListener('click', () => {
  pushUndoState();
  state.nodes = [];
  state.components = [];
  state.selectedObject = null;

  hoveredNode = null;
  hoveredComponent = null;

  updatePropertiesBox();
  // updateInfo();
  saveCircuitToURL();

  // renderSaveList();
});

const hamburgerBtn = document.getElementById('hamburgerBtn');
const saveMenu = document.getElementById('saveMenu');

hamburgerBtn.addEventListener('click', () => {
  saveMenu.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  const insideMenu =
    saveMenu.contains(e.target);

  const clickedHamburger =
    hamburgerBtn.contains(e.target);

  if (!insideMenu && !clickedHamburger) {
    saveMenu.classList.remove('open');
  }
});

document.getElementById('saveCircuitBtn').addEventListener('click', () => {
  saveCircuitToLocalStorage();
});

refreshSaveMenu();

// ===== Tool UI helpers =====
const selectBtn = document.getElementById('selectBtn');
const addNodeBtn = document.getElementById('addNodeBtn');

function hideAllToolInputs() {
  for (const key in COMPONENT_TYPES) {
    const id = COMPONENT_TYPES[key].inputId;
    if (!id) continue;
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  // hide ACV extra field (not in COMPONENT_TYPES.inputId)
  const freqEl = document.getElementById('acvFrequency');
  if (freqEl) freqEl.style.display = 'none';
}
function resetToolButtons() {
  document.querySelectorAll('.tool-btn').forEach(b => {
    if (b.id !== 'deleteModeBtn') {
      b.classList.remove('active');
      b.style.background = '';
    }
  });
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - state.panX) / state.scale,
    y: (sy - state.panY) / state.scale
  };
}

function worldToScreen(wx, wy) {
  return {
    x: wx * state.scale + state.panX,
    y: wy * state.scale + state.panY
  };
}

function setMode(mode) {
  state.mode = mode;
  state.activeTool = null;
  state.placing = null;
  clearSelection();

  hideAllToolInputs();
  resetToolButtons();

  const deleteBtn = document.getElementById('deleteModeBtn');
  if (deleteBtn) {
    if (mode === 'DELETE') {
      deleteBtn.style.background = '#c0392b';
      deleteBtn.classList.add('active');
    } else {
      deleteBtn.style.background = '';
      deleteBtn.classList.remove('active');
    }
  }

  if (mode === 'SELECT') {
    if (selectBtn) selectBtn.classList.add('active');
    return;
  }

  const idMap = {
    CREATE_RESISTOR: 'addResistor',
    CREATE_VOLTAGE: 'addVoltage',
    CREATE_ACV: 'addACV',
    CREATE_WIRE: 'addWire',
    CREATE_NODE: 'addNodeBtn',
    CREATE_CAPACITOR: 'addCapacitor',
    CREATE_DIODE: 'addDiode',
    CREATE_LED: 'addLED',
    CREATE_SWITCH: 'addSwitch',
    CREATE_GROUND: "addGround"
  };
  const toolMap = {
    CREATE_RESISTOR: 'R',
    CREATE_VOLTAGE: 'V',
    CREATE_ACV: 'ACV',
    CREATE_WIRE: 'W',
    CREATE_CAPACITOR: 'C',
    CREATE_DIODE: 'D',
    CREATE_LED: 'LED',
    CREATE_SWITCH: 'SW',
    CREATE_GROUND: "GND"
  };

  state.activeTool = toolMap[mode] || null;

  const btnId = idMap[mode];
  if (btnId) {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
  }

  if (state.activeTool) {
    const def = COMPONENT_TYPES[state.activeTool];
    if (def && def.inputId) {
      const el = document.getElementById(def.inputId);
      if (el) el.style.display = 'inline-block';
    }
    if (state.activeTool === 'ACV') {
      const freqEl = document.getElementById('acvFrequency');
      if (freqEl) freqEl.style.display = 'inline-block';
    }
  }
}

// Tool value helper
function getCurrentToolValue(toolType) {
  const def = COMPONENT_TYPES[toolType];
  if (!def) return 1;
  const inputEl = def.inputId ? document.getElementById(def.inputId) : null;
  if (!inputEl) return def.getDefaultValue();
  const v = parseFloat(inputEl.value);
  if (isNaN(v) || v <= 0) return def.getDefaultValue();
  return v;
}

function setupToolButton(id, toolMode) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (state.mode === toolMode) {
      setMode('SELECT');           // toggle off → Select
    } else {
      setMode(toolMode);
    }
  });
  btn.classList.add('tool-btn');
}

// Select button
if (selectBtn) {
  selectBtn.addEventListener('click', () => {
    setMode('SELECT');
  });
}

if (addNodeBtn) {
  addNodeBtn.addEventListener('click', () => {
    setMode('CREATE_NODE');
  });
}

// Delete mode button
const deleteBtn = document.getElementById('deleteModeBtn');
if (deleteBtn) {
  deleteBtn.addEventListener('click', () => {
    if (state.mode === 'DELETE') {
      setMode('SELECT');
    } else {
      setMode('DELETE');
    }
  });
}

// Clear button
/* document.getElementById('clearBtn').addEventListener('click', () => {
  state.nodes = [];
  state.components = [];
  state.nextId = 1;
  state.placing = null;
  state.draggingNode = null;
  state.activeTool = null;
  state.ctrlPressed = false;
  clearSelection();
  hideAllToolInputs();
  resetToolButtons();
  setMode('SELECT');
}); */

// Tool setup
setupToolButton('addResistor', 'CREATE_RESISTOR');
setupToolButton('addVoltage', 'CREATE_VOLTAGE');
setupToolButton('addACV', 'CREATE_ACV');
setupToolButton('addWire', 'CREATE_WIRE');
setupToolButton('addCapacitor', 'CREATE_CAPACITOR');
setupToolButton('addDiode', 'CREATE_DIODE');
setupToolButton('addLED', 'CREATE_LED');
setupToolButton('addSwitch', 'CREATE_SWITCH');
setupToolButton('addGround', 'CREATE_GROUND');

// Simulation loop
function simLoop() {
  for (let i = 0; i < SUBSTEPS; i++) {
    simTime += SIM_DT;
    solveCircuit();
  }

  requestAnimationFrame(simLoop);
}

// Start
loadCircuitFromURL();
simLoop();
draw();