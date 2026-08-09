import {
  circuitState,
  editorState,
  settingsState,
  MAX_HISTORY,
  SAVE_KEY,
  DEFAULT_SETTINGS,
  DEFAULT_DISPLAY_SETTINGS
} from './utils.js';

export const undoStack = [];
export const redoStack = [];

export function createCircuitSnapshot() {
  return JSON.stringify(exportCircuitData());
}

export function loadCircuitSnapshot(snapshot, clearSelectionFn) {
  importCircuitData(JSON.parse(snapshot));
  if (typeof clearSelectionFn === 'function') {
    clearSelectionFn();
  }
}

export function pushUndoState() {
  undoStack.push(createCircuitSnapshot());

  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }

  redoStack.length = 0;
}

export function undo(clearSelectionFn) {
  if (!undoStack.length) return;

  redoStack.push(createCircuitSnapshot());

  const snapshot = undoStack.pop();

  loadCircuitSnapshot(snapshot, clearSelectionFn);
}

export function redo(clearSelectionFn) {
  if (!redoStack.length) return;

  undoStack.push(createCircuitSnapshot());

  const snapshot = redoStack.pop();

  loadCircuitSnapshot(snapshot, clearSelectionFn);
}

export function rebuildNextTypeIds() {
  const maxIds = {
    R: 0, V: 0, C: 0, D: 0, LED: 0, SW: 0, ACV: 0, W: 0, GND: 0,
    POT: 0, RHEO: 0, BAT: 0, ISRC: 0, VM: 0, AM: 0, FUSE: 0, LAMP: 0, TH: 0, LDR: 0, RELAY: 0,
    NMOS: 0, PMOS: 0
  };
  for (const c of circuitState.components) {
    if (!c.name) continue;
    const match = c.name.match(/^([A-Za-z]+)(\d+)$/);
    if (match) {
      const type = match[1];
      const num = parseInt(match[2], 10);
      if (!isNaN(num) && maxIds[type] !== undefined) {
        maxIds[type] = Math.max(maxIds[type], num);
      }
    }
  }
  circuitState.nextTypeIds = {};
  for (const k in maxIds) {
    circuitState.nextTypeIds[k] = maxIds[k] + 1;
  }
}

export function exportCircuitData() {
  return {
    nodes: circuitState.nodes.map(n => ({
      id: n.id,
      x: n.x,
      y: n.y,
      isGround: !!n.isGround
    })),

    components: circuitState.components.map(c => ({
      id: c.id,
      type: c.type,
      name: c.name,

      n1: c.n1 ? c.n1.id : null,
      n2: c.n2 ? c.n2.id : null,
      n3: c.n3 ? c.n3.id : null,

      value: c.value,

      polarity: c.polarity,
      frequency: c.frequency,
      phase: c.phase,

      ledColor: c.ledColor,
      closed: !!c.closed,

      wiper: c.wiper,
      temperature: c.temperature,
      beta: c.beta,
      lightLevel: c.lightLevel,
      darkResistance: c.darkResistance,
      lightResistance: c.lightResistance,
      blown: !!c.blown,
      coldResistance: c.coldResistance,
      ratedPower: c.ratedPower,
      lampColor: c.lampColor,
      threshold: c.threshold,
      contactType: c.contactType,
      coilResistance: c.coilResistance,
      isEnergized: !!c.isEnergized,

      vth: c.vth,
      kp: c.kp,
      lambda: c.lambda
    })),

    nextId: circuitState.nextId,
    nextTypeIds: circuitState.nextTypeIds
  };
}

