import {
  circuitState,
  editorState,
  settingsState,
  runtimeState
} from './utils.js';

// ===== Component registry =====
export const COMPONENT_TYPES = {
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
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;
      const dx = comp.n2.x - comp.n1.x;
      const dy = comp.n2.y - comp.n1.y;
      const angle = Math.atan2(dy, dx);
      const totalLen = 34;
      const val = Math.max(0.001, comp.value || 1000);

      let numPeaks, peakAmp, lineWidth;
      if (val <= 100) {
        const ratio = Math.max(0, Math.min(1, Math.log10(val) / 2));
        numPeaks = Math.round(3 + ratio * 2);
        peakAmp = 3.5 + ratio * 4.5;
        lineWidth = 1.5 + ratio * 1.0;
      } else {
        const ratio = Math.max(0, Math.min(1, (Math.log10(val) - 2) / 2));
        numPeaks = Math.round(5 + ratio * 4);
        peakAmp = 8;
        lineWidth = 2.5;
      }

      ctx2d.save();
      ctx2d.translate(mx, my);
      ctx2d.rotate(angle);

      ctx2d.strokeStyle = '#f39c12';
      ctx2d.lineWidth = lineWidth;
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';

      ctx2d.beginPath();
      const halfLen = totalLen / 2;
      ctx2d.moveTo(-halfLen, 0);

      const segmentLen = totalLen / numPeaks;

      for (let i = 0; i < numPeaks; i++) {
        const xStart = -halfLen + i * segmentLen;
        const xMid = xStart + segmentLen * 0.5;
        const xEnd = xStart + segmentLen;
        const dir = (i % 2 === 0) ? -1 : 1;
        ctx2d.lineTo(xMid, dir * peakAmp);
        ctx2d.lineTo(xEnd, 0);
      }

      ctx2d.stroke();
      ctx2d.restore();
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
      let G = comp.value / settingsState.settings.simDT;

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
      ctx2d.lineWidth = 2.5;
      ctx2d.lineCap = 'round';

      // Draw two parallel plates
      ctx2d.beginPath();
      ctx2d.moveTo(-4, -10);
      ctx2d.lineTo(-4, 10);
      ctx2d.stroke();

      ctx2d.beginPath();
      ctx2d.moveTo(4, -10);
      ctx2d.lineTo(4, 10);
      ctx2d.stroke();

      ctx2d.restore();
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

      const polarity = comp.polarity || 1;
      I[row] += comp.value * polarity;
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

      ctx2d.strokeStyle = '#3498db';
      ctx2d.lineWidth = 2;
      ctx2d.lineCap = 'round';

      const polarity = comp.polarity || 1;
      const isNormal = polarity === 1;
      const hLong = 12;
      const hShort = 6;

      ctx2d.beginPath();
      const p1H = isNormal ? hLong : hShort;
      const p2H = isNormal ? hShort : hLong;
      const p3H = isNormal ? hLong : hShort;
      const p4H = isNormal ? hShort : hLong;

      ctx2d.moveTo(-7, -p1H); ctx2d.lineTo(-7, p1H);
      ctx2d.moveTo(-2.5, -p2H); ctx2d.lineTo(-2.5, p2H);

      // Pair 2:
      ctx2d.moveTo(2.5, -p3H); ctx2d.lineTo(2.5, p3H);
      ctx2d.moveTo(7, -p4H); ctx2d.lineTo(7, p4H);

      ctx2d.stroke();
      ctx2d.restore();

      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;

      const radialOffset = 10;
      const alongOffset = 16;

      const baseX = mx + nx * radialOffset;
      const baseY = my + ny * radialOffset;

      const plusXPos = baseX - ux * alongOffset;
      const plusYPos = baseY - uy * alongOffset;
      const minusXPos = baseX + ux * alongOffset;
      const minusYPos = baseY + uy * alongOffset;

      ctx2d.fillStyle = '#fff';
      ctx2d.font = '10px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';

      if (polarity === 1) {
        ctx2d.fillText('+', plusXPos, plusYPos);
        ctx2d.fillText('-', minusXPos, minusYPos);
      } else {
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
      return 0.7;
    },
    stamp(G, I, comp, ctxStamp) {
      const { n1Idx, n2Idx } = ctxStamp;
      const v1 = comp.n1.vx || 0;
      const v2 = comp.n2.vx || 0;
      const vd = v1 - v2;

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

      ctx2d.beginPath();
      ctx2d.moveTo(-10, -8);
      ctx2d.lineTo(-10, 8);
      ctx2d.lineTo(4, 0);
      ctx2d.closePath();
      ctx2d.stroke();

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
      return 1.7;
    },
    stamp(G, I, comp, ctxStamp) {
      const { n1Idx, n2Idx } = ctxStamp;
      const v1 = comp.n1.vx || 0;
      const v2 = comp.n2.vx || 0;
      const vd = v1 - v2;

      const on = vd > comp.value;
      comp.isOn = on;

      const resistance = on ? 8 : 1e6;
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

      const color = comp.ledColor || '#00ff88';

      ctx2d.save();
      ctx2d.translate(mx, my);
      ctx2d.rotate(angle);

      ctx2d.fillStyle = color;
      ctx2d.globalAlpha = comp.displayBrightness || (comp.isOn ? 1 : 0.2);
      ctx2d.beginPath();
      ctx2d.moveTo(10, 0);
      ctx2d.lineTo(-10, -10);
      ctx2d.lineTo(-10, 10);
      ctx2d.closePath();
      ctx2d.fill();

      ctx2d.globalAlpha = 1.0;
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(10, -10);
      ctx2d.lineTo(10, 10);
      ctx2d.stroke();

      if (comp.isOn) {
        ctx2d.strokeStyle = color;
        ctx2d.lineWidth = 1.5;
        ctx2d.beginPath();
        ctx2d.moveTo(4, -12);
        ctx2d.lineTo(10, -18);
        ctx2d.moveTo(10, -18);
        ctx2d.lineTo(6, -18);
        ctx2d.moveTo(10, -18);
        ctx2d.lineTo(10, -14);

        ctx2d.moveTo(-2, -12);
        ctx2d.lineTo(4, -18);
        ctx2d.moveTo(4, -18);
        ctx2d.lineTo(0, -18);
        ctx2d.moveTo(4, -18);
        ctx2d.lineTo(4, -14);
        ctx2d.stroke();
      }

      ctx2d.restore();
    }
  },
  SW: {
    key: 'SW',
    label: 'Switch',
    inputId: null,
    getDefaultValue() { return 0; },
    stamp(G, I, comp, ctxStamp) {
      const { n1Idx, n2Idx } = ctxStamp;
      const resistance = comp.closed ? 0.001 : 1e9;
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

      ctx2d.fillStyle = comp.closed ? '#2ecc71' : '#e74c3c';
      ctx2d.beginPath();
      ctx2d.arc(-10, 0, 3, 0, Math.PI * 2);
      ctx2d.arc(10, 0, 3, 0, Math.PI * 2);
      ctx2d.fill();

      ctx2d.strokeStyle = comp.closed ? '#2ecc71' : '#e74c3c';
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(-10, 0);

      if (comp.closed) {
        ctx2d.lineTo(10, 0);
      } else {
        ctx2d.lineTo(8, -10);
      }
      ctx2d.stroke();

      ctx2d.restore();
    }
  },
  ACV: {
    key: 'ACV',
    label: 'AC Voltage',
    inputId: 'acVoltageValue',
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

      const freq = comp.frequency || 50;
      const phase = comp.phase || 0;
      const instV = comp.value * Math.sin(2 * Math.PI * freq * runtimeState.simTime + phase);
      I[row] += instV;
    },
    draw(ctx2d, comp) {
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;
      const radius = 12;

      ctx2d.fillStyle = '#8e44ad';
      ctx2d.beginPath();
      ctx2d.arc(mx, my, radius, 0, Math.PI * 2);
      ctx2d.fill();

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

      ctx2d.fillStyle = '#eee';
      ctx2d.font = '10px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'bottom';
      // const freq = comp.frequency || 50;
      // const freqLabel = freq >= 1000 ? `${(freq / 1000).toFixed(1)}kHz` : `${freq}Hz`;
      // ctx2d.fillText(`${comp.value}V ${freqLabel}`, mx, my - radius - 2);

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
    stamp() { },
    draw(ctx2d, comp) {
      const mx = (comp.n1.x + comp.n2.x) / 2;
      const my = (comp.n1.y + comp.n2.y) / 2;
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

      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 12);

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

// ===== Graph & Topological Helpers =====
export function findElectricalRoot(node, parentMap, nodesList) {
  if (node.electricalNode === null || node.electricalNode === node.id) {
    return node.id;
  }
  const parentNode = nodesList.find(n => n.id === node.electricalNode);
  if (!parentNode) return node.id;
  const root = findElectricalRoot(parentNode, parentMap, nodesList);
  node.electricalNode = root;
  return root;
}

export function unionElectricalNodes(n1, n2, parentMap, nodesList) {
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

export function getCircuitGroups() {
  if (circuitState.nodes.length === 0) return [];

  const parent = {};
  for (const n of circuitState.nodes) parent[n.id] = n.id;

  function find(id) {
    if (parent[id] === id) return id;
    return parent[id] = find(parent[id]);
  }
  function union(id1, id2) {
    const r1 = find(id1);
    const r2 = find(id2);
    if (r1 !== r2) parent[r2] = r1;
  }

  for (const c of circuitState.components) {
    union(c.n1.id, c.n2.id);
  }

  const groupsMap = new Map();
  for (const n of circuitState.nodes) {
    const rep = find(n.id);
    if (!groupsMap.has(rep)) {
      groupsMap.set(rep, { nodes: [], components: [] });
    }
    groupsMap.get(rep).nodes.push(n);
  }

  for (const c of circuitState.components) {
    const rep = find(c.n1.id);
    if (groupsMap.has(rep)) groupsMap.get(rep).components.push(c);
  }
  return Array.from(groupsMap.values());
}

export function calculateWireCurrents(groupNodes, groupComponents) {
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
      if (c.type === 'W') continue;
      const val = Number.isFinite(c.current) ? c.current : 0;
      if (c.n1 === n) current += val;
      if (c.n2 === n) current -= val;
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
          const safeChildCurrent = Number.isFinite(childCurrent) ? childCurrent : 0;
          if (u === edge.wire.n1) edge.wire.current = safeChildCurrent;
          else edge.wire.current = -safeChildCurrent;
          sumChildCurrents += safeChildCurrent;
        }
      }
      return sumChildCurrents + I_ext[u.id];
    }

    dfs(componentNodes[0]);
  }
}

