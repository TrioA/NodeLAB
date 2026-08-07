import {
  circuitState,
  editorState,
  GRID_SIZE,
  dist,
  distToSegment,
  snapToGrid,
  screenToWorld,
  getConnectionsForNode,
  getConnectedNodes
} from './utils.js';

import {
  pushUndoState,
  saveCircuitToURL,
  undo,
  redo,
  saveCircuitToLocalStorage
} from './history.js';

import {
  clearSelection,
  addToMultiSelection,
  updatePropertiesBox,
  setMode,
  getCurrentToolValue,
  showSolveError,
  dom
} from './ui.js';

// ===== Hit Testing =====
export function findNodeAt(x, y) {
  const threshold = 20;
  for (const n of circuitState.nodes) {
    if (dist(n, { x, y }) < threshold) return n;
  }
  return null;
}

export function findComponentAt(x, y) {
  for (const c of circuitState.components) {
    if (c.type === "GND") {
      const dx = x - c.n1.x;
      const dy = y - (c.n1.y + 12);
      if (Math.sqrt(dx * dx + dy * dy) < 20) {
        return c;
      }
    }
    if (distToSegment({ x, y }, c.n1, c.n2) < 16) return c;
  }
  return null;
}

// ===== Entity Modification Helpers =====
import {
  generateComponentName
} from './utils.js';

export function addNode(x, y) {
  const snapX = snapToGrid(x);
  const snapY = snapToGrid(y);
  const existing = circuitState.nodes.find(n => n.x === snapX && n.y === snapY);
  if (existing) return existing;

  pushUndoState();
  const n = {
    x: snapX,
    y: snapY,
    vx: 0,
    id: circuitState.nextId++,
    electricalNode: null,
    electricalIndex: 0,
    hasError: false
  };
  circuitState.nodes.push(n);
  saveCircuitToURL();
  return n;
}

