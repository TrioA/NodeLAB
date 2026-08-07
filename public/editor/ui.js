import {
  circuitState,
  editorState,
  settingsState,
  runtimeState,
  snapToGrid,
  formatCurrent,
  SAVE_KEY
} from './utils.js';

import { saveSettings } from './history.js';
import { COMPONENT_TYPES } from './simulation.js';

// Centralized DOM reference dictionary with lazy getters
export const dom = {
  get canvas() { return document.getElementById('canvas'); },
  get info() { return document.getElementById('info'); },
  get propertiesBox() { return document.getElementById('propertiesBox'); },
  get propertiesContent() { return document.getElementById('propertiesContent'); },
  get solveError() { return document.getElementById('solveError'); },
  get saveMenu() { return document.getElementById('saveMenu'); },
  get saveList() { return document.getElementById('saveList'); },
  get hamburgerBtn() { return document.getElementById('hamburgerBtn'); },
  get newCircuitBtn() { return document.getElementById('newCircuitBtn'); },
  get saveCircuitBtn() { return document.getElementById('saveCircuitBtn'); },
  get savedCircuitsBtn() { return document.getElementById('savedCircuitsBtn'); },
  get settingsBtn() { return document.getElementById('settingsBtn'); },
  get settingsMenu() { return document.getElementById('settingsMenu'); },
  get subStepsSlider() { return document.getElementById('subStepsSlider'); },
  get subStepsValue() { return document.getElementById('subStepsValue'); },
  get tooltipBox() { return document.getElementById('tooltipBox'); },
  get mouseCoords() { return document.getElementById('mouseCoords'); },
  get selectBtn() { return document.getElementById('selectBtn'); },
  get panToolBtn() { return document.getElementById('panToolBtn'); },
  get addNodeBtn() { return document.getElementById('addNodeBtn'); },
  get deleteModeBtn() { return document.getElementById('deleteModeBtn'); },
  get initialFade() { return document.getElementById('initial-fade'); },
  get pauseBtn() { return document.getElementById('pauseBtn'); },
  get lhsPanel() { return document.getElementById('lhsPanel'); },
  get lhsHeader() { return document.getElementById('lhsHeader'); },
  get lhsToggleBtn() { return document.getElementById('lhsToggleBtn'); },
  get lhsContent() { return document.getElementById('lhsContent'); },
  get chkUseVoltageColoring() { return document.getElementById('chkUseVoltageColoring'); },
  get chkShowNodeVoltages() { return document.getElementById('chkShowNodeVoltages'); },
  get chkShowComponentNames() { return document.getElementById('chkShowComponentNames'); },
  get chkShowComponentValues() { return document.getElementById('chkShowComponentValues'); },
  get chkShowCurrentFlow() { return document.getElementById('chkShowCurrentFlow'); },
  get chkShowWireCurrents() { return document.getElementById('chkShowWireCurrents'); },
};