export function gaussSolve(A, b) {
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

export function solveCircuit(showSolveErrorFn) {
  if (circuitState.nodes.length === 0) return;

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
          const rawCurr = v[N + k];
          c.current = Number.isFinite(rawCurr) ? rawCurr : 0;
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

          const rawCurr = (c.n1.vx - c.n2.vx) / resistance;
          c.current = Number.isFinite(rawCurr) ? rawCurr : 0;

          if (c.type === 'LED') {
            const targetBrightness =
              c.isOn ? Math.min(1, Math.abs(c.current) * 20) : 0;
            c.displayBrightness += (targetBrightness - c.displayBrightness) * 0.15;
          }
        }
        else if (c.type === 'C') {
          const voltageNow = c.n1.vx - c.n2.vx;
          const rawCurr = c.value * ((voltageNow - c.capacitorVoltage) / settingsState.settings.simDT);
          c.current = Number.isFinite(rawCurr) ? rawCurr : 0;
          c.capacitorVoltage += (voltageNow - c.capacitorVoltage) * 0.15;
          c.historyCurrent = (c.value / settingsState.settings.simDT) * c.capacitorVoltage;
        }
      }
      calculateWireCurrents(groupNodes, groupComponents);
    }
  }

  if (hasError && typeof showSolveErrorFn === 'function') {
    showSolveErrorFn('Some circuit components could not be solved');
  }
}

let prevTime = 0;
export function simLoop(showSolveErrorFn) {
  const now = Date.now();
  const deltaTime = now - prevTime;
  prevTime = now;

  if (!runtimeState.paused) {
    settingsState.settings.simDT = Math.min((deltaTime / 1000), 0.05) / settingsState.settings.subSteps;
    runtimeState.currentAnimTime += deltaTime;

    for (let i = 0; i < settingsState.settings.subSteps; i++) {
      runtimeState.simTime += settingsState.settings.simDT;
      solveCircuit(showSolveErrorFn);
    }
  }

  requestAnimationFrame(() => simLoop(showSolveErrorFn));
}