export function addComponent(type, n1, n2, value, extra) {
  if (n1 === n2 && type !== 'GND') return;

  if (type === 'W') {
    const isDupWire = circuitState.components.some(c =>
      c.type === 'W' &&
      ((c.n1.id === n1.id && c.n2.id === n2.id) || (c.n1.id === n2.id && c.n2.id === n1.id))
    );
    if (isDupWire) return;
  }

  pushUndoState();
  const comp = {
    type,
    name: (extra && extra.name) ? extra.name : generateComponentName(type),
    n1,
    n2,
    value,
    id: circuitState.nextId++,
    current: 0,
    displayBrightness: 0,
    hasError: false,
    ledColor: '#00ff88',
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

  circuitState.components.push(comp);
  saveCircuitToURL();
}

export function deleteComponent(comp) {
  pushUndoState();
  circuitState.components = circuitState.components.filter(c => c !== comp);
  if (editorState.selectedObject === comp) {
    editorState.selectedObject = null;
    updatePropertiesBox();
  }
  saveCircuitToURL();
}

export function deleteNode(node) {
  pushUndoState();
  const connectedCount = getConnectionsForNode(node);
  if (connectedCount > 3) {
    const ok = confirm(
      `This node has ${connectedCount} components connected. Delete it and all its connections?`
    );
    if (!ok) return;
  }
  circuitState.components = circuitState.components.filter(c => c.n1 !== node && c.n2 !== node);
  circuitState.nodes = circuitState.nodes.filter(n => n !== node);
  if (editorState.selectedObject === node) {
    editorState.selectedObject = null;
    updatePropertiesBox();
  }
  saveCircuitToURL();
}

export function setGroundNode(node) {
  pushUndoState();
  const connectedNodes = getConnectedNodes(node);

  const groupGrounds = circuitState.components.filter(c =>
    c.type === 'GND' &&
    connectedNodes.includes(c.n1)
  );

  const existing = groupGrounds.find(c => c.n1 === node);

  if (existing) {
    circuitState.components = circuitState.components.filter(c => c !== existing);
    saveCircuitToURL();
    return;
  }

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

  circuitState.components.push({
    id: circuitState.nextId++,
    type: 'GND',
    n1: node,
    n2: node
  });

  saveCircuitToURL();
}

import {
  runtimeState
} from './utils.js';

// Track touch distance for pinch zoom
let initialTouchDist = 0;
let initialScale = 1;
let pointerDownPos = null;
let pointerDownOnEmpty = false;
const DRAG_THRESHOLD = 4;

export function resetInteractionState() {
  editorState.panning = false;
  editorState.draggingNode = null;
  editorState.draggingGroup = false;
  editorState.dragGroupOffsets = [];
  editorState.dragSelecting = false;
  editorState.selectionBox = null;
  initialTouchDist = 0;
  pointerDownPos = null;
  pointerDownOnEmpty = false;
}

export function initInteractions(canvasEl) {
  // Keyboard listeners
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
      editorState.ctrlPressed = true;
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      editorState.shiftPressed = true;
    }

    if (editorState.ctrlPressed && e.key === 's') {
      e.preventDefault();
      saveCircuitToLocalStorage();
      dom.saveMenu?.classList.add('open');
      dom.saveList?.classList.add('open');
    }

    if (editorState.ctrlPressed && e.key === 'o') {
      e.preventDefault();
      dom.saveMenu?.classList.add('open');
      dom.saveList?.classList.add('open');
    }

    const el = document.activeElement;
    const activeTag = el && el.tagName;
    const isEditable = el && (el.isContentEditable || activeTag === 'INPUT' || activeTag === 'TEXTAREA');

    if (e.code === 'Space' && !isEditable) {
      e.preventDefault();
      runtimeState.paused = !runtimeState.paused;
      const pauseBtn = dom.pauseBtn;
      if (pauseBtn) {
        pauseBtn.textContent = runtimeState.paused ? '▶ Resume' : '⏸ Pause';
        pauseBtn.classList.toggle('active', runtimeState.paused);
      }
      return;
    }

    if (isEditable) return;

    switch (e.code) {
      case 'Digit1':
        setMode('SELECT');
        break;
      case 'Digit2':
        setMode('CREATE_NODE');
        break;
      case 'Digit3':
        setMode('CREATE_WIRE');
        break;
      case 'Digit4':
        setMode('CREATE_GROUND');
        break;
      case 'Digit5':
        setMode('CREATE_VOLTAGE');
        break;
      case 'Digit6':
        setMode('CREATE_RESISTOR');
        break;
      case 'Digit7':
        setMode('CREATE_CAPACITOR');
        break;
      case 'Digit8':
        setMode('CREATE_DIODE');
        break;
      case 'Digit9':
        setMode('CREATE_LED');
        break;
      case 'Digit0':
        setMode('CREATE_ACV');
        break;
      case 'Delete': {
        if (editorState.multiSelected.length > 1) {
          pushUndoState();
          const nodesToDelete = editorState.multiSelected.filter(o => circuitState.nodes.includes(o));
          const compsToDelete = editorState.multiSelected.filter(o => circuitState.components.includes(o));
          const orphanedComps = circuitState.components.filter(c =>
            nodesToDelete.includes(c.n1) || nodesToDelete.includes(c.n2)
          );
          const allCompsToDelete = new Set([...compsToDelete, ...orphanedComps]);
          circuitState.components = circuitState.components.filter(c => !allCompsToDelete.has(c));
          circuitState.nodes = circuitState.nodes.filter(n => !nodesToDelete.includes(n));
          clearSelection();
          saveCircuitToURL();
          break;
        }
        const obj = editorState.selectedObject;
        if (obj) {
          if (circuitState.nodes.includes(obj)) {
            deleteNode(obj);
            clearSelection();
          } else {
            deleteComponent(obj);
            clearSelection();
          }
        } else {
          if (editorState.mode === 'DELETE') setMode('SELECT');
          else setMode('DELETE');
        }
        break;
      }
    }

    const obj = editorState.selectedObject;
    const isNode = obj && circuitState.nodes.includes(obj);
    const step = GRID_SIZE;

    const nodesToMove = editorState.multiSelected.length > 1
      ? editorState.multiSelected.filter(o => circuitState.nodes.includes(o))
      : (isNode ? [obj] : []);

    switch (e.code) {
      case 'ArrowLeft':
        if (nodesToMove.length) {
          e.preventDefault();
          for (const n of nodesToMove) n.x = snapToGrid(n.x - step);
          saveCircuitToURL();
        }
        break;
      case 'ArrowRight':
        if (nodesToMove.length) {
          e.preventDefault();
          for (const n of nodesToMove) n.x = snapToGrid(n.x + step);
          saveCircuitToURL();
        }
        break;
      case 'ArrowUp':
        if (nodesToMove.length) {
          e.preventDefault();
          for (const n of nodesToMove) n.y = snapToGrid(n.y - step);
          saveCircuitToURL();
        }
        break;
      case 'ArrowDown':
        if (nodesToMove.length) {
          e.preventDefault();
          for (const n of nodesToMove) n.y = snapToGrid(n.y + step);
          saveCircuitToURL();
        }
        break;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        redo(clearSelection);
      } else {
        undo(clearSelection);
      }
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo(clearSelection);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
      editorState.ctrlPressed = false;
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      editorState.shiftPressed = false;
    }
  });

  if (!canvasEl) return;

  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());

  // Mouse Handlers
  canvasEl.addEventListener('mousedown', (e) => {
    const rect = canvasEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    pointerDownPos = { sx, sy };

    if (e.button === 1 || e.button === 2 || editorState.mode === 'PAN') {
      editorState.panning = true;
      editorState.lastMouseX = sx;
      editorState.lastMouseY = sy;
      return;
    }

    const { x, y } = screenToWorld(sx, sy);
    const gx = snapToGrid(x);
    const gy = snapToGrid(y);

    const hitNode = findNodeAt(gx, gy);
    const hitComp = findComponentAt(gx, gy);
    pointerDownOnEmpty = !hitNode && !hitComp;

    if (editorState.mode === 'SELECT') {
      const n = hitNode;
      if (n) {
        if (editorState.shiftPressed) {
          addToMultiSelection(n);
          return;
        }
        pushUndoState();
        if (editorState.multiSelected.includes(n) && editorState.multiSelected.length > 1) {
          editorState.draggingNode = n;
          editorState.draggingGroup = true;
          editorState.dragGroupOffsets = editorState.multiSelected
            .filter(o => circuitState.nodes.includes(o))
            .map(node => ({ node, dx: node.x - n.x, dy: node.y - n.y }));
          return;
        }
        editorState.multiSelected = [];
        editorState.selectedObject = n;
        editorState.draggingNode = n;
        editorState.draggingGroup = false;
        updatePropertiesBox();
        return;
      }
      const c = hitComp;
      if (c) {
        if (editorState.shiftPressed) {
          if (c.type === 'SW') { c.closed = !c.closed; saveCircuitToURL(); }
          addToMultiSelection(c);
          return;
        }
        if (c.type === 'SW') {
          c.closed = !c.closed;
          saveCircuitToURL();
        }
        editorState.multiSelected = [];
        editorState.selectedObject = c;
        updatePropertiesBox();
        return;
      }

      if (!editorState.shiftPressed) {
        editorState.multiSelected = [];
        clearSelection();
      }

      pushUndoState();

      editorState.dragSelecting = true;
      editorState.dragSelectStartX = gx;
      editorState.dragSelectStartY = gy;

      editorState.selectionBox = {
        startX: gx,
        startY: gy,
        endX: gx,
        endY: gy
      };

      return;
    }

    if (editorState.mode === 'CREATE_NODE') {
      addNode(gx, gy);
      return;
    }

    if (editorState.mode === "CREATE_GROUND") {
      const node = findNodeAt(gx, gy);
      if (!node) return;
      addComponent("GND", node, node, 0);
      return;
    }

    if (editorState.mode === 'CREATE_RESISTOR' ||
      editorState.mode === 'CREATE_VOLTAGE' ||
      editorState.mode === 'CREATE_ACV' ||
      editorState.mode === 'CREATE_WIRE' ||
      editorState.mode === 'CREATE_CAPACITOR' ||
      editorState.mode === 'CREATE_DIODE' ||
      editorState.mode === 'CREATE_LED' ||
      editorState.mode === 'CREATE_SWITCH') {

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
      const toolType = toolMap[editorState.mode];
      const value = getCurrentToolValue(toolType);

      if (!editorState.placing || !editorState.placing.n1) {
        const extra = {};
        if (toolType === 'ACV') {
          const freqEl = document.getElementById('acvFrequency');
          extra.frequency = freqEl ? (parseFloat(freqEl.value) || 50) : 50;
        }
        editorState.placing = { type: toolType, value, n1: n, n2: null, extra };
      } else {
        editorState.placing.n2 = n;
        addComponent(editorState.placing.type, editorState.placing.n1, editorState.placing.n2, editorState.placing.value, editorState.placing.extra);
        editorState.placing = null;
      }
      return;
    }
  });

  canvasEl.addEventListener('mousemove', (e) => {
    const rect = canvasEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (editorState.panning) {
      editorState.panX += sx - editorState.lastMouseX;
      editorState.panY += sy - editorState.lastMouseY;
      editorState.lastMouseX = sx;
      editorState.lastMouseY = sy;
      return;
    }

    editorState.mouse.rawX = sx;
    editorState.mouse.rawY = sy;

    const world = screenToWorld(sx, sy);
    editorState.mouse.x = snapToGrid(world.x);
    editorState.mouse.y = snapToGrid(world.y);

    const mouseCoordsEl = dom.mouseCoords;
    if (mouseCoordsEl) {
      if (editorState.ctrlPressed) {
        mouseCoordsEl.innerText = `X: ${world.x.toFixed(2)} · Y: ${world.y.toFixed(2)}`;
      } else {
        mouseCoordsEl.innerText = `X: ${editorState.mouse.x} · Y: ${editorState.mouse.y}`;
      }
    }

    if (editorState.draggingNode) {
      if (editorState.draggingGroup && editorState.dragGroupOffsets.length > 0) {
        for (const entry of editorState.dragGroupOffsets) {
          entry.node.x = snapToGrid(editorState.mouse.x + entry.dx);
          entry.node.y = snapToGrid(editorState.mouse.y + entry.dy);
        }
      } else {
        editorState.draggingNode.x = editorState.mouse.x;
        editorState.draggingNode.y = editorState.mouse.y;
      }
    }

    if (editorState.dragSelecting && editorState.selectionBox) {
      const dx = editorState.mouse.x - editorState.dragSelectStartX;
      const dy = editorState.mouse.y - editorState.dragSelectStartY;
      if (Math.abs(dx) > GRID_SIZE / 2 || Math.abs(dy) > GRID_SIZE / 2) {
        editorState.selectionBox.endX = editorState.mouse.x;
        editorState.selectionBox.endY = editorState.mouse.y;
      }
    }
  });

  canvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();

    const rect = canvasEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const worldBefore = screenToWorld(sx, sy);
    const zoomFactor = 1.1;
    if (e.deltaY < 0) {
      editorState.scale *= zoomFactor;
    } else {
      editorState.scale /= zoomFactor;
    }

    editorState.scale = Math.max(0.2, Math.min(20, editorState.scale));

    const worldAfter = worldBefore;
    const screenAfter = {
      x: worldAfter.x * editorState.scale + editorState.panX,
      y: worldAfter.y * editorState.scale + editorState.panY
    };

    editorState.panX += sx - screenAfter.x;
    editorState.panY += sy - screenAfter.y;
  });

  canvasEl.addEventListener('mouseup', () => {
    pointerDownPos = null;
    pointerDownOnEmpty = false;

    if (editorState.draggingNode) {
      saveCircuitToURL();
    }
    editorState.draggingNode = null;
    editorState.draggingGroup = false;
    editorState.dragGroupOffsets = [];

    if (editorState.dragSelecting && editorState.selectionBox) {
      const box = editorState.selectionBox;
      const minX = Math.min(box.startX, box.endX);
      const maxX = Math.max(box.startX, box.endX);
      const minY = Math.min(box.startY, box.endY);
      const maxY = Math.max(box.startY, box.endY);

      const boxW = maxX - minX;
      const boxH = maxY - minY;

      if (boxW > GRID_SIZE || boxH > GRID_SIZE) {
        const existingSet = new Set(editorState.multiSelected);
        if (editorState.selectedObject) existingSet.add(editorState.selectedObject);

        const boxItems = [];

        for (const n of circuitState.nodes) {
          if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) {
            boxItems.push(n);
          }
        }
        for (const c of circuitState.components) {
          const cx = (c.n1.x + c.n2.x) * 0.5;
          const cy = (c.n1.y + c.n2.y) * 0.5;
          if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
            boxItems.push(c);
          }
        }

        if (editorState.shiftPressed) {
          for (const item of boxItems) existingSet.add(item);
          editorState.selectedObject = null;
          editorState.multiSelected = Array.from(existingSet);
        } else {
          editorState.selectedObject = null;
          editorState.multiSelected = boxItems;
        }

        if (editorState.multiSelected.length === 1) {
          editorState.selectedObject = editorState.multiSelected[0];
          editorState.multiSelected = [];
        }

        updatePropertiesBox();
      }

      editorState.dragSelecting = false;
      editorState.selectionBox = null;
    }
  });

  window.addEventListener('mouseup', () => {
    editorState.panning = false;
    pointerDownPos = null;
    pointerDownOnEmpty = false;
  });

  // Touch & Pointercancel support
  canvasEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = canvasEl.getBoundingClientRect();
      const sx = touch.clientX - rect.left;
      const sy = touch.clientY - rect.top;

      pointerDownPos = { sx, sy };
      const { x, y } = screenToWorld(sx, sy);
      const gx = snapToGrid(x);
      const gy = snapToGrid(y);
      pointerDownOnEmpty = !findNodeAt(gx, gy) && !findComponentAt(gx, gy);

      canvasEl.dispatchEvent(new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0
      }));
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      initialTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      initialScale = editorState.scale;
    }
  }, { passive: false });

  canvasEl.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      canvasEl.dispatchEvent(new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        buttons: 1
      }));
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const rect = canvasEl.getBoundingClientRect();
      const distNow = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

      if (initialTouchDist > 0) {
        // Pinch zoom around midpoint between fingers
        const midSx = ((t1.clientX + t2.clientX) / 2) - rect.left;
        const midSy = ((t1.clientY + t2.clientY) / 2) - rect.top;

        const worldBefore = screenToWorld(midSx, midSy);
        const scaleFactor = distNow / initialTouchDist;
        editorState.scale = Math.max(0.2, Math.min(20, initialScale * scaleFactor));

        const screenAfter = {
          x: worldBefore.x * editorState.scale + editorState.panX,
          y: worldBefore.y * editorState.scale + editorState.panY
        };

        editorState.panX += midSx - screenAfter.x;
        editorState.panY += midSy - screenAfter.y;
      }
    }
  }, { passive: false });

  canvasEl.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      canvasEl.dispatchEvent(new MouseEvent('mouseup', {}));
    }
    initialTouchDist = 0;
  });

  canvasEl.addEventListener('touchcancel', () => {
    resetInteractionState();
  });

  window.addEventListener('pointercancel', () => {
    resetInteractionState();
  });

  initToolbarDrag();
}

