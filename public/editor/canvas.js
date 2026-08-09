import {
  circuitState,
  editorState,
  settingsState,
  runtimeState,
  GRID_SIZE,
  voltageColor,
  wireVoltageColor,
  formatCurrent,
  distToSegment
} from './utils.js';

import {
  loadSettings,
  loadCircuitFromURL,
  saveCircuitToURL,
  pushUndoState,
  saveCircuitToLocalStorage,
  saveSettings,
  loadCircuitSave
} from './history.js';

import {
  COMPONENT_TYPES,
  getCircuitGroups,
  simLoop
} from './simulation.js';

import {
  dom,
  initUI,
  showSolveError,
  updatePropertiesBox,
  updateSelectedPropertiesDynamics,
  refreshSaveMenu
} from './ui.js';

import {
  initInteractions,
  findNodeAt,
  deleteNode,
  deleteComponent,
  setGroundNode
} from './interaction.js';

let canvas, ctx, width, height, stats;

function resize() {
  if (!canvas) return;
  const container = canvas.parentElement || document.body;
  width = container.clientWidth || window.innerWidth;
  height = container.clientHeight || window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawCurrentFlow(ctx2d, comp) {
  const n1 = comp.n1;
  const n2 = comp.n2;

  const I = comp.current || 0;
  const absI = Math.abs(I);

  if (absI < 1e-9) return;

  const speed = Math.log10(absI * 1000 + 1) * 28;
  const direction = Math.sign(I) || 1;

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

  if (editorState.displaySettings?.useVoltageColoring) {
    const originNode = I >= 0 ? n1 : n2;
    const originVx = originNode ? (originNode.vx || 0) : 0;
    const originCol = wireVoltageColor(originVx);
    color = `${originCol[0]}, ${originCol[1]}, ${originCol[2]}`;
  }

  const t = runtimeState.currentAnimTime * 0.001;
  const offset = (t * speed * direction) % (dashLength + gapLength);

  ctx2d.save();
  ctx2d.shadowColor = `rgba(${color}, ${alpha * 2})`;
  ctx2d.shadowBlur = 20 * Math.pow(editorState.scale, 1);
  ctx2d.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx2d.lineWidth = lineWidth / editorState.scale;
  ctx2d.setLineDash([dashLength, gapLength]);
  ctx2d.lineDashOffset = -offset;
  ctx2d.lineCap = 'round';

  ctx2d.beginPath();
  ctx2d.moveTo(n1.x, n1.y);
  ctx2d.lineTo(n2.x, n2.y);
  ctx2d.stroke();

  ctx2d.restore();
}

function drawSelectionOutline(obj) {
  const selPulse = 0.78 + 0.18 * Math.sin(runtimeState.currentAnimTime * 0.003);
  const selBlur = 8 + 6 * (Math.sin(runtimeState.currentAnimTime * 0.003) * 0.5 + 0.5);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse})`;
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = selBlur;
  ctx.lineWidth = 1.5;

  {
    const isNode = circuitState.nodes.includes(obj);

    if (isNode) {
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    } else if (obj.type === 'W') {
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.35})`;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(obj.n1.x, obj.n1.y);
      ctx.lineTo(obj.n2.x, obj.n2.y);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse})`;
      ctx.shadowBlur = selBlur;
      ctx.beginPath();
      ctx.moveTo(obj.n1.x, obj.n1.y);
      ctx.lineTo(obj.n2.x, obj.n2.y);
      ctx.stroke();
    } else if (
      obj.type === 'R' ||
      obj.type === 'POT' ||
      obj.type === 'RHEO' ||
      obj.type === 'TH' ||
      obj.type === 'LDR' ||
      obj.type === 'FUSE'
    ) {
      const mx = (obj.n1.x + obj.n2.x) / 2;
      const my = (obj.n1.y + obj.n2.y) / 2;
      const dx = obj.n2.x - obj.n1.x;
      const dy = obj.n2.y - obj.n1.y;
      const angle = Math.atan2(dy, dx);
      const rectLength = 24 + 8;
      const rectHeight = 12 + 8;

      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.45})`;
      ctx.shadowBlur = 0;
      ctx.strokeRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse})`;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = selBlur;
      ctx.strokeRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);
      ctx.restore();

      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.8})`;
      ctx.shadowBlur = 0;
      const ux = Math.cos(angle), uy = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(obj.n1.x, obj.n1.y);
      ctx.lineTo(mx - ux * rectLength / 2, my - uy * rectLength / 2);
      ctx.moveTo(obj.n2.x, obj.n2.y);
      ctx.lineTo(mx + ux * rectLength / 2, my + uy * rectLength / 2);
      if (obj.n3) {
        ctx.moveTo(obj.n3.x, obj.n3.y);
        ctx.lineTo(mx, my);
      }
      ctx.stroke();
    } else if (obj.type === 'NMOS' || obj.type === 'PMOS') {
      const mx = (obj.n1.x + (obj.n3?.x ?? obj.n2.x)) / 2;
      const my = (obj.n1.y + (obj.n3?.y ?? obj.n2.y)) / 2;
      const glowColor = obj.type === 'NMOS' ? '#00e5ff' : '#e056fd';
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.4})`;
      ctx.beginPath();
      ctx.arc(mx, my, 22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 2;
      ctx.strokeStyle = glowColor;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = selBlur;
      ctx.beginPath();
      ctx.arc(mx, my, 22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(obj.n1.x, obj.n1.y); ctx.lineTo(mx, my);
      if (obj.n2) { ctx.moveTo(obj.n2.x, obj.n2.y); ctx.lineTo(mx, my); }
      if (obj.n3) { ctx.moveTo(obj.n3.x, obj.n3.y); ctx.lineTo(mx, my); }
      ctx.stroke();
    } else if (
      obj.type === 'V' ||
      obj.type === 'ACV' ||
      obj.type === 'BAT' ||
      obj.type === 'ISRC' ||
      obj.type === 'VM' ||
      obj.type === 'AM' ||
      obj.type === 'LAMP'
    ) {
      const mx = (obj.n1.x + obj.n2.x) / 2;
      const my = (obj.n1.y + obj.n2.y) / 2;
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.4})`;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(mx, my, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse})`;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = selBlur;
      ctx.beginPath();
      ctx.arc(mx, my, 16, 0, Math.PI * 2);
      ctx.stroke();
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
      const mx = (obj.n1.x + obj.n2.x) / 2;
      const my = (obj.n1.y + obj.n2.y) / 2;
      const dx = obj.n2.x - obj.n1.x;
      const dy = obj.n2.y - obj.n1.y;
      const angle = Math.atan2(dy, dx);
      const rectLength = 24 + 6;
      const rectHeight = 12 + 6;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(46, 204, 113, ${selPulse * 0.45})`;
      ctx.shadowBlur = 0;
      ctx.strokeRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(46, 204, 113, ${selPulse})`;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = selBlur;
      ctx.strokeRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);
      ctx.restore();
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
    } else if (obj.type === 'LED' || obj.type === 'D' || obj.type === 'SW' || obj.type === 'RELAY') {
      const mx = (obj.n1.x + obj.n2.x) / 2;
      const my = (obj.n1.y + obj.n2.y) / 2;
      const dx = obj.n2.x - obj.n1.x;
      const dy = obj.n2.y - obj.n1.y;
      const angle = Math.atan2(dy, dx);
      const rectLength = obj.type === 'RELAY' ? 36 : 28;
      const rectHeight = obj.type === 'RELAY' ? 28 : 24;

      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse * 0.4})`;
      ctx.shadowBlur = 0;
      ctx.strokeRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(0, 229, 255, ${selPulse})`;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = selBlur;
      ctx.strokeRect(-rectLength / 2, -rectHeight / 2, rectLength, rectHeight);
      ctx.restore();
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
  }

  ctx.restore();
}

function draw() {
  if (stats) stats.begin();

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(editorState.panX, editorState.panY);
  ctx.scale(editorState.scale, editorState.scale);

  let hoveredComp = null;
  let hoveredNode = null;
  let hoveredGroup = null;

  if (editorState.ctrlPressed) {
    for (const c of circuitState.components) {
      if (distToSegment({ x: editorState.mouse.x, y: editorState.mouse.y }, c.n1, c.n2) < 10) {
        hoveredComp = c;
        break;
      }
    }
    if (!hoveredComp) hoveredNode = findNodeAt(editorState.mouse.x, editorState.mouse.y);
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
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1 / editorState.scale;

  ctx.beginPath();
  const worldLeft = -editorState.panX / editorState.scale;
  const worldTop = -editorState.panY / editorState.scale;
  const worldRight = (width - editorState.panX) / editorState.scale;
  const worldBottom = (height - editorState.panY) / editorState.scale;

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

  // Selection box
  if (editorState.selectionBox) {
    const b = editorState.selectionBox;
    const sx = Math.min(b.startX, b.endX);
    const sy = Math.min(b.startY, b.endY);
    const ex = Math.max(b.startX, b.endX);
    const ey = Math.max(b.startY, b.endY);

    ctx.save();
    ctx.strokeStyle = 'rgba(0,229,255,0.9)';
    ctx.fillStyle = 'rgba(0,229,255,0.12)';
    ctx.lineWidth = 1 / editorState.scale;
    ctx.fillRect(sx, sy, ex - sx, ey - sy);
    ctx.strokeRect(sx, sy, ex - sx, ey - sy);
    ctx.restore();
  }

  // Group highlight
  if (hoveredGroup) {
    const hoverPulse = 0.22 + 0.05 * Math.sin(runtimeState.currentAnimTime * 0.003);
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

  const ds = editorState.displaySettings;

  // Component lines & leads
  for (const c of circuitState.components) {
    const current = c.current || 0;
    const absI = Math.abs(current);
    const glowIntensity = absI < 1e-9 ? 0 : Math.min(1, Math.log10(absI * 1000 + 1) * 0.35);
    const shadowBlur = (absI < 1e-9 ? 2 : 4 + glowIntensity * 16) * editorState.scale;
    const glowAlpha = absI < 1e-9 ? 0.25 : Math.min(1, 0.4 + glowIntensity * 0.6);

    let strokeStyle = '#78909c';
    let glowColor = `rgba(120, 144, 156, ${glowAlpha})`;

    if (ds.useVoltageColoring) {
      const grad = ctx.createLinearGradient(
        c.n1.x,
        c.n1.y,
        c.n2.x,
        c.n2.y
      );
      let col1 = wireVoltageColor(c.n1.vx);
      let col2 = wireVoltageColor(c.n2.vx);
      grad.addColorStop(0, `rgb(${col1[0]}, ${col1[1]}, ${col1[2]})`);
      grad.addColorStop(1, `rgb(${col2[0]}, ${col2[1]}, ${col2[2]})`);
      strokeStyle = grad;

      const originNode = current >= 0 ? c.n1 : c.n2;
      const originVx = originNode ? (originNode.vx || 0) : 0;
      const originCol = wireVoltageColor(originVx);
      glowColor = `rgba(${originCol[0]}, ${originCol[1]}, ${originCol[2]}, ${glowAlpha})`;
    }

    ctx.shadowBlur = shadowBlur;
    ctx.shadowColor = glowColor;

    ctx.strokeStyle = c.hasError ? '#e74c3c' : strokeStyle;
    ctx.lineWidth = c.hasError ? 3 : 2;

    if (c.type === 'W') {
      ctx.beginPath();
      ctx.moveTo(c.n1.x, c.n1.y);
      ctx.lineTo(c.n2.x, c.n2.y);
      ctx.stroke();
    } else if (c.type === 'GND') {
      ctx.beginPath();
      ctx.moveTo(c.n1.x, c.n1.y);
      ctx.lineTo(c.n1.x, c.n1.y + 12);
      ctx.stroke();
    } else {
      const dx = c.n2.x - c.n1.x;
      const dy = c.n2.y - c.n1.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const mx = (c.n1.x + c.n2.x) / 2;
      const my = (c.n1.y + c.n2.y) / 2;

      let bodyRadius = 17;
      if (c.type === 'V') bodyRadius = 10;
      else if (c.type === 'ACV') bodyRadius = 12;
      else if (c.type === 'BAT') bodyRadius = 10;
      else if (c.type === 'ISRC' || c.type === 'VM' || c.type === 'AM' || c.type === 'LAMP') bodyRadius = 14;
      else if (c.type === 'C') bodyRadius = 6;
      else if (c.type === 'D' || c.type === 'LED') bodyRadius = 12;
      else if (c.type === 'SW') bodyRadius = 12;
      else if (c.type === 'FUSE') bodyRadius = 13;
      else if (c.type === 'RELAY') bodyRadius = 17;

      const lead1EndX = mx - ux * bodyRadius;
      const lead1EndY = my - uy * bodyRadius;
      const lead2StartX = mx + ux * bodyRadius;
      const lead2StartY = my + uy * bodyRadius;

      ctx.beginPath();
      ctx.moveTo(c.n1.x, c.n1.y);
      ctx.lineTo(lead1EndX, lead1EndY);
      ctx.moveTo(lead2StartX, lead2StartY);
      ctx.lineTo(c.n2.x, c.n2.y);
      if (c.n3) {
        ctx.moveTo(c.n3.x, c.n3.y);
        ctx.lineTo(mx, my);
      }
      ctx.stroke();
    }
  }

  // Current flow animation
  const shouldShowFlow = ds.showCurrentFlow === 'always' || (ds.showCurrentFlow === 'ctrl' && editorState.ctrlPressed);
  if (shouldShowFlow) {
    for (const c of circuitState.components) {
      drawCurrentFlow(ctx, c);
    }
  }

  // Nodes
  for (const n of circuitState.nodes) {
    let maxI = 0;
    let originVx = n.vx || 0;

    for (const c of circuitState.components) {
      const cI = c.current || 0;
      const absCI = Math.abs(cI);
      if (c.n1 === n || c.n2 === n) {
        if (absCI > maxI) {
          maxI = absCI;
          if (c.n2 === n && cI > 0) {
            originVx = c.n1.vx || 0;
          } else if (c.n1 === n && cI < 0) {
            originVx = c.n2.vx || 0;
          } else {
            originVx = n.vx || 0;
          }
        }
      }
    }

    const nodeGlowIntensity = maxI < 1e-9 ? 0 : Math.min(1, Math.log10(maxI * 1000 + 1) * 0.35);
    const nodeShadowBlur = (maxI < 1e-9 ? 2 : 5 + nodeGlowIntensity * 18) * editorState.scale;
    const nodeGlowAlpha = maxI < 1e-9 ? 0.25 : 0.45 + nodeGlowIntensity * 0.55;

    let color = '#b0bec5';
    let nodeGlowColor = `rgba(176, 190, 197, ${nodeGlowAlpha})`;

    if (ds.useVoltageColoring) {
      color = n.hasError ? '#e74c3c' : (n.vx !== undefined ? voltageColor(n.vx) : '#fff');
      const originCol = wireVoltageColor(originVx);
      nodeGlowColor = `rgba(${originCol[0]}, ${originCol[1]}, ${originCol[2]}, ${nodeGlowAlpha})`;
    }

    ctx.shadowBlur = nodeShadowBlur;
    ctx.shadowColor = nodeGlowColor;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (ds.showNodeVoltages) {
      ctx.fillStyle = n.hasError ? '#e74c3c' : '#eee';
      ctx.font = '12px monospace';
      ctx.fillText(`V=${n.vx?.toFixed(2) ?? '-'}V`, n.x + 10, n.y - 10);
    }
  }

  // Component symbols + error halo + labels
  for (const c of circuitState.components) {
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

    // Component Name & Value Stacked Labels
    if (c.type !== 'GND') {
      const mx = (c.n1.x + c.n2.x) / 2;
      const my = (c.n1.y + c.n2.y) / 2;

      ctx.save();
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      if (c.type === 'W') {
        if (ds.showWireCurrents) {
          ctx.fillStyle = '#00e5ff';
          ctx.fillText(formatCurrent(c.current || 0), mx, my - 6);
        }
      } else {
        ctx.fillStyle = '#eee';
        let valStr = `${c.value}`;
        if (c.type === 'R') valStr += 'Ω';
        else if (c.type === 'POT') valStr = `${c.value}Ω (${Math.round((c.wiper !== undefined ? c.wiper : 0.5) * 100)}%)`;
        else if (c.type === 'RHEO') valStr = `${c.value}Ω (${Math.round((c.wiper !== undefined ? c.wiper : 0.5) * 100)}%)`;
        else if (c.type === 'NMOS') valStr = `Vth=${c.vth ?? 1.5}V (${c.operatingRegion || 'Active'})`;
        else if (c.type === 'PMOS') valStr = `Vth=${c.vth ?? -1.5}V (${c.operatingRegion || 'Active'})`;
        else if (c.type === 'BAT') valStr = `${c.value}V`;
        else if (c.type === 'ISRC') valStr = `${c.value}A`;
        else if (c.type === 'VM') valStr = `${(c.n1.vx != null && c.n2.vx != null ? Math.abs(c.n1.vx - c.n2.vx) : 0).toFixed(2)}V`;
        else if (c.type === 'AM') valStr = formatCurrent(c.current || 0);
        else if (c.type === 'FUSE') valStr = `${c.value}A${c.blown ? ' (BLOWN)' : ''}`;
        else if (c.type === 'LAMP') valStr = `${c.value}Ω${c.power ? ' ' + c.power.toFixed(1) + 'W' : ''}`;
        else if (c.type === 'TH') valStr = `${c.temperature !== undefined ? c.temperature : 25}°C`;
        else if (c.type === 'LDR') valStr = `${Math.round((c.lightLevel !== undefined ? c.lightLevel : 0.5) * 100)}% light`;
        else if (c.type === 'RELAY') valStr = `${c.value}V (${c.isEnergized ? 'ON' : 'OFF'})`;
        else if (c.type === 'C') valStr += 'F';
        else if (c.type === 'V') valStr += 'V';
        else if (c.type === 'ACV') valStr = `${c.value}V ${c.frequency || 50}Hz`;
        else if (c.type === 'D' || c.type === 'LED') valStr += 'V';

        if (ds.showComponentNames && ds.showComponentValues) {
          ctx.fillText(c.name || `${c.type}${c.id}`, mx, my - 18);
          ctx.fillText(valStr, mx, my - 6);
        } else if (ds.showComponentNames) {
          ctx.fillText(c.name || `${c.type}${c.id}`, mx, my - 6);
        } else if (ds.showComponentValues) {
          ctx.fillText(valStr, mx, my - 6);
        }
      }
      ctx.restore();
    }
  }

  // Selection halo
  const renderedSelection = new Set();

  if (editorState.selectedObject) {
    drawSelectionOutline(editorState.selectedObject);
    renderedSelection.add(editorState.selectedObject);
  }

  for (const obj of editorState.multiSelected) {
    if (renderedSelection.has(obj)) continue;
    drawSelectionOutline(obj);
  }

  updateSelectedPropertiesDynamics();

  // Ctrl hover halo
  if (editorState.ctrlPressed) {
    const hPulse = 0.55 + 0.2 * Math.sin(runtimeState.currentAnimTime * 0.003);
    const hBlur = 3 + 3 * (Math.sin(runtimeState.currentAnimTime * 0.003) * 0.5 + 0.5);
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
      } else if (c.type === 'R' || c.type === 'POT' || c.type === 'TH' || c.type === 'LDR' || c.type === 'FUSE') {
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
      } else if (
        c.type === 'V' ||
        c.type === 'ACV' ||
        c.type === 'BAT' ||
        c.type === 'ISRC' ||
        c.type === 'VM' ||
        c.type === 'AM' ||
        c.type === 'LAMP' ||
        c.type === 'LED' ||
        c.type === 'D' ||
        c.type === 'SW' ||
        c.type === 'RELAY'
      ) {
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
  if (editorState.activeTool && editorState.placing && editorState.placing.n1) {
    ctx.strokeStyle = '#666';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(editorState.placing.n1.x, editorState.placing.n1.y);
    ctx.lineTo(editorState.mouse.x, editorState.mouse.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Tooltip
  const tooltipEl = dom.tooltipBox;
  if (tooltipEl) {
    if (editorState.ctrlPressed && (hoveredComp || hoveredNode)) {
      tooltipEl.style.display = 'flex';
      tooltipEl.style.left = `${editorState.mouse.rawX + 15}px`;
      tooltipEl.style.top = `${editorState.mouse.rawY + 15}px`;
      if (hoveredComp) {
        const c = hoveredComp;
        const def = COMPONENT_TYPES[c.type];
        const label = c.type === 'W' ? 'Wire' : (def ? def.label : 'Component');

        let settingsHtml = '';
        let resHtml = '';
        if (c.type === 'R') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Setting:</span><span class="tooltip-val">${c.value} Ω</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Resistance:</span><span class="tooltip-val">${c.value} Ω</span></div>`;
        } else if (c.type === 'POT') {
          const wiperPct = Math.round((c.wiper !== undefined ? c.wiper : 0.5) * 100);
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Total R:</span><span class="tooltip-val">${c.value} Ω</span></div><div class="tooltip-row"><span class="tooltip-label">Wiper:</span><span class="tooltip-val">${wiperPct}%</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Effective R:</span><span class="tooltip-val">${(c.effectiveResistance || c.value * 0.5).toFixed(1)} Ω</span></div>`;
        } else if (c.type === 'BAT') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Voltage:</span><span class="tooltip-val">${c.value} V</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-val">DC Battery</span></div>`;
        } else if (c.type === 'ISRC') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Current:</span><span class="tooltip-val">${c.value} A</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-val">Ideal Current Source</span></div>`;
        } else if (c.type === 'VM') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Impedance:</span><span class="tooltip-val">${c.value || 1e9} Ω</span></div>`;
          const vmVolt = (c.n1.vx != null && c.n2.vx != null ? Math.abs(c.n1.vx - c.n2.vx) : 0).toFixed(2);
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Reading:</span><span class="tooltip-val" style="color:#00e5ff;">${vmVolt} V</span></div>`;
        } else if (c.type === 'AM') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Shunt:</span><span class="tooltip-val">${c.value || 0.001} Ω</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Reading:</span><span class="tooltip-val" style="color:#2ecc71;">${formatCurrent(c.current || 0)}</span></div>`;
        } else if (c.type === 'FUSE') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Rating:</span><span class="tooltip-val">${c.value} A</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Status:</span><span class="tooltip-val" style="color:${c.blown ? '#e74c3c' : '#2ecc71'};">${c.blown ? 'BLOWN / OPEN' : 'INTACT'}</span></div>`;
        } else if (c.type === 'LAMP') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Resistance:</span><span class="tooltip-val">${c.value} Ω</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Power:</span><span class="tooltip-val" style="color:#f39c12;">${(c.power || 0).toFixed(2)} W</span></div>`;
        } else if (c.type === 'TH') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Temp:</span><span class="tooltip-val">${c.temperature !== undefined ? c.temperature : 25} °C</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">R(T):</span><span class="tooltip-val">${(c.effectiveResistance || c.value || 10000).toFixed(1)} Ω</span></div>`;
        } else if (c.type === 'LDR') {
          const lPct = Math.round((c.lightLevel !== undefined ? c.lightLevel : 0.5) * 100);
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Light:</span><span class="tooltip-val">${lPct}%</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">R(light):</span><span class="tooltip-val">${(c.effectiveResistance || 10000).toFixed(1)} Ω</span></div>`;
        } else if (c.type === 'RELAY') {
          settingsHtml = `<div class="tooltip-row"><span class="tooltip-label">Threshold:</span><span class="tooltip-val">${c.value || c.threshold || 3} V</span></div>`;
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">State:</span><span class="tooltip-val" style="color:${c.isEnergized ? '#2ecc71' : '#888'};">${c.isEnergized ? 'ENERGIZED (CLOSED)' : 'DE-ENERGIZED (OPEN)'}</span></div>`;
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
        } else if (c.type === 'SW') {
          resHtml = `<div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-val">Switch (${c.closed ? 'CLOSED' : 'OPEN'})</span></div>`;
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
        for (const c of circuitState.components) {
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

  const modeText = editorState.mode === 'SELECT' ? 'Select' :
    editorState.mode === 'DELETE' ? 'Delete' :
      editorState.mode === 'CREATE_NODE' ? 'Node' :
        editorState.mode === 'CREATE_RESISTOR' ? 'Resistor' :
          editorState.mode === 'CREATE_VOLTAGE' ? 'Voltage' :
            editorState.mode === 'CREATE_WIRE' ? 'Wire' :
              (editorState.activeTool || 'Select');
  let infoText = `Nodes: ${circuitState.nodes.length} | Components: ${circuitState.components.length} | Mode: ${modeText}`;
  if (editorState.multiSelected.length > 1) {
    const nodeCount = editorState.multiSelected.filter(o => circuitState.nodes.includes(o)).length;
    const compCount = editorState.multiSelected.filter(o => circuitState.components.includes(o)).length;
    infoText += ` | Selected: ${editorState.multiSelected.length} (${nodeCount} nodes, ${compCount} comps)`;
  } else if (editorState.ctrlPressed && hoveredComp) {
    const label = hoveredComp.type === 'W'
      ? 'Wire'
      : COMPONENT_TYPES[hoveredComp.type].label;
    infoText += ` | Current: ${label} = ${formatCurrent(hoveredComp.current || 0)}`;
  }
  const infoEl = dom.info;
  if (infoEl) infoEl.textContent = infoText;

  if (stats) stats.end();
  ctx.restore();
  requestAnimationFrame(draw);
}

// ===== Application Bootstrapper =====
function init() {
  canvas = dom.canvas;
  if (!canvas) return;

  ctx = canvas.getContext('2d');

  if (window.Stats) {
    stats = new window.Stats();
    stats.showPanel(0);
    document.body.appendChild(stats.dom);
    stats.dom.style.position = "fixed";
    stats.dom.style.left = "auto";
    stats.dom.style.right = "10px";
    stats.dom.style.bottom = "10px";
    stats.dom.style.top = "auto";
  }

  window.addEventListener('resize', resize);
  resize();

  // Initial Fade
  const initialFade = dom.initialFade;
  if (initialFade && window.location.href.split("?").length >= 1) {
    if (window.location.href.includes("?from=home")) {
      setTimeout(() => {
        initialFade.style.opacity = "0";
        setTimeout(() => {
          initialFade.remove();
        }, 2000);
      }, 500);
    } else {
      initialFade.remove();
    }
  }

  // 1. Load saved settings first so displaySettings and simulation parameters are restored
  loadSettings(() => {
    const subStepsSlider = dom.subStepsSlider;
    const subStepsValue = dom.subStepsValue;
    if (subStepsSlider && subStepsValue) {
      subStepsSlider.value = settingsState.settings.subSteps;
      subStepsValue.textContent = settingsState.settings.subSteps;
    }
  });

  // 2. Initialize UI & Interactions (checkboxes will read the restored settings)
  initUI({
    pushUndoState,
    saveCircuitToURL,
    deleteNode,
    deleteComponent,
    setGroundNode,
    saveCircuitToLocalStorage,
    loadCircuitSave,
    saveSettings
  });

  initInteractions(canvas);

  loadCircuitFromURL();
  simLoop(showSolveError);
  draw();
}

// Start application
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
