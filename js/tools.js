// tools.js - Drawing tool system for Fleck
import {
  generateId, distance, screenToWorld, worldToScreen,
  hitTestElement, getResizeHandles, getBoundingBox,
  isPointNearPath, isPointNearLine, pointInRect, clamp, throttle, debounce
} from './utils.js';

const PASTEL_COLORS = [
  '#fff9b1', '#f7caca', '#c8e6c9', '#bbdefb', '#d1c4e9',
  '#ffe0b2', '#b2ebf2', '#f8bbd0', '#dcedc8', '#e1bee7'
];

const MIN_SHAPE_SIZE = 5;

export class ToolManager {
  constructor(app) {
    this.app = app;
    this.currentTool = 'pen';
    this.isDrawing = false;
    this.startPoint = null;
    this.currentElement = null;
    this.selectedIds = new Set();
    this.selectionRect = null;
    this.dragState = null;
    this.resizeState = null;
    this.isPanning = false;
    this.panStart = null;
    this.spaceHeld = false;
    this.editingElement = null;
    this.editOverlay = null;
    this.lastPointerPos = { x: 0, y: 0 };

    // Touch state
    this.touches = new Map();
    this.initialPinchDist = null;
    this.initialPinchZoom = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  _onKeyDown(e) {
    if (e.code === 'Space' && !this.spaceHeld && !this.editingElement) {
      this.spaceHeld = true;
      this.app.canvas.style.cursor = 'grab';
      e.preventDefault();
    }
  }

  _onKeyUp(e) {
    if (e.code === 'Space') {
      this.spaceHeld = false;
      if (!this.isPanning) {
        this._updateCursor();
      }
    }
  }

  setTool(toolName) {
    if (this.editingElement) this.stopTextEditing();
    if (toolName === 'rect') toolName = 'rectangle';
    if (toolName === 'sticky') toolName = 'stickynote';
    this.currentTool = toolName;
    this.isDrawing = false;
    this.currentElement = null;
    this.selectionRect = null;
    if (toolName !== 'select') {
      this.selectedIds.clear();
    }
    this._updateCursor();
    this.app.updateToolUI(toolName);
    this.app.dirty = true;
  }

  _updateCursor() {
    const canvas = this.app.canvas;
    switch (this.currentTool) {
      case 'select': canvas.style.cursor = 'default'; break;
      case 'pen': canvas.style.cursor = 'crosshair'; break;
      case 'line': case 'arrow': canvas.style.cursor = 'crosshair'; break;
      case 'rectangle': case 'ellipse': case 'diamond': canvas.style.cursor = 'crosshair'; break;
      case 'text': canvas.style.cursor = 'text'; break;
      case 'stickynote': canvas.style.cursor = 'crosshair'; break;
      case 'eraser': canvas.style.cursor = 'none'; break;
      default: canvas.style.cursor = 'crosshair';
    }
  }

  // ─── Pointer Events ───────────────────────────────────────

  onPointerDown(e) {
    if (this.editingElement && this.currentTool !== 'select') return;

    const rect = this.app.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const camera = this.app.renderer.camera;
    const world = screenToWorld(screenX, screenY, camera);

    this.lastPointerPos = { x: screenX, y: screenY };

    // Middle button or space = pan
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      this.isPanning = true;
      this.panStart = { x: screenX, y: screenY };
      this.app.canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;

    this.startPoint = world;
    this.isDrawing = true;

    switch (this.currentTool) {
      case 'select': this._selectDown(world, e.shiftKey); break;
      case 'pen': this._penDown(world); break;
      case 'line': this._lineDown(world); break;
      case 'arrow': this._lineDown(world); break;
      case 'rectangle': this._shapeDown(world, 'rectangle'); break;
      case 'ellipse': this._shapeDown(world, 'ellipse'); break;
      case 'diamond': this._shapeDown(world, 'diamond'); break;
      case 'text': this._textDown(world); break;
      case 'stickynote': this._stickyDown(world); break;
      case 'eraser': this._eraserDown(world); break;
    }
  }

  onPointerMove(e) {
    const rect = this.app.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const camera = this.app.renderer.camera;
    const world = screenToWorld(screenX, screenY, camera);

    // Update coordinate display
    this.app.updateCoords(Math.round(world.x), Math.round(world.y));

    if (this.isPanning) {
      const dx = screenX - this.panStart.x;
      const dy = screenY - this.panStart.y;
      this.app.renderer.panBy(dx, dy);
      this.panStart = { x: screenX, y: screenY };
      this.app.dirty = true;
      return;
    }

    if (!this.isDrawing) {
      // Hover cursor for select tool
      if (this.currentTool === 'select') {
        const el = this.getElementAtPoint(world.x, world.y);
        if (el && this.selectedIds.has(el.id)) {
          this.app.canvas.style.cursor = 'move';
        } else if (el) {
          this.app.canvas.style.cursor = 'pointer';
        } else {
          this.app.canvas.style.cursor = 'default';
        }
      }
      this.lastPointerPos = { x: screenX, y: screenY };
      return;
    }

    switch (this.currentTool) {
      case 'select': this._selectMove(world, e.shiftKey); break;
      case 'pen': this._penMove(world); break;
      case 'line': case 'arrow': this._lineMove(world, e.shiftKey); break;
      case 'rectangle': case 'ellipse': case 'diamond': this._shapeMove(world, e.shiftKey); break;
      case 'eraser': this._eraserMove(world); break;
    }

    this.lastPointerPos = { x: screenX, y: screenY };
  }

  onPointerUp(e) {
    const rect = this.app.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const camera = this.app.renderer.camera;
    const world = screenToWorld(screenX, screenY, camera);

    if (this.isPanning) {
      this.isPanning = false;
      this._updateCursor();
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;

    switch (this.currentTool) {
      case 'select': this._selectUp(world); break;
      case 'pen': this._penUp(); break;
      case 'line': case 'arrow': this._lineUp(world); break;
      case 'rectangle': case 'ellipse': case 'diamond': this._shapeUp(); break;
      case 'eraser': this._eraserUp(); break;
    }
  }

  onDoubleClick(e) {
    const rect = this.app.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY, this.app.renderer.camera);

    const el = this.getElementAtPoint(world.x, world.y);
    if (el && (el.type === 'text' || el.type === 'stickynote')) {
      this.startTextEditing(el);
    }
  }

  onWheel(e) {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const delta = -e.deltaY;
    const zoomFactor = delta > 0 ? 1.08 : 1 / 1.08;
    const newZoom = clamp(this.app.renderer.camera.zoom * zoomFactor, 0.1, 10);

    this.app.renderer.zoomTo(newZoom, screenX, screenY);
    this.app.dirty = true;
    this.app.updateZoomUI();
  }

  // ─── Touch Events ─────────────────────────────────────────

  onTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      this.initialPinchDist = distance(
        { x: t1.clientX, y: t1.clientY },
        { x: t2.clientX, y: t2.clientY }
      );
      this.initialPinchZoom = this.app.renderer.camera.zoom;
      this.panStart = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
      };
      this.isPanning = true;
      this.isDrawing = false;
      this.currentElement = null;
    }
  }

  onTouchMove(e) {
    if (e.touches.length === 2 && this.initialPinchDist) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = distance(
        { x: t1.clientX, y: t1.clientY },
        { x: t2.clientX, y: t2.clientY }
      );
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      const rect = this.app.canvas.getBoundingClientRect();

      // Pinch zoom
      const scale = dist / this.initialPinchDist;
      const newZoom = clamp(this.initialPinchZoom * scale, 0.1, 10);
      this.app.renderer.zoomTo(newZoom, midX - rect.left, midY - rect.top);

      // Pan
      const dx = midX - this.panStart.x;
      const dy = midY - this.panStart.y;
      this.app.renderer.panBy(dx, dy);
      this.panStart = { x: midX, y: midY };

      this.app.dirty = true;
      this.app.updateZoomUI();
    }
  }

  onTouchEnd(e) {
    if (e.touches.length < 2) {
      this.initialPinchDist = null;
      this.initialPinchZoom = null;
      this.isPanning = false;
    }
  }

  // ─── SELECT TOOL ──────────────────────────────────────────

  _selectDown(world, shiftKey) {
    // Check resize handles first
    if (this.selectedIds.size === 1) {
      const elId = [...this.selectedIds][0];
      const el = this.app.elements.find(e => e.id === elId);
      if (el) {
        const handles = getResizeHandles(el);
        for (let i = 0; i < handles.length; i++) {
          if (distance(world, handles[i]) < 8 / this.app.renderer.camera.zoom) {
            this.resizeState = {
              handleIndex: i,
              startX: world.x,
              startY: world.y,
              originalBounds: { x: el.x, y: el.y, width: el.width, height: el.height }
            };
            this.resizeInitialElements = this.app.elements.map(e => structuredClone(e));
            return;
          }
        }
      }
    }

    const el = this.getElementAtPoint(world.x, world.y);

    if (el) {
      if (shiftKey) {
        if (this.selectedIds.has(el.id)) {
          this.selectedIds.delete(el.id);
        } else {
          this.selectedIds.add(el.id);
        }
      } else if (!this.selectedIds.has(el.id)) {
        this.selectedIds.clear();
        this.selectedIds.add(el.id);
      }

      // Prepare for potential dragging without prematurely pushing history
      const offsets = new Map();
      for (const id of this.selectedIds) {
        const selEl = this.app.elements.find(e => e.id === id);
        if (selEl) offsets.set(id, { dx: selEl.x - world.x, dy: selEl.y - world.y });
      }
      this.dragState = { startX: world.x, startY: world.y, elementOffsets: offsets };
      this.dragInitialElements = this.app.elements.map(e => structuredClone(e));
    } else {
      if (!shiftKey) this.selectedIds.clear();
      this.selectionRect = { x: world.x, y: world.y, width: 0, height: 0 };
    }
    this.app.dirty = true;
  }

  _selectMove(world) {
    if (this.resizeState) {
      const rs = this.resizeState;
      const el = this.app.elements.find(e => e.id === [...this.selectedIds][0]);
      if (!el) return;

      const dx = world.x - rs.startX;
      const dy = world.y - rs.startY;
      const ob = rs.originalBounds;
      const hi = rs.handleIndex;

      // 0=TL, 1=TC, 2=TR, 3=ML, 4=MR, 5=BL, 6=BC, 7=BR
      let nx = ob.x, ny = ob.y, nw = ob.width, nh = ob.height;

      if (hi === 0) { nx = ob.x + dx; ny = ob.y + dy; nw = ob.width - dx; nh = ob.height - dy; }
      else if (hi === 1) { ny = ob.y + dy; nh = ob.height - dy; }
      else if (hi === 2) { ny = ob.y + dy; nw = ob.width + dx; nh = ob.height - dy; }
      else if (hi === 3) { nx = ob.x + dx; nw = ob.width - dx; }
      else if (hi === 4) { nw = ob.width + dx; }
      else if (hi === 5) { nx = ob.x + dx; nw = ob.width - dx; nh = ob.height + dy; }
      else if (hi === 6) { nh = ob.height + dy; }
      else if (hi === 7) { nw = ob.width + dx; nh = ob.height + dy; }

      // Prevent flipping
      if (nw < MIN_SHAPE_SIZE) { nw = MIN_SHAPE_SIZE; }
      if (nh < MIN_SHAPE_SIZE) { nh = MIN_SHAPE_SIZE; }

      el.x = nx; el.y = ny; el.width = nw; el.height = nh;
      el.updatedAt = Date.now();
      this.app.dirty = true;
    } else if (this.dragState) {
      for (const id of this.selectedIds) {
        const el = this.app.elements.find(e => e.id === id);
        const off = this.dragState.elementOffsets.get(id);
        if (el && off) {
          el.x = world.x + off.dx;
          el.y = world.y + off.dy;
          el.updatedAt = Date.now();
        }
      }
      this.app.dirty = true;
    } else if (this.selectionRect) {
      this.selectionRect.width = world.x - this.selectionRect.x;
      this.selectionRect.height = world.y - this.selectionRect.y;
      this.app.dirty = true;
    }
  }

  _selectUp(world) {
    if (this.resizeState) {
      const moved = distance(this.startPoint, world) > 2;
      if (moved && this.resizeInitialElements) {
        this.app.history.push(this.resizeInitialElements);
        this.app.saveState();
      }
      this.resizeInitialElements = null;
      this.resizeState = null;
    } else if (this.dragState) {
      const moved = distance(this.startPoint, world) > 2;
      if (moved && this.dragInitialElements) {
        this.app.history.push(this.dragInitialElements);
        this.app.saveState();
      }
      this.dragInitialElements = null;
      this.dragState = null;
    } else if (this.selectionRect) {
      const sr = this.selectionRect;
      // Normalize rect
      const rx = sr.width < 0 ? sr.x + sr.width : sr.x;
      const ry = sr.height < 0 ? sr.y + sr.height : sr.y;
      const rw = Math.abs(sr.width);
      const rh = Math.abs(sr.height);

      if (rw > 2 && rh > 2) {
        const els = this.getElementsInRect({ x: rx, y: ry, width: rw, height: rh });
        for (const el of els) this.selectedIds.add(el.id);
      }
      this.selectionRect = null;
      this.app.dirty = true;
    }
  }

  // ─── PEN TOOL ─────────────────────────────────────────────

  _penDown(world) {
    this.currentElement = this.createElement('pen', world.x, world.y);
    this.currentElement.points = [{ x: 0, y: 0 }];
    this.app.dirty = true;
  }

  _penMove(world) {
    if (!this.currentElement) return;
    const el = this.currentElement;
    const px = world.x - el.x;
    const py = world.y - el.y;
    const lastPt = el.points[el.points.length - 1];
    if (distance({ x: px, y: py }, lastPt) > 2) {
      el.points.push({ x: px, y: py });
      this.app.dirty = true;
    }
  }

  _penUp() {
    if (!this.currentElement) return;
    const el = this.currentElement;
    if (el.points.length < 2) {
      this.currentElement = null;
      return;
    }
    // Simplify and compute bounding box
    if (el.points.length > 3) {
      el.points = this._simplifyPath(el.points, 1.5);
    }
    const bb = getBoundingBox(el.points.map(p => ({ x: p.x + el.x, y: p.y + el.y })));
    el.width = bb.width || 1;
    el.height = bb.height || 1;
    this.finalizeElement(el);
    this.currentElement = null;
  }

  _simplifyPath(points, tolerance) {
    if (points.length <= 2) return points;
    // Douglas-Peucker
    let maxDist = 0, maxIdx = 0;
    const first = points[0], last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
      const d = this._perpDist(points[i], first, last);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > tolerance) {
      const left = this._simplifyPath(points.slice(0, maxIdx + 1), tolerance);
      const right = this._simplifyPath(points.slice(maxIdx), tolerance);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  _perpDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return distance(p, a);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
  }

  // ─── LINE / ARROW TOOL ───────────────────────────────────

  _lineDown(world) {
    const type = this.currentTool === 'arrow' ? 'arrow' : 'line';
    this.currentElement = this.createElement(type, world.x, world.y);
    this.currentElement.points = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    this.currentElement.width = 0;
    this.currentElement.height = 0;
    this.app.dirty = true;
  }

  _lineMove(world, shiftKey) {
    if (!this.currentElement) return;
    let dx = world.x - this.currentElement.x;
    let dy = world.y - this.currentElement.y;

    if (shiftKey) {
      const angle = Math.atan2(dy, dx);
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const length = Math.sqrt(dx * dx + dy * dy);
      dx = Math.cos(snapped) * length;
      dy = Math.sin(snapped) * length;
    }

    this.currentElement.points[1] = { x: dx, y: dy };
    this.currentElement.width = Math.abs(dx);
    this.currentElement.height = Math.abs(dy);
    this.app.dirty = true;
  }

  _lineUp(world) {
    if (!this.currentElement) return;
    const el = this.currentElement;
    const len = distance(el.points[0], el.points[1]);
    if (len < MIN_SHAPE_SIZE) {
      this.currentElement = null;
      return;
    }
    this.finalizeElement(el);
    this.currentElement = null;
  }

  // ─── SHAPE TOOLS ──────────────────────────────────────────

  _shapeDown(world, type) {
    this.currentElement = this.createElement(type, world.x, world.y);
    this.currentElement.width = 0;
    this.currentElement.height = 0;
    this.app.dirty = true;
  }

  _shapeMove(world, shiftKey) {
    if (!this.currentElement) return;
    let w = world.x - this.startPoint.x;
    let h = world.y - this.startPoint.y;

    if (shiftKey) {
      const size = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w) * size;
      h = Math.sign(h) * size;
    }

    // Handle negative dimensions (dragging up-left)
    if (w < 0) {
      this.currentElement.x = this.startPoint.x + w;
      this.currentElement.width = -w;
    } else {
      this.currentElement.x = this.startPoint.x;
      this.currentElement.width = w;
    }
    if (h < 0) {
      this.currentElement.y = this.startPoint.y + h;
      this.currentElement.height = -h;
    } else {
      this.currentElement.y = this.startPoint.y;
      this.currentElement.height = h;
    }
    this.app.dirty = true;
  }

  _shapeUp() {
    if (!this.currentElement) return;
    const el = this.currentElement;
    if (el.width < MIN_SHAPE_SIZE && el.height < MIN_SHAPE_SIZE) {
      this.currentElement = null;
      return;
    }
    this.finalizeElement(el);
    this.currentElement = null;
  }

  // ─── TEXT TOOL ────────────────────────────────────────────

  _textDown(world) {
    const el = this.createElement('text', world.x, world.y);
    el.text = '';
    el.width = 200;
    el.height = 30;
    this.isDrawing = false;
    this.app.addElement(el);
    this.app.dirty = true;
    this.startTextEditing(el);
  }

  // ─── STICKY NOTE TOOL ────────────────────────────────────

  _stickyDown(world) {
    const el = this.createElement('stickynote', world.x - 100, world.y - 75);
    el.width = 200;
    el.height = 150;
    el.fillColor = PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
    el.strokeColor = 'transparent';
    el.text = '';
    this.isDrawing = false;
    this.app.addElement(el);
    this.app.history.push(this.app.elements);
    this.app.dirty = true;
    this.startTextEditing(el);
  }

  // ─── ERASER TOOL ──────────────────────────────────────────

  _eraserDown(world) {
    this.eraserInitialElements = this.app.elements.map(e => structuredClone(e));
    this.erasedAny = false;
    this._eraseAt(world);
  }

  _eraserMove(world) {
    this._eraseAt(world);
  }

  _eraserUp() {
    if (this.erasedAny && this.eraserInitialElements) {
      this.app.history.push(this.eraserInitialElements);
      this.app.saveState();
    }
    this.erasedAny = false;
    this.eraserInitialElements = null;
  }

  _eraseAt(world) {
    const toRemove = [];
    for (const el of this.app.elements) {
      if (hitTestElement(world.x, world.y, el, 12 / this.app.renderer.camera.zoom)) {
        toRemove.push(el.id);
      }
    }
    if (toRemove.length > 0) {
      this.erasedAny = true;
      for (const id of toRemove) this.app.removeElement(id);
      this.app.dirty = true;
    }
  }

  // ─── TEXT EDITING ─────────────────────────────────────────

  startTextEditing(element) {
    if (this.editingElement) this.stopTextEditing();
    this.editingElement = element;

    const camera = this.app.renderer.camera;
    const screen = worldToScreen(element.x, element.y, camera);

    const isSticky = element.type === 'stickynote';
    const baseFontSize = element.fontSize || (isSticky ? 18 : 20);
    const scaledFontSize = baseFontSize * camera.zoom;
    const padding = (isSticky ? 12 : 8) * camera.zoom;
    const lineHeight = 1.35;

    const overlay = document.createElement('div');
    overlay.contentEditable = 'true';
    overlay.className = 'text-edit-overlay';
    overlay.style.position = 'fixed';
    overlay.style.left = `${screen.x}px`;
    overlay.style.top = `${screen.y}px`;
    overlay.style.minWidth = `${Math.max(60, (element.width || 60) * camera.zoom)}px`;
    overlay.style.minHeight = `${Math.max(30, (element.height || 30) * camera.zoom)}px`;
    overlay.style.fontSize = `${scaledFontSize}px`;
    overlay.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    overlay.style.color = isSticky ? '#1e293b' : (element.strokeColor || (document.documentElement.dataset.theme === 'dark' ? '#f8fafc' : '#1e1e1e'));
    overlay.style.background = isSticky ? (element.fillColor || '#fef08a') : 'transparent';
    overlay.style.border = 'none';
    overlay.style.outline = '2px solid var(--accent, #3b82f6)';
    overlay.style.borderRadius = isSticky ? '4px' : '2px';
    overlay.style.padding = `${padding}px`;
    overlay.style.zIndex = '50';
    overlay.style.whiteSpace = 'pre-wrap';
    overlay.style.wordBreak = 'break-word';
    overlay.style.lineHeight = `${lineHeight}`;
    overlay.style.boxSizing = 'border-box';
    overlay.innerText = element.text || '';

    overlay.addEventListener('blur', () => this.stopTextEditing());
    overlay.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        overlay.blur();
      }
    });

    document.body.appendChild(overlay);
    this.editOverlay = overlay;

    requestAnimationFrame(() => {
      overlay.focus();
      // Place cursor at end
      const range = document.createRange();
      range.selectNodeContents(overlay);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
  }

  stopTextEditing() {
    if (!this.editingElement || !this.editOverlay) return;

    const text = this.editOverlay.innerText.trim();
    const el = this.editingElement;
    const camera = this.app.renderer.camera;

    if (text) {
      el.text = text;
      const isSticky = el.type === 'stickynote';
      const baseFontSize = el.fontSize || (isSticky ? 18 : 20);
      el.fontSize = baseFontSize;

      // Measure dimensions accurately from overlay
      const measuredWidth = this.editOverlay.offsetWidth / camera.zoom;
      const measuredHeight = this.editOverlay.offsetHeight / camera.zoom;

      if (!isSticky) {
        el.width = Math.max(40, measuredWidth);
        el.height = Math.max(baseFontSize * 1.35 + 16, measuredHeight);
      } else {
        el.width = Math.max(160, el.width || 160);
        el.height = Math.max(160, measuredHeight, el.height || 160);
      }

      el.updatedAt = Date.now();
      this.app.history.push(this.app.elements);
      this.app.saveState();
    } else {
      // Remove empty text elements
      this.app.removeElement(el.id);
    }

    if (this.editOverlay.parentNode) {
      this.editOverlay.parentNode.removeChild(this.editOverlay);
    }
    this.editOverlay = null;
    this.editingElement = null;
    this.app.dirty = true;
  }

  // ─── HELPERS ──────────────────────────────────────────────

  createElement(type, worldX, worldY) {
    const s = this.app.settings;
    return {
      id: generateId(),
      type,
      x: worldX,
      y: worldY,
      width: 0,
      height: 0,
      points: [],
      text: '',
      fontSize: type === 'stickynote' ? 18 : 20,
      strokeColor: s.strokeColor,
      fillColor: s.fillColor,
      strokeWidth: s.strokeWidth,
      opacity: s.opacity,
      rotation: 0,
      isSelected: false,
      isLocked: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  finalizeElement(element) {
    this.app.addElement(element);
    this.app.history.push(this.app.elements);
    this.app.saveState();
    this.app.dirty = true;
  }

  deleteSelected() {
    if (this.selectedIds.size === 0) return;
    this.app.history.push(this.app.elements);
    for (const id of this.selectedIds) {
      this.app.removeElement(id);
    }
    this.selectedIds.clear();
    this.app.saveState();
    this.app.dirty = true;
  }

  selectAll() {
    this.selectedIds.clear();
    for (const el of this.app.elements) {
      this.selectedIds.add(el.id);
    }
    this.app.dirty = true;
  }

  getElementAtPoint(worldX, worldY) {
    // Search from top (last) to bottom (first) for topmost element
    for (let i = this.app.elements.length - 1; i >= 0; i--) {
      const el = this.app.elements[i];
      if (hitTestElement(worldX, worldY, el, 8 / this.app.renderer.camera.zoom)) {
        return el;
      }
    }
    return null;
  }

  getElementsInRect(rect) {
    const results = [];
    for (const el of this.app.elements) {
      // Check if element bounding box intersects selection rect
      const elRight = el.x + (el.width || 0);
      const elBottom = el.y + (el.height || 0);
      const rRight = rect.x + rect.width;
      const rBottom = rect.y + rect.height;

      if (el.x < rRight && elRight > rect.x && el.y < rBottom && elBottom > rect.y) {
        results.push(el);
      }
    }
    return results;
  }
}
