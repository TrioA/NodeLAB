// ===== Shared Application State =====

export const circuitState = {
  nodes: [],          // {x,y,vx,id,electricalNode,electricalIndex,hasError}
  components: [],     // {type,n1,n2,value,id,current,hasError,name}
  nextId: 1,
  nextTypeIds: {
    R: 1, V: 1, C: 1, D: 1, LED: 1, SW: 1, ACV: 1, W: 1, GND: 1,
    POT: 1, BAT: 1, ISRC: 1, VM: 1, AM: 1, FUSE: 1, LAMP: 1, TH: 1, LDR: 1, RELAY: 1
  }
};

export const editorState = {
  placing: null,      // {type,value,n1,n2}
  draggingNode: null,
  draggingGroup: false,
  dragGroupOffsets: [],
  dragSelectStartX: 0,
  dragSelectStartY: 0,
  activeTool: null,   // 'R'|'V'|'W' or null
  mode: 'SELECT',     // SELECT | CREATE_NODE | CREATE_RESISTOR | ...
  selectedObject: null,
  multiSelected: [],
  selectionBox: null,
  dragSelecting: false,

  mouse: { x: 0, y: 0, rawX: 0, rawY: 0 },
  ctrlPressed: false,
  shiftPressed: false,
  panX: 0,
  panY: 0,
  panning: false,
  lastMouseX: 0,
  lastMouseY: 0,
  scale: 1,

  displaySettings: {
    useVoltageColoring: true,
    showNodeVoltages: true,
    showComponentNames: true,
    showComponentValues: true,
    showCurrentFlow: 'ctrl', // 'always' | 'ctrl' | 'never'
    showWireCurrents: false
  }
};

export const settingsState = {
  settings: {
    subSteps: 20,
    simDT: 0.05 / 20,
  },
};

export const runtimeState = {
  currentAnimTime: 0,
  simTime: 0,
  paused: false,
};

export function generateComponentName(type) {
  if (!circuitState.nextTypeIds) {
    circuitState.nextTypeIds = {
      R: 1, V: 1, C: 1, D: 1, LED: 1, SW: 1, ACV: 1, W: 1, GND: 1,
      POT: 1, BAT: 1, ISRC: 1, VM: 1, AM: 1, FUSE: 1, LAMP: 1, TH: 1, LDR: 1, RELAY: 1
    };
  }
  const prefix = type;
  const id = (circuitState.nextTypeIds[prefix] !== undefined) ? circuitState.nextTypeIds[prefix] : 1;
  circuitState.nextTypeIds[prefix] = id + 1;
  return `${prefix}${id}`;
}

// ===== Constants =====
export const GRID_SIZE = 10;
export const MAX_HISTORY = 100;
export const SAVE_KEY = 'circuitsim_saves';

export const DEFAULT_SETTINGS = {
  subSteps: 8,
  simDT: 0.05 / 8,
};

// ===== Math & Geometry Helpers =====
export function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distSq(v, w) {
  return (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
}

export function distToSegment(p, v, w) {
  const l2 = distSq(v, w);
  if (l2 === 0) return dist(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

export function formatCurrent(amperes) {
  const abs = Math.abs(amperes);
  const sign = amperes < 0 ? '-' : '';
  if (abs < 1e-6) return '0.00 A';
  if (abs < 1e-3) return `${sign}${(abs * 1e6).toFixed(2)} µA`;
  if (abs < 1) return `${sign}${(abs * 1000).toFixed(2)} mA`;
  return `${sign}${abs.toFixed(3)} A`;
}

export function snapToGrid(x) {
  return Math.round(x / GRID_SIZE) * GRID_SIZE;
}

export function normalize(r, g, b) {
  const max = Math.hypot(r, g, b);
  return [r / max, g / max, b / max];
}

export function screenToWorld(sx, sy) {
  return {
    x: (sx - editorState.panX) / editorState.scale,
    y: (sy - editorState.panY) / editorState.scale
  };
}

export function worldToScreen(wx, wy) {
  return {
    x: wx * editorState.scale + editorState.panX,
    y: wy * editorState.scale + editorState.panY
  };
}

export function voltageColor(v) {
  if (v === undefined || v === null || isNaN(v)) return 'rgb(200, 200, 200)';
  const eps = 1e-3;
  if (Math.abs(v) < eps) {
    return 'rgb(200, 200, 200)';
  }
  const maxV = 120;
  const absV = Math.abs(v);
  const t = Math.min(1, Math.pow(absV / maxV, 0.65));

  const r0 = 200, g0 = 200, b0 = 200;

  if (v > 0) {
    const r = Math.round(r0 + (255 - r0) * t);
    const g = Math.round(g0 * (1 - t));
    const b = Math.round(b0 * (1 - t));
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const r = Math.round(r0 * (1 - t));
    const g = Math.round(g0 * (1 - t));
    const b = Math.round(b0 + (255 - b0) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

export function wireVoltageColor(v) {
  if (v === undefined || v === null || isNaN(v)) return [180, 180, 180];
  const eps = 1e-3;
  if (Math.abs(v) < eps) {
    return [180, 180, 180];
  }
  const maxV = 120;
  const absV = Math.abs(v);
  const t = Math.min(1, Math.pow(absV / maxV, 0.65));

  const r0 = 180, g0 = 180, b0 = 180;

  if (v > 0) {
    const r = Math.round(r0 + (255 - r0) * t);
    const g = Math.round(g0 * (1 - 0.85 * t));
    const b = Math.round(b0 * (1 - 0.85 * t));
    return [r, g, b];
  } else {
    const r = Math.round(r0 * (1 - 0.85 * t));
    const g = Math.round(g0 * (1 - 0.85 * t));
    const b = Math.round(b0 + (255 - b0) * t);
    return [r, g, b];
  }
}

// ===== Topology Helpers =====
export function getConnectionsForNode(node) {
  let count = 0;
  for (const c of circuitState.components) {
    if (c.n1 === node || c.n2 === node) count++;
  }
  return count;
}

export function getConnectedNodes(startNode) {
  const visited = new Set();
  const stack = [startNode];

  while (stack.length) {
    const node = stack.pop();

    if (visited.has(node)) continue;
    visited.add(node);

    for (const c of circuitState.components) {
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

export function validateGrounds() {
  for (const node of circuitState.nodes) {
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