export function importCircuitData(data) {
  circuitState.nodes = [];
  circuitState.components = [];

  const nodeMap = new Map();

  for (const n of data.nodes) {
    const node = {
      id: n.id,
      x: n.x,
      y: n.y,
      vx: 0,
      isGround: !!n.isGround,
      electricalNode: null,
      electricalIndex: 0,
      hasError: false
    };

    nodeMap.set(node.id, node);
    circuitState.nodes.push(node);
  }

  for (const c of data.components) {
    const n1 = nodeMap.get(Number(c.n1));
    const n2 = nodeMap.get(Number(c.n2));
    const n3 = c.n3 != null ? nodeMap.get(Number(c.n3)) : null;

    if (!n1 && !n2) continue;

    circuitState.components.push({
      id: c.id,
      type: c.type,
      name: c.name || `${c.type}${c.id}`,
      n1: n1 || n2,
      n2: n2 || n1,
      n3: n3 || null,
      value: c.value ?? 1,
      polarity: c.polarity ?? 1,
      frequency: c.frequency ?? 50,
      phase: c.phase ?? 0,
      ledColor: c.ledColor ?? '#00ff88',
      closed: !!c.closed,
      wiper: c.wiper !== undefined ? c.wiper : 0.5,
      temperature: c.temperature !== undefined ? c.temperature : 25,
      beta: c.beta ?? 3950,
      lightLevel: c.lightLevel !== undefined ? c.lightLevel : 0.5,
      darkResistance: c.darkResistance ?? 1e6,
      lightResistance: c.lightResistance ?? 100,
      blown: !!c.blown,
      coldResistance: c.coldResistance ?? 0.01,
      ratedPower: c.ratedPower ?? 1.0,
      lampColor: c.lampColor ?? '#ffdd57',
      threshold: c.threshold ?? (c.value || 3.0),
      contactType: c.contactType ?? 'NO',
      coilResistance: c.coilResistance ?? 100,
      isEnergized: !!c.isEnergized,
      vth: c.vth !== undefined ? c.vth : (c.type === 'PMOS' ? -1.5 : 1.5),
      kp: c.kp ?? 0.02,
      lambda: c.lambda ?? 0.01,
      current: 0,
      displayBrightness: 0,
      capacitorVoltage: 0,
      historyCurrent: 0,
      isOn: false,
      hasError: false
    });
  }

  circuitState.nextId = data.nextId || 1;
  if (data.nextTypeIds) {
    circuitState.nextTypeIds = { ...data.nextTypeIds };
  } else {
    rebuildNextTypeIds();
  }

  saveCircuitToURL();
}

export function saveCircuitToURL() {
  const nodeIndexMap = new Map();

  circuitState.nodes.forEach((n, i) => {
    nodeIndexMap.set(n.id, i);
  });

  const data = [
    circuitState.nodes.map(n => [
      n.id,       // [0] id
      n.x,        // [1]
      n.y,        // [2]
      n.isGround ? 1 : 0  // [3]
    ]),

    circuitState.components.map(c => [
      c.type,                         // [0]
      c.id,                           // [1] component id
      nodeIndexMap.get(c.n1?.id),     // [2] n1 index into nodes array
      nodeIndexMap.get(c.n2?.id),     // [3] n2 index into nodes array
      c.value,                        // [4]
      c.polarity || 0,                // [5]
      c.frequency || 0,               // [6]
      c.phase || 0,                   // [7]
      c.ledColor || "",               // [8]
      c.closed ? 1 : 0,               // [9]
      c.name || "",                   // [10] component name
      {
        n3: c.n3 ? nodeIndexMap.get(c.n3.id) : null,
        wiper: c.wiper,
        temperature: c.temperature,
        beta: c.beta,
        lightLevel: c.lightLevel,
        darkResistance: c.darkResistance,
        lightResistance: c.lightResistance,
        blown: c.blown ? 1 : 0,
        coldResistance: c.coldResistance,
        ratedPower: c.ratedPower,
        lampColor: c.lampColor,
        threshold: c.threshold,
        contactType: c.contactType,
        coilResistance: c.coilResistance,
        isEnergized: c.isEnergized ? 1 : 0,
        vth: c.vth,
        kp: c.kp,
        lambda: c.lambda
      }                               // [11] extra component properties
    ]),

    circuitState.nextId,              // [2] top-level nextId
    circuitState.nextTypeIds          // [3] nextTypeIds object
  ];

  const compressed =
    window.LZString.compressToEncodedURIComponent(
      JSON.stringify(data)
    );

  window.history.replaceState(
    null,
    "",
    "?c=" + compressed
  );
}