// ===== Notification =====
export function showSolveError(message = 'Circuit solving failed') {
  let el = dom.solveError;
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

// ===== Selection & Properties Box =====
export function clearSelection() {
  editorState.selectedObject = null;
  editorState.multiSelected = [];
  updatePropertiesBox();
}

export function addToMultiSelection(item) {
  if (editorState.selectedObject && !editorState.multiSelected.includes(editorState.selectedObject)) {
    editorState.multiSelected.push(editorState.selectedObject);
  }
  editorState.selectedObject = null;

  const idx = editorState.multiSelected.indexOf(item);
  if (idx === -1) {
    editorState.multiSelected.push(item);
  } else {
    editorState.multiSelected.splice(idx, 1);
  }

  if (editorState.multiSelected.length === 1) {
    editorState.selectedObject = editorState.multiSelected[0];
    editorState.multiSelected = [];
  }

  updatePropertiesBox();
}

// References for CRUD operations passed via callback or bound dynamically
let _pushUndoState = null;
let _saveCircuitToURL = null;
let _deleteNode = null;
let _deleteComponent = null;
let _setGroundNode = null;
let _loadCircuitSave = null;

export function bindUICallbacks(callbacks) {
  if (callbacks.pushUndoState) _pushUndoState = callbacks.pushUndoState;
  if (callbacks.saveCircuitToURL) _saveCircuitToURL = callbacks.saveCircuitToURL;
  if (callbacks.deleteNode) _deleteNode = callbacks.deleteNode;
  if (callbacks.deleteComponent) _deleteComponent = callbacks.deleteComponent;
  if (callbacks.setGroundNode) _setGroundNode = callbacks.setGroundNode;
  if (callbacks.loadCircuitSave) _loadCircuitSave = callbacks.loadCircuitSave;
}

export function updatePropertiesBox() {
  const box = dom.propertiesBox;
  const content = dom.propertiesContent;
  if (!box || !content) return;

  if (editorState.multiSelected.length > 1) {
    box.style.display = 'block';

    const sel = editorState.multiSelected;
    const totalCount = sel.length;

    const nodeObjs = sel.filter(o => circuitState.nodes.includes(o));
    const nodeCount = nodeObjs.length;

    const compObjs = sel.filter(o => circuitState.components.includes(o));
    const typeCounts = {};
    for (const c of compObjs) {
      const label = COMPONENT_TYPES[c.type]?.label ?? c.type;
      typeCounts[label] = (typeCounts[label] || 0) + 1;
    }
    const typeRows = Object.entries(typeCounts)
      .map(([label, count]) => `
        <div style="display:flex;justify-space-between;padding:2px 0;">
          <span style="color:var(--text-secondary);font-size:11px;">${label}</span>
          <span style="color:var(--text-primary);font-weight:600;font-size:11px;font-family:var(--font-mono);">${count}</span>
        </div>`).join('');

    content.innerHTML = `
      <div class="properties-field" style="margin-bottom:10px;">
        <label>Selection</label>
        <div style="font-weight:700;font-size:18px;font-family:var(--font-mono);color:var(--accent);">${totalCount} objects</div>
      </div>

      <div class="properties-field" style="margin-bottom:8px;">
        <label>Breakdown</label>
        <div style="background:var(--bg-tertiary);border:1px solid var(--border-primary);border-radius:var(--radius-sm);padding:6px 8px;">
          <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--border-secondary);margin-bottom:4px;">
            <span style="color:var(--text-secondary);font-size:11px;">Nodes</span>
            <span style="color:#3fb950;font-weight:600;font-size:11px;font-family:var(--font-mono);">${nodeCount}</span>
          </div>
          ${typeRows || '<div style="color:var(--text-muted);font-size:11px;">No components</div>'}
        </div>
      </div>

      <div class="properties-field">
        <label>Move Selection (ΔX / ΔY)</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="number" id="multiMoveX" value="0" step="10" style="width:72px;" placeholder="ΔX" />
          <input type="number" id="multiMoveY" value="0" step="10" style="width:72px;" placeholder="ΔY" />
          <button class="tool-btn" id="multiMoveApply" style="flex:1;padding:7px 8px;">Apply</button>
        </div>
      </div>

      <button class="delete-btn" id="multiDeleteBtn" style="margin-top:4px;">
        Delete All (${totalCount})
      </button>
    `;

    document.getElementById('multiMoveApply').addEventListener('click', () => {
      const dx = snapToGrid(parseFloat(document.getElementById('multiMoveX').value) || 0);
      const dy = snapToGrid(parseFloat(document.getElementById('multiMoveY').value) || 0);
      if (dx === 0 && dy === 0) return;
      if (_pushUndoState) _pushUndoState();
      for (const o of nodeObjs) {
        o.x = snapToGrid(o.x + dx);
        o.y = snapToGrid(o.y + dy);
      }
      if (_saveCircuitToURL) _saveCircuitToURL();
      document.getElementById('multiMoveX').value = 0;
      document.getElementById('multiMoveY').value = 0;
    });

    document.getElementById('multiDeleteBtn').addEventListener('click', () => {
      const ok = confirm(`Delete all ${totalCount} selected objects? This cannot be undone easily.`);
      if (!ok) return;
      if (_pushUndoState) _pushUndoState();
      const nodesToDelete = new Set(nodeObjs);
      const compsToDelete = new Set(compObjs);
      for (const c of circuitState.components) {
        if (nodesToDelete.has(c.n1) || nodesToDelete.has(c.n2)) compsToDelete.add(c);
      }
      circuitState.components = circuitState.components.filter(c => !compsToDelete.has(c));
      circuitState.nodes = circuitState.nodes.filter(n => !nodesToDelete.has(n));
      clearSelection();
      if (_saveCircuitToURL) _saveCircuitToURL();
    });

    return;
  }

  const obj = editorState.selectedObject;
  if (!obj) {
    box.style.display = 'none';
    content.innerHTML = '';
    return;
  }

  box.style.display = 'block';

  const isNode = circuitState.nodes.includes(obj);
  if (isNode) {
    const n = obj;
    const isGround = circuitState.components.some(c => c.type === 'GND' && c.n1 === n);

    content.innerHTML = `
    <div class="properties-field">
      <label>Node Type</label>
      <div style="font-weight:bold;color:${isGround ? '#4af' : '#fff'};">
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
      if (_pushUndoState) _pushUndoState();
      const v = snapToGrid(parseFloat(e.target.value));
      if (!isNaN(v)) n.x = v;
      if (_saveCircuitToURL) _saveCircuitToURL();
    });

    document.getElementById('propY').addEventListener('input', (e) => {
      if (_pushUndoState) _pushUndoState();
      const v = snapToGrid(parseFloat(e.target.value));
      if (!isNaN(v)) n.y = v;
      if (_saveCircuitToURL) _saveCircuitToURL();
    });

    document.getElementById('propSetGround').addEventListener('click', () => {
      if (_pushUndoState) _pushUndoState();
      if (_setGroundNode) _setGroundNode(n);
      updatePropertiesBox();
      if (_saveCircuitToURL) _saveCircuitToURL();
    });

    document.getElementById('propDelete').addEventListener('click', () => {
      if (_pushUndoState) _pushUndoState();
      circuitState.components = circuitState.components.filter(c =>
        !(c.type === 'GND' && c.n1 === n)
      );
      if (_deleteNode) _deleteNode(n);
      clearSelection();
      if (_saveCircuitToURL) _saveCircuitToURL();
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
    <div class="properties-field">
      <label>Name / Label</label>
      <input type="text" id="propName" value="${c.name || ''}" placeholder="e.g. ${c.type}${c.id}" />
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
    document.getElementById('propName')?.addEventListener('input', (e) => {
      if (_pushUndoState) _pushUndoState();
      c.name = e.target.value.trim() || `${c.type}${c.id}`;
      if (_saveCircuitToURL) _saveCircuitToURL();
    });

    document.getElementById('propValue')?.addEventListener('input', (e) => {
      if (_pushUndoState) _pushUndoState();
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > 0) c.value = v;
      if (_saveCircuitToURL) _saveCircuitToURL();
    });

    if (c.type === 'ACV') {
      document.getElementById('propFrequency')?.addEventListener('input', (e) => {
        if (_pushUndoState) _pushUndoState();
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v > 0) c.frequency = v;
        if (_saveCircuitToURL) _saveCircuitToURL();
      });
      document.getElementById('propPhase')?.addEventListener('input', (e) => {
        if (_pushUndoState) _pushUndoState();
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) c.phase = v * Math.PI / 180;
        if (_saveCircuitToURL) _saveCircuitToURL();
      });
    }

    if (isVoltage) {
      const toggleBtn = document.getElementById('propPolarityToggle');
      const polTextEl = document.getElementById('propPolarityText');
      if (toggleBtn && polTextEl) {
        toggleBtn.addEventListener('click', () => {
          if (_pushUndoState) _pushUndoState();
          c.polarity = (c.polarity || 1) * -1;
          const pTxt = c.polarity === 1 ? 'N1 is +, N2 is -' : 'N1 is -, N2 is +';
          polTextEl.textContent = pTxt;
          if (_saveCircuitToURL) _saveCircuitToURL();
        });
      }
    }

    if (canFlip) {
      const flipBtn = document.getElementById('propFlipBtn');
      if (flipBtn) {
        flipBtn.addEventListener('click', () => {
          const temp = c.n1;
          c.n1 = c.n2;
          c.n2 = temp;
          if (_saveCircuitToURL) _saveCircuitToURL();
          updatePropertiesBox();
        });
      }
    }

    const ledColorEl = document.getElementById('propLedColor');
    if (ledColorEl) {
      ledColorEl.addEventListener('input', (e) => {
        if (_pushUndoState) _pushUndoState();
        c.ledColor = e.target.value;
        if (_saveCircuitToURL) _saveCircuitToURL();
      });
    }

    document.getElementById('propDelete')?.addEventListener('click', () => {
      if (_pushUndoState) _pushUndoState();
      if (_deleteComponent) _deleteComponent(c);
      clearSelection();
    });
  }
}

export function updateSelectedPropertiesDynamics() {
  const obj = editorState.selectedObject;
  if (!obj) return;
  const isNode = circuitState.nodes.includes(obj);
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
        const inst = (c.value || 0) * Math.sin(2 * Math.PI * freq * runtimeState.simTime + (c.phase || 0));
        elInstV.textContent = `${inst.toFixed(3)} V`;
      }
    }
  }
}

// ===== Menu & Toolbar Helpers =====
export function refreshSaveMenu() {
  const saveList = dom.saveList;
  if (!saveList) return;

  const saves = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');
  saveList.innerHTML = '';

  for (const save of saves) {
    const el = document.createElement('div');
    el.className = 'save-entry';
    const date = new Date(save.createdAt).toLocaleString();

    el.innerHTML = `
    <div class="save-entry-main">
      <div class="save-entry-title">${save.name}</div>
      <div class="save-entry-date">${date}</div>
    </div>
    <button class="save-delete-btn">×</button>
`;

    const deleteBtn = el.querySelector('.save-delete-btn');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const savesArr = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');
      const filtered = savesArr.filter(s => s.id !== save.id);
      localStorage.setItem(SAVE_KEY, JSON.stringify(filtered));
      refreshSaveMenu();
    });

    el.addEventListener('click', () => {
      if (_loadCircuitSave) {
        _loadCircuitSave(save, clearSelection);
      }
      dom.saveMenu?.classList.remove('open');
    });

    saveList.appendChild(el);
  }
}

export function hideAllToolInputs() {
  for (const key in COMPONENT_TYPES) {
    const id = COMPONENT_TYPES[key].inputId;
    if (!id) continue;
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  const freqEl = document.getElementById('acvFrequency');
  if (freqEl) freqEl.style.display = 'none';
}

export function resetToolButtons() {
  document.querySelectorAll('.tool-btn').forEach(b => {
    if (b.id !== 'deleteModeBtn') {
      b.classList.remove('active');
      b.style.background = '';
    }
  });
}

export function setMode(mode) {
  editorState.mode = mode;
  editorState.activeTool = null;
  editorState.placing = null;
  clearSelection();

  hideAllToolInputs();
  resetToolButtons();

  const deleteBtn = dom.deleteModeBtn;
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
    const selectBtn = dom.selectBtn;
    if (selectBtn) selectBtn.classList.add('active');
    return;
  }

  if (mode === 'PAN') {
    const panBtn = dom.panToolBtn;
    if (panBtn) panBtn.classList.add('active');
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

  editorState.activeTool = toolMap[mode] || null;

  const btnId = idMap[mode];
  if (btnId) {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
  }

  if (editorState.activeTool) {
    const def = COMPONENT_TYPES[editorState.activeTool];
    if (def && def.inputId) {
      const el = document.getElementById(def.inputId);
      if (el) el.style.display = 'inline-block';
    }
    if (editorState.activeTool === 'ACV') {
      const freqEl = document.getElementById('acvFrequency');
      if (freqEl) freqEl.style.display = 'inline-block';
    }
  }
}

export function getCurrentToolValue(toolType) {
  const def = COMPONENT_TYPES[toolType];
  if (!def) return 1;
  const inputEl = def.inputId ? document.getElementById(def.inputId) : null;
  if (!inputEl) return def.getDefaultValue();
  const v = parseFloat(inputEl.value);
  if (isNaN(v) || v <= 0) return def.getDefaultValue();
  return v;
}

export function setupToolButton(id, toolMode) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (editorState.mode === toolMode) {
      setMode('SELECT');
    } else {
      setMode(toolMode);
    }
  });
  btn.classList.add('tool-btn');
}

// ===== UI Initialization Routine =====
export function initUI(callbacks) {
  bindUICallbacks(callbacks);

  // LHS Display Settings Panel Handlers
  const lhsHeader = dom.lhsHeader;
  const lhsContent = dom.lhsContent;
  const lhsToggleBtn = dom.lhsToggleBtn;

  if (lhsHeader && lhsContent) {
    lhsHeader.addEventListener('click', () => {
      lhsContent.classList.toggle('collapsed');
      if (lhsToggleBtn) {
        lhsToggleBtn.textContent = lhsContent.classList.contains('collapsed') ? '▶' : '▼';
      }
    });
  }

  const ds = editorState.displaySettings;
  const chkVoltageColoring = dom.chkUseVoltageColoring;
  const chkVoltages = dom.chkShowNodeVoltages;
  const chkNames = dom.chkShowComponentNames;
  const chkValues = dom.chkShowComponentValues;
  const chkFlow = dom.chkShowCurrentFlow;
  const chkWireCurrents = dom.chkShowWireCurrents;

  if (chkVoltageColoring) {
    chkVoltageColoring.checked = ds.useVoltageColoring !== false;
    chkVoltageColoring.addEventListener('change', () => { ds.useVoltageColoring = chkVoltageColoring.checked; });
  }
  if (chkVoltages) {
    chkVoltages.checked = ds.showNodeVoltages;
    chkVoltages.addEventListener('change', () => { ds.showNodeVoltages = chkVoltages.checked; });
  }
  if (chkNames) {
    chkNames.checked = ds.showComponentNames;
    chkNames.addEventListener('change', () => { ds.showComponentNames = chkNames.checked; });
  }
  if (chkValues) {
    chkValues.checked = ds.showComponentValues;
    chkValues.addEventListener('change', () => { ds.showComponentValues = chkValues.checked; });
  }
  if (chkFlow) {
    chkFlow.checked = ds.showCurrentFlow === 'always';
    chkFlow.addEventListener('change', () => { ds.showCurrentFlow = chkFlow.checked ? 'always' : 'ctrl'; });
  }
  if (chkWireCurrents) {
    chkWireCurrents.checked = ds.showWireCurrents;
    chkWireCurrents.addEventListener('change', () => { ds.showWireCurrents = chkWireCurrents.checked; });
  }

  // Pause / Resume Button
  const pauseBtn = dom.pauseBtn;
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      runtimeState.paused = !runtimeState.paused;
      pauseBtn.textContent = runtimeState.paused ? '▶ Resume' : '⏸ Pause';
      pauseBtn.classList.toggle('active', runtimeState.paused);
    });
  }

  const hamburgerBtn = dom.hamburgerBtn;
  const saveMenu = dom.saveMenu;
  const saveList = dom.saveList;

  if (hamburgerBtn && saveMenu) {
    hamburgerBtn.addEventListener('click', () => {
      saveMenu.classList.toggle('open');
    });
  }

  document.addEventListener('click', (e) => {
    if (!saveMenu || !hamburgerBtn) return;
    const insideMenu = saveMenu.contains(e.target);
    const clickedHamburger = hamburgerBtn.contains(e.target);

    if (!insideMenu && !clickedHamburger) {
      saveMenu.classList.remove('open');
      saveList?.classList.remove('open');
    }
  });

  const saveCircuitBtn = dom.saveCircuitBtn;
  if (saveCircuitBtn && callbacks.saveCircuitToLocalStorage) {
    saveCircuitBtn.addEventListener('click', () => {
      callbacks.saveCircuitToLocalStorage(refreshSaveMenu);
    });
  }

  const savedCircuitsBtn = dom.savedCircuitsBtn;
  let tempOpen = false;

  if (savedCircuitsBtn) {
    savedCircuitsBtn.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      tempOpen = true;
      saveList?.classList.add('open');
    });
    savedCircuitsBtn.addEventListener('mouseleave', (e) => {
      tempOpen = false;
      setTimeout(() => {
        if (!tempOpen) saveList?.classList.remove('open');
      }, 200);
    });
  }

  if (saveMenu) {
    saveMenu.addEventListener('mouseenter', () => {
      tempOpen = true;
      saveMenu.classList.add('open');
    });
    saveMenu.addEventListener('mouseleave', () => {
      tempOpen = false;
      setTimeout(() => {
        if (!tempOpen) saveList?.classList.remove('open');
      }, 200);
    });
  }

  if (saveList) {
    saveList.addEventListener('mouseenter', () => {
      tempOpen = true;
      saveList.classList.add('open');
    });
    saveList.addEventListener('mouseleave', () => {
      tempOpen = false;
      setTimeout(() => {
        if (!tempOpen) saveList?.classList.remove('open');
      }, 200);
    });
  }

  const settingsBtn = dom.settingsBtn;
  const settingsMenu = dom.settingsMenu;

  if (settingsBtn && settingsMenu) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsMenu.classList.toggle('open');
      saveMenu?.classList.remove('open');
    });

    document.addEventListener('click', (e) => {
      const insideSettings = settingsMenu.contains(e.target);
      const clickedSettings = settingsBtn.contains(e.target);

      if (!insideSettings && !clickedSettings) {
        settingsMenu.classList.remove('open');
      }
    });
  }

  const subStepsSlider = dom.subStepsSlider;
  const subStepsValue = dom.subStepsValue;

  if (subStepsSlider && subStepsValue) {
    subStepsSlider.value = settingsState.settings.subSteps;
    subStepsValue.textContent = settingsState.settings.subSteps;

    subStepsSlider.addEventListener('input', () => {
      const value = parseInt(subStepsSlider.value);
      subStepsValue.textContent = value;
      settingsState.settings.subSteps = value;
      settingsState.settings.simDT = 0.05 / value;
      if (callbacks.saveSettings) callbacks.saveSettings();
    });
  }

  const selectBtn = dom.selectBtn;
  if (selectBtn) {
    selectBtn.addEventListener('click', () => setMode('SELECT'));
  }

  const addNodeBtn = dom.addNodeBtn;
  if (addNodeBtn) {
    addNodeBtn.addEventListener('click', () => setMode('CREATE_NODE'));
  }

  const deleteBtn = dom.deleteModeBtn;
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (editorState.mode === 'DELETE') setMode('SELECT');
      else setMode('DELETE');
    });
  }

  setupToolButton('addResistor', 'CREATE_RESISTOR');
  setupToolButton('addVoltage', 'CREATE_VOLTAGE');
  setupToolButton('addACV', 'CREATE_ACV');
  setupToolButton('addWire', 'CREATE_WIRE');
  setupToolButton('addCapacitor', 'CREATE_CAPACITOR');
  setupToolButton('addDiode', 'CREATE_DIODE');
  setupToolButton('addLED', 'CREATE_LED');
  setupToolButton('addSwitch', 'CREATE_SWITCH');
  setupToolButton('addGround', 'CREATE_GROUND');

  const newCircuitBtn = dom.newCircuitBtn;
  if (newCircuitBtn) {
    newCircuitBtn.addEventListener('click', () => {
      const hasCircuit = circuitState.nodes.length > 0 || circuitState.components.length > 0;
      if (hasCircuit) {
        const confirmed = confirm("Clear the current circuit?");
        if (!confirmed) return;
      }

      if (_pushUndoState) _pushUndoState();
      circuitState.nodes = [];
      circuitState.components = [];

      editorState.selectedObject = null;
      editorState.multiSelected = [];

      updatePropertiesBox();
      if (_saveCircuitToURL) _saveCircuitToURL();
    });
  }

  refreshSaveMenu();
}