export function initToolbarDrag() {
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;

  const savedPos = localStorage.getItem('nodeLabToolbarPos');
  let currentX = 0;
  let currentY = 0;
  let targetX = 0;
  let targetY = 0;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let animFrameId = null;

  if (savedPos) {
    try {
      const { x, y } = JSON.parse(savedPos);
      const w = toolbar.offsetWidth || 300;
      const h = toolbar.offsetHeight || 40;
      currentX = targetX = Math.max(0, Math.min(window.innerWidth - w, x));
      currentY = targetY = Math.max(0, Math.min(window.innerHeight - h, y));
      toolbar.style.left = `${currentX}px`;
      toolbar.style.top = `${currentY}px`;
      toolbar.style.transform = 'none';
    } catch {}
  }

  function updatePosition() {
    if (!isDragging) return;

    // Direct & smooth lerp to follow cursor
    currentX += (targetX - currentX) * 0.45;
    currentY += (targetY - currentY) * 0.45;

    toolbar.style.left = `${currentX}px`;
    toolbar.style.top = `${currentY}px`;
    toolbar.style.transform = 'none';

    animFrameId = requestAnimationFrame(updatePosition);
  }

  document.addEventListener('mousedown', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('toolbar-drag-handle')) {
      isDragging = true;
      const rect = toolbar.getBoundingClientRect();
      currentX = rect.left;
      currentY = rect.top;
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      targetX = currentX;
      targetY = currentY;
      e.preventDefault();
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(updatePosition);
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const w = toolbar.offsetWidth || 300;
    const h = toolbar.offsetHeight || 40;
    const rawX = e.clientX - dragOffsetX;
    const rawY = e.clientY - dragOffsetY;
    targetX = Math.max(0, Math.min(window.innerWidth - w, rawX));
    targetY = Math.max(0, Math.min(window.innerHeight - h, rawY));
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      currentX = targetX;
      currentY = targetY;
      toolbar.style.left = `${currentX}px`;
      toolbar.style.top = `${currentY}px`;
      localStorage.setItem('nodeLabToolbarPos', JSON.stringify({ x: currentX, y: currentY }));
    }
  });
}