export function loadCircuitFromURL() {
  const params =
    new URLSearchParams(window.location.search);

  const encoded = params.get("c");

  if (!encoded) return;

  try {
    const json =
      window.LZString.decompressFromEncodedURIComponent(
        encoded
      );

    const data = JSON.parse(json);

    const [savedNodes, savedComponents, savedNextId, savedNextTypeIds] = data;

    circuitState.nodes = [];
    circuitState.components = [];

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

      circuitState.nodes.push(node);
      nodeRefs.push(node);
    }

    for (const c of savedComponents) {
      const n1 = nodeRefs[c[2]];
      const n2 = nodeRefs[c[3]];

      if (!n1 && !n2) {
        console.warn('Skipping component with missing node refs:', c);
        continue;
      }

      const extra = c[11] || {};
      const n3 = (extra.n3 !== undefined && extra.n3 !== null && nodeRefs[extra.n3]) ? nodeRefs[extra.n3] : null;

      circuitState.components.push({
        type: c[0],
        id: c[1],           // component id restored
        n1: n1 || n2,
        n2: n2 || n1,
        n3: n3,
        value: c[4],
        polarity: c[5] || 1,
        frequency: c[6] || 50,
        phase: c[7] || 0,
        ledColor: c[8] || '#00ff88',
        closed: !!c[9],
        name: c[10] || `${c[0]}${c[1]}`,
        wiper: extra.wiper !== undefined ? extra.wiper : 0.5,
        temperature: extra.temperature !== undefined ? extra.temperature : 25,
        beta: extra.beta ?? 3950,
        lightLevel: extra.lightLevel !== undefined ? extra.lightLevel : 0.5,
        darkResistance: extra.darkResistance ?? 1e6,
        lightResistance: extra.lightResistance ?? 100,
        blown: !!extra.blown,
        coldResistance: extra.coldResistance ?? 0.01,
        ratedPower: extra.ratedPower ?? 1.0,
        lampColor: extra.lampColor ?? '#ffdd57',
        threshold: extra.threshold ?? (c[4] || 3.0),
        contactType: extra.contactType ?? 'NO',
        coilResistance: extra.coilResistance ?? 100,
        isEnergized: !!extra.isEnergized,
        vth: extra.vth !== undefined ? extra.vth : (c[0] === 'PMOS' ? -1.5 : 1.5),
        kp: extra.kp ?? 0.02,
        lambda: extra.lambda ?? 0.01,
        current: 0,
        displayBrightness: 0,
        capacitorVoltage: 0,
        historyCurrent: 0,
        hasError: false
      });
    }

    if (savedNextId != null) {
      circuitState.nextId = savedNextId;
    } else {
      const allIds = [
        ...circuitState.nodes.map(n => n.id || 0),
        ...circuitState.components.map(c => c.id || 0)
      ];
      circuitState.nextId = (allIds.length ? Math.max(...allIds) : 0) + 1;
    }

    if (savedNextTypeIds) {
      circuitState.nextTypeIds = { ...savedNextTypeIds };
    } else {
      rebuildNextTypeIds();
    }

  } catch (err) {
    console.error("Failed to load circuit:", err);
  }
}

export function saveCircuitToLocalStorage(refreshSaveMenuFn) {
  const name = prompt('Save name?');

  if (!name) return;

  const saves = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');

  const raw = JSON.stringify(exportCircuitData());

  const compressed = window.LZString.compressToEncodedURIComponent(raw);

  const existing = saves.find(s => s.name === name);

  if (existing) {
    const overwrite = confirm(`"${name}" already exists.\n\nOverwrite it?`);
    if (!overwrite) return;

    const existingIndex =
      saves.findIndex(s => s.name === name);

    if (existingIndex !== -1) {
      saves[existingIndex] = {
        id: Date.now(),
        name,
        data: compressed,
        createdAt: Date.now()
      };
    }
  } else {
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
  }

  if (typeof refreshSaveMenuFn === 'function') {
    refreshSaveMenuFn();
  }
}

export function loadCircuitSave(save, clearSelectionFn) {
  const raw =
    window.LZString.decompressFromEncodedURIComponent(save.data);

  if (!raw) return;

  const data = JSON.parse(raw);

  importCircuitData(data);

  if (typeof clearSelectionFn === 'function') {
    clearSelectionFn();
  }
}

export function loadSettings(updateUiFn) {
  try {
    const raw = localStorage.getItem("nodeLabSettings");

    if (!raw) {
      settingsState.settings = { ...DEFAULT_SETTINGS };
      editorState.displaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
      if (typeof updateUiFn === 'function') updateUiFn();
      return;
    }

    const data = JSON.parse(raw);
    if (data.settings) {
      settingsState.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    } else if (data.subSteps !== undefined) {
      settingsState.settings = { ...DEFAULT_SETTINGS, ...data };
    } else {
      settingsState.settings = { ...DEFAULT_SETTINGS };
    }

    if (data.displaySettings) {
      editorState.displaySettings = { ...DEFAULT_DISPLAY_SETTINGS, ...data.displaySettings };
    }

    settingsState.settings.simDT = 0.05 / (settingsState.settings.subSteps || 8);
    if (typeof updateUiFn === 'function') updateUiFn();
  } catch (err) {
    console.warn("Failed to load settings:", err);
    settingsState.settings = { ...DEFAULT_SETTINGS };
    editorState.displaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
    if (typeof updateUiFn === 'function') updateUiFn();
  }
}

export function saveSettings() {
  try {
    const bundle = {
      settings: settingsState.settings,
      displaySettings: editorState.displaySettings
    };
    localStorage.setItem("nodeLabSettings", JSON.stringify(bundle));
  } catch (err) {
    console.warn("Failed to save settings:", err);
  }
}
