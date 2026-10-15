/**
 * Fleck Note-Taking App - High-Performance Canvas 2D Rendering Engine
 * Handles DPI scaling, smooth pan/zoom camera transformations, dot grid,
 * subtle organic hand-drawn styling, and element drawing.
 */

import {
  clamp,
  getArrowHead,
  getResizeHandles,
  rectsIntersect,
  screenToWorld
} from './utils.js';

/**
 * Deterministic pseudo-random generator seeded by element id/string.
 * Prevents jitter/wobble from flickering across redraw frames.
 * @param {string|number} seedVal
 * @returns {() => number} Returns pseudo-random floats in [0, 1)
 */
function createSeededPRNG(seedVal) {
  let h = 0x811c9dc5;
  const str = String(seedVal ?? 'fleck-seed');
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  }
  let s = h >>> 0;

  return function prng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    if (!canvas || !canvas.getContext) {
      throw new Error('Renderer requires a valid HTML5 canvas element');
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Renderer._getDpr();
    this._wrapCache = new WeakMap();

    // Camera view state
    this.camera = { x: 0, y: 0, zoom: 1 };

    // Rendering settings
    this.theme = 'light'; // 'light' | 'dark'
    this.handDrawnStyle = true; // Enables subtle organic hand-drawn line jitter
    this.gridSpacing = 20; // World unit dot spacing
    this.showGrid = true;
    this.lastRenderedElements = [];

    // Apply initial resize
    this.resize();
  }

  // Cap the backing-store scale: 3x/4x displays multiply fill cost for no visible gain on a sketchpad.
  static _getDpr() {
    return typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  }

  /**
   * Resize canvas backing store to match layout size with devicePixelRatio scaling.
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || this.canvas.clientWidth || 800;
    const height = rect.height || this.canvas.clientHeight || 600;

    this.dpr = Renderer._getDpr();
    const pxW = Math.round(width * this.dpr);
    const pxH = Math.round(height * this.dpr);
    // Assigning width/height reallocates the bitmap even when unchanged.
    if (this.canvas.width !== pxW) this.canvas.width = pxW;
    if (this.canvas.height !== pxH) this.canvas.height = pxH;
  }

  /**
   * Clear the entire canvas with the theme background color.
   */
  clear() {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    const isDark = this.theme === 'dark';
    this.ctx.fillStyle = isDark ? '#121212' : '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.restore();
  }

  /**
   * Apply world-to-screen camera matrix to the context.
   */
  applyCameraTransform() {
    this.ctx.setTransform(
      this.dpr * this.camera.zoom,
      0,
      0,
      this.dpr * this.camera.zoom,
      this.dpr * this.camera.x,
      this.dpr * this.camera.y
    );
  }

  /**
   * Reset context transform to 1:1 pixel coordinate space.
   */
  resetTransform() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * Pan camera by screen pixel delta.
   * @param {number} dx Screen pixels X
   * @param {number} dy Screen pixels Y
   */
  panBy(dx, dy) {
    this.camera.x += dx;
    this.camera.y += dy;
  }

  /**
   * Zoom towards a screen anchor point (e.g. mouse position).
   * @param {number} newZoom Target zoom factor
   * @param {number} centerX Screen coordinate X
   * @param {number} centerY Screen coordinate Y
   */
  zoomTo(newZoom, centerX, centerY) {
    const clampedZoom = clamp(newZoom, 0.1, 10);
    if (clampedZoom === this.camera.zoom) return;

    // Find the world position currently under the anchor point
    const worldAnchorX = (centerX - this.camera.x) / this.camera.zoom;
    const worldAnchorY = (centerY - this.camera.y) / this.camera.zoom;

    this.camera.zoom = clampedZoom;
    this.camera.x = centerX - worldAnchorX * clampedZoom;
    this.camera.y = centerY - worldAnchorY * clampedZoom;
  }

  /**
   * Zoom in by 25% towards center of viewport.
   */
  zoomIn() {
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    this.zoomTo(this.camera.zoom * 1.25, width / 2, height / 2);
  }

  /**
   * Zoom out by 20% towards center of viewport.
   */
  zoomOut() {
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    this.zoomTo(this.camera.zoom / 1.25, width / 2, height / 2);
  }

  /**
   * Reset zoom factor to 1.0.
   */
  resetZoom() {
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    this.zoomTo(1.0, width / 2, height / 2);
  }

  /**
   * Return the currently visible world-space bounding box.
   * @returns {{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number}}
   */
  getVisibleBounds() {
    const screenW = this.canvas.width / this.dpr;
    const screenH = this.canvas.height / this.dpr;

    const topLeft = screenToWorld(0, 0, this.camera);
    const bottomRight = screenToWorld(screenW, screenH, this.camera);

    return {
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: bottomRight.x,
      maxY: bottomRight.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    };
  }

  /**
   * Draw dot grid pattern in world coordinates.
   * Dots adapt to theme and scale/fade with zoom to prevent visual clutter.
   */
  drawGrid() {
    if (!this.showGrid) return;

    const bounds = this.getVisibleBounds();
    const zoom = this.camera.zoom;

    // Adaptive grid step: when zooming out significantly, step dots so they don't form a solid block
    let step = this.gridSpacing;
    if (step * zoom < 10) step *= 2;
    if (step * zoom < 10) step *= 2;
    if (step * zoom < 10) step *= 2;

    // Smooth opacity fade when zoom gets very small
    const screenDotDist = step * zoom;
    let alpha = clamp((screenDotDist - 8) / 16, 0, 1);
    if (alpha <= 0.02) return;

    const isDark = this.theme === 'dark';
    const baseColor = isDark ? `rgba(255, 255, 255, ${0.14 * alpha})` : `rgba(0, 0, 0, ${0.12 * alpha})`;

    const startX = Math.floor(bounds.minX / step) * step;
    const endX = Math.ceil(bounds.maxX / step) * step;
    const startY = Math.floor(bounds.minY / step) * step;
    const endY = Math.ceil(bounds.maxY / step) * step;

    // Dot radius in world coordinates (keep screen size approx 1.2px)
    const dotRadius = Math.max(0.6, 1.1 / zoom);

    this.ctx.save();
    this.ctx.fillStyle = baseColor;
    this.ctx.beginPath();

    for (let x = startX; x <= endX; x += step) {
      for (let y = startY; y <= endY; y += step) {
        this.ctx.moveTo(x + dotRadius, y);
        this.ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      }
    }

    this.ctx.fill();
    this.ctx.restore();
  }

  /**
   * Main render method.
   * @param {Array<object>} elements All elements in the page
   * @param {Array<string>|Set<string>} [selectedIds=[]] IDs of currently selected elements
   * @param {{x: number, y: number, width: number, height: number}|null} [selectionRect=null] Drag-select rectangle
   * @param {object|null} [cursorElement=null] Element currently in progress of drawing
   */
  render(elements = [], selectedIds = [], selectionRect = null, cursorElement = null) {
    this.lastRenderedElements = elements;
    const selectedSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
    const visibleBounds = this.getVisibleBounds();

    // 1. Clear canvas
    this.clear();

    // 2. Apply camera transform
    this.applyCameraTransform();

    // 3. Draw grid
    this.drawGrid();

    // 4. Draw elements (with bounding box culling for high performance)
    const selectedElements = [];

    for (const el of elements) {
      if (!el) continue;

      // Check visibility culling
      const margin = Math.max(40, (el.strokeWidth || 2) * 4);
      const elBox = {
        x: Math.min(el.x, el.x + el.width) - margin,
        y: Math.min(el.y, el.y + el.height) - margin,
        width: Math.abs(el.width) + margin * 2,
        height: Math.abs(el.height) + margin * 2
      };

      const isVisible = rectsIntersect(elBox, {
        x: visibleBounds.minX,
        y: visibleBounds.minY,
        width: visibleBounds.width,
        height: visibleBounds.height
      });

      if (isVisible) {
        this.drawElement(el);
      }

      if (selectedSet.has(el.id)) {
        selectedElements.push(el);
      }
    }

    // 5. Draw cursor element (live preview during creation)
    if (cursorElement) {
      this.ctx.save();
      this.ctx.globalAlpha = (cursorElement.opacity ?? 1) * 0.9;
      this.drawElement(cursorElement);
      this.ctx.restore();
    }

    // 6. Draw selection highlights (dashed border + resize handles)
    for (const selEl of selectedElements) {
      this.drawSelectionBox(selEl);
    }

    // 7. Draw selection marquee rectangle if dragging
    if (selectionRect && (selectionRect.width !== 0 || selectionRect.height !== 0)) {
      this.drawSelectionMarquee(selectionRect);
    }
  }

  /**
   * Dispatch drawing to specific element renderers with rotation & opacity applied.
   * @param {object} el Element object
   */
  drawElement(el) {
    if (!el || !el.type) return;

    this.ctx.save();

    // Apply element opacity
    const opacity = typeof el.opacity === 'number' ? clamp(el.opacity, 0, 1) : 1;
    this.ctx.globalAlpha = opacity;

    // Apply rotation around element center
    if (el.rotation) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      this.ctx.translate(cx, cy);
      this.ctx.rotate(el.rotation);
      this.ctx.translate(-cx, -cy);
    }

    switch (el.type) {
      case 'pen':
        this.drawPen(el);
        break;
      case 'line':
        this.drawLine(el);
        break;
      case 'arrow':
        this.drawArrow(el);
        break;
      case 'rectangle':
        this.drawRectangle(el);
        break;
      case 'ellipse':
        this.drawEllipse(el);
        break;
      case 'diamond':
        this.drawDiamond(el);
        break;
      case 'text':
        this.drawText(el);
        break;
      case 'stickynote':
        this.drawStickyNote(el);
        break;
      default:
        console.warn(`[Fleck Renderer] Unknown element type: ${el.type}`);
    }

    this.ctx.restore();
  }

  /**
   * Draw smooth freehand path using midpoint quadratic curves.
   * @param {object} el
   */
  drawPen(el) {
    const points = el.points;
    if (!points || points.length === 0) return;

    this.ctx.save();
    this.ctx.strokeStyle = el.strokeColor || '#1e1e1e';
    this.ctx.lineWidth = el.strokeWidth || 2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    const originX = el.x;
    const originY = el.y;

    if (points.length === 1) {
      this.ctx.fillStyle = el.strokeColor || '#1e1e1e';
      this.ctx.beginPath();
      this.ctx.arc(originX + points[0].x, originY + points[0].y, (el.strokeWidth || 2) / 2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
      return;
    }

    this.ctx.beginPath();
    this.ctx.moveTo(originX + points[0].x, originY + points[0].y);

    if (points.length === 2) {
      this.ctx.lineTo(originX + points[1].x, originY + points[1].y);
    } else {
      for (let i = 1; i < points.length - 1; i++) {
        const midX = originX + (points[i].x + points[i + 1].x) / 2;
        const midY = originY + (points[i].y + points[i + 1].y) / 2;
        this.ctx.quadraticCurveTo(originX + points[i].x, originY + points[i].y, midX, midY);
      }
      const last = points[points.length - 1];
      this.ctx.lineTo(originX + last.x, originY + last.y);
    }

    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Draw straight line with subtle organic hand-drawn wobble.
   * @param {object} el
   */
  drawLine(el) {
    let p1, p2;
    if (el.points && el.points.length >= 2) {
      p1 = { x: el.x + el.points[0].x, y: el.y + el.points[0].y };
      p2 = { x: el.x + el.points[el.points.length - 1].x, y: el.y + el.points[el.points.length - 1].y };
    } else {
      p1 = { x: el.x, y: el.y };
      p2 = { x: el.x + el.width, y: el.y + el.height };
    }

    this.ctx.save();
    this.ctx.strokeStyle = el.strokeColor || '#1e1e1e';
    this.ctx.lineWidth = el.strokeWidth || 2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this._drawRoughSegment(p1.x, p1.y, p2.x, p2.y, el.id);

    this.ctx.restore();
  }

  /**
   * Draw line with arrowhead at destination.
   * @param {object} el
   */
  drawArrow(el) {
    let p1, p2;
    if (el.points && el.points.length >= 2) {
      p1 = { x: el.x + el.points[0].x, y: el.y + el.points[0].y };
      p2 = { x: el.x + el.points[el.points.length - 1].x, y: el.y + el.points[el.points.length - 1].y };
    } else {
      p1 = { x: el.x, y: el.y };
      p2 = { x: el.x + el.width, y: el.y + el.height };
    }

    this.ctx.save();
    const color = el.strokeColor || '#1e1e1e';
    const strokeWidth = el.strokeWidth || 2;
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = strokeWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    // Shaft
    this._drawRoughSegment(p1.x, p1.y, p2.x, p2.y, el.id);

    // Arrowhead
    const headSize = Math.max(14, strokeWidth * 4.5);
    const arrowPoints = getArrowHead(p1.x, p1.y, p2.x, p2.y, headSize);

    this.ctx.beginPath();
    this.ctx.moveTo(arrowPoints[0].x, arrowPoints[0].y);
    this.ctx.lineTo(arrowPoints[1].x, arrowPoints[1].y);
    this.ctx.lineTo(arrowPoints[2].x, arrowPoints[2].y);
    this.ctx.stroke();

    this.ctx.restore();
  }

  /**
   * Draw rectangle with subtle organic lines and optional fill.
   * @param {object} el
   */
  drawRectangle(el) {
    const x = el.x;
    const y = el.y;
    const w = el.width;
    const h = el.height;

    this.ctx.save();
    const strokeWidth = el.strokeWidth || 2;
    this.ctx.lineWidth = strokeWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    // Fill
    if (el.fillColor && el.fillColor !== 'transparent') {
      this.ctx.fillStyle = el.fillColor;
      this.ctx.fillRect(x, y, w, h);
    }

    // Stroke
    if (el.strokeColor && strokeWidth > 0) {
      this.ctx.strokeStyle = el.strokeColor;
      if (this.handDrawnStyle) {
        const prng = createSeededPRNG(el.id);
        const j = 1.2; // subtle jitter amount

        // Top edge
        this._drawRoughSegmentWithRng(x, y, x + w, y, prng, j);
        // Right edge
        this._drawRoughSegmentWithRng(x + w, y, x + w, y + h, prng, j);
        // Bottom edge
        this._drawRoughSegmentWithRng(x + w, y + h, x, y + h, prng, j);
        // Left edge
        this._drawRoughSegmentWithRng(x, y + h, x, y, prng, j);
      } else {
        this.ctx.strokeRect(x, y, w, h);
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw ellipse with optional fill and subtle organic contour.
   * @param {object} el
   */
  drawEllipse(el) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const rx = Math.abs(el.width) / 2;
    const ry = Math.abs(el.height) / 2;

    if (rx <= 0 || ry <= 0) return;

    this.ctx.save();
    const strokeWidth = el.strokeWidth || 2;
    this.ctx.lineWidth = strokeWidth;

    // Fill
    if (el.fillColor && el.fillColor !== 'transparent') {
      this.ctx.fillStyle = el.fillColor;
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Stroke
    if (el.strokeColor && strokeWidth > 0) {
      this.ctx.strokeStyle = el.strokeColor;
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      this.ctx.stroke();

      // Subtle organic double-stroke if hand-drawn style is on
      if (this.handDrawnStyle) {
        const prng = createSeededPRNG(el.id);
        const dRx = (prng() - 0.5) * 1.2;
        const dRy = (prng() - 0.5) * 1.2;
        this.ctx.save();
        this.ctx.globalAlpha = (this.ctx.globalAlpha || 1) * 0.45;
        this.ctx.beginPath();
        this.ctx.ellipse(cx, cy, Math.max(0.1, rx + dRx), Math.max(0.1, ry + dRy), 0, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw diamond / rhombus shape.
   * @param {object} el
   */
  drawDiamond(el) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const top = { x: cx, y: el.y };
    const right = { x: el.x + el.width, y: cy };
    const bottom = { x: cx, y: el.y + el.height };
    const left = { x: el.x, y: cy };

    this.ctx.save();
    const strokeWidth = el.strokeWidth || 2;
    this.ctx.lineWidth = strokeWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    // Fill
    if (el.fillColor && el.fillColor !== 'transparent') {
      this.ctx.fillStyle = el.fillColor;
      this.ctx.beginPath();
      this.ctx.moveTo(top.x, top.y);
      this.ctx.lineTo(right.x, right.y);
      this.ctx.lineTo(bottom.x, bottom.y);
      this.ctx.lineTo(left.x, left.y);
      this.ctx.closePath();
      this.ctx.fill();
    }

    // Stroke
    if (el.strokeColor && strokeWidth > 0) {
      this.ctx.strokeStyle = el.strokeColor;
      if (this.handDrawnStyle) {
        const prng = createSeededPRNG(el.id);
        const j = 1.2;
        this._drawRoughSegmentWithRng(top.x, top.y, right.x, right.y, prng, j);
        this._drawRoughSegmentWithRng(right.x, right.y, bottom.x, bottom.y, prng, j);
        this._drawRoughSegmentWithRng(bottom.x, bottom.y, left.x, left.y, prng, j);
        this._drawRoughSegmentWithRng(left.x, left.y, top.x, top.y, prng, j);
      } else {
        this.ctx.beginPath();
        this.ctx.moveTo(top.x, top.y);
        this.ctx.lineTo(right.x, right.y);
        this.ctx.lineTo(bottom.x, bottom.y);
        this.ctx.lineTo(left.x, left.y);
        this.ctx.closePath();
        this.ctx.stroke();
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw multi-line text with word wrapping.
   * @param {object} el
   */
  drawText(el) {
    if (!el.text) return;

    this.ctx.save();
    const fontSize = el.fontSize || 20;
    const lineHeight = fontSize * 1.35;
    this.ctx.font = `${fontSize}px 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    this.ctx.textBaseline = 'top';

    const padding = 8;
    const maxWidth = Math.max(20, (el.width || 200) - padding * 2);

    const wrappedLines = this._getWrappedLines(el, fontSize, maxWidth);

    // Background fill if requested
    if (el.fillColor && el.fillColor !== 'transparent') {
      this.ctx.fillStyle = el.fillColor;
      this.ctx.fillRect(el.x, el.y, el.width, el.height);
    }

    // Text rendering
    const isDark = this.theme === 'dark';
    this.ctx.fillStyle = el.strokeColor || (isDark ? '#f8fafc' : '#1e1e1e');
    for (let i = 0; i < wrappedLines.length; i++) {
      const lineY = el.y + padding + i * lineHeight;
      this.ctx.fillText(wrappedLines[i], el.x + padding, lineY);
    }

    this.ctx.restore();
  }

  /**
   * Word-wrap an element's text, memoized per element so measureText is not
   * re-run for every word on every frame.
   * @private
   */
  _getWrappedLines(el, fontSize, maxWidth) {
    const cached = this._wrapCache.get(el);
    if (cached && cached.text === el.text && cached.fontSize === fontSize && cached.maxWidth === maxWidth) {
      return cached.lines;
    }

    const lines = [];
    for (const rawLine of el.text.split('\n')) {
      let current = '';
      for (const word of rawLine.split(' ')) {
        const test = current ? `${current} ${word}` : word;
        if (current && this.ctx.measureText(test).width > maxWidth) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      lines.push(current);
    }

    this._wrapCache.set(el, { text: el.text, fontSize, maxWidth, lines });
    return lines;
  }

  /**
   * Draw sticky note element (post-it style with warm drop shadow and wrapped text).
   * @param {object} el
   */
  drawStickyNote(el) {
    const x = el.x;
    const y = el.y;
    const w = el.width || 160;
    const h = el.height || 160;

    this.ctx.save();

    // 1. Subtle drop shadow
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    this.ctx.fillRect(x + 3, y + 4, w, h);
    this.ctx.restore();

    // 2. Note body
    const noteColor = el.fillColor && el.fillColor !== 'transparent' ? el.fillColor : '#fef08a';
    this.ctx.fillStyle = noteColor;
    this.ctx.fillRect(x, y, w, h);

    // 3. Very subtle bottom border / fold highlight
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, w, h);

    // 4. Note text
    if (el.text) {
      const padding = 12;
      const fontSize = el.fontSize || 18;
      const lineHeight = fontSize * 1.35;
      this.ctx.font = `${fontSize}px 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.fillStyle = el.strokeColor || '#1e293b';
      this.ctx.textBaseline = 'top';

      const lines = this._getWrappedLines(el, fontSize, w - padding * 2);

      for (let i = 0; i < lines.length; i++) {
        const lineY = y + padding + i * lineHeight;
        if (lineY + lineHeight > y + h - padding) break;
        this.ctx.fillText(lines[i], x + padding, lineY);
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw dashed bounding box and 8 circular resize handles.
   * Handles scale inversely with camera zoom so they remain a comfortable size on screen.
   * @param {object} el
   */
  drawSelectionBox(el) {
    if (!el) return;

    const zoom = this.camera.zoom;
    const strokeWidth = 1.5 / zoom;
    const handleRadius = 4.5 / zoom;
    const accentColor = '#2563eb';

    this.ctx.save();

    // Rotate box if element is rotated
    if (el.rotation) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      this.ctx.translate(cx, cy);
      this.ctx.rotate(el.rotation);
      this.ctx.translate(-cx, -cy);
    }

    // Dashed outline
    this.ctx.strokeStyle = accentColor;
    this.ctx.lineWidth = strokeWidth;
    this.ctx.setLineDash([5 / zoom, 4 / zoom]);
    this.ctx.strokeRect(el.x, el.y, el.width, el.height);

    this.ctx.restore();

    // Draw handles in world space (handles array already accounts for rotation)
    const handles = getResizeHandles(el);

    this.ctx.save();
    this.ctx.fillStyle = '#ffffff';
    this.ctx.strokeStyle = accentColor;
    this.ctx.lineWidth = strokeWidth;
    this.ctx.setLineDash([]);

    for (const h of handles) {
      this.ctx.beginPath();
      this.ctx.arc(h.x, h.y, handleRadius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Draw marquee rectangle when dragging to select elements.
   * @param {{x: number, y: number, width: number, height: number}} rect
   */
  drawSelectionMarquee(rect) {
    const zoom = this.camera.zoom;
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.85)';
    this.ctx.lineWidth = 1.2 / zoom;
    this.ctx.setLineDash([4 / zoom, 3 / zoom]);

    this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    this.ctx.restore();
  }

  /**
   * Draw a subtle hand-drawn segment between two points using a seeded PRNG.
   * @private
   */
  _drawRoughSegment(x1, y1, x2, y2, seed) {
    const prng = createSeededPRNG(seed);
    this._drawRoughSegmentWithRng(x1, y1, x2, y2, prng, 1.2);
  }

  /**
   * Internal line segment drawer with slight curve and endpoint randomness (1-2px).
   * @private
   */
  _drawRoughSegmentWithRng(x1, y1, x2, y2, prng, jitter) {
    if (!this.handDrawnStyle || jitter <= 0) {
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
      return;
    }

    // Subtle endpoint offset
    const jx1 = x1 + (prng() - 0.5) * jitter;
    const jy1 = y1 + (prng() - 0.5) * jitter;
    const jx2 = x2 + (prng() - 0.5) * jitter;
    const jy2 = y2 + (prng() - 0.5) * jitter;

    // Slight midpoint bow (1-1.5px organic curve)
    const midX = (x1 + x2) / 2 + (prng() - 0.5) * (jitter * 1.2);
    const midY = (y1 + y2) / 2 + (prng() - 0.5) * (jitter * 1.2);

    this.ctx.beginPath();
    this.ctx.moveTo(jx1, jy1);
    this.ctx.quadraticCurveTo(midX, midY, jx2, jy2);
    this.ctx.stroke();
  }

  /**
   * Export the canvas as a high-resolution 2x PNG data URL without grid and selection boxes.
   * If elements exist, crops neatly to the element bounding box with padding.
   * @param {Array<object>} [elements=this.lastRenderedElements]
   * @param {string} [type='image/png']
   * @param {number} [quality=0.95]
   * @returns {string} Data URL
   */
  toDataURL(elements = this.lastRenderedElements, type = 'image/png', quality = 0.95) {
    if (!elements || elements.length === 0) {
      // Export current canvas view without selection box
      return this.canvas.toDataURL(type, quality);
    }

    // Calculate bounding box of all elements
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const el of elements) {
      const pad = (el.strokeWidth || 2) * 2;
      const elMinX = Math.min(el.x, el.x + el.width) - pad;
      const elMaxX = Math.max(el.x, el.x + el.width) + pad;
      const elMinY = Math.min(el.y, el.y + el.height) - pad;
      const elMaxY = Math.max(el.y, el.y + el.height) + pad;

      if (elMinX < minX) minX = elMinX;
      if (elMaxX > maxX) maxX = elMaxX;
      if (elMinY < minY) minY = elMinY;
      if (elMaxY > maxY) maxY = elMaxY;
    }

    if (!isFinite(minX) || !isFinite(minY)) {
      return this.canvas.toDataURL(type, quality);
    }

    const padding = 40;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const exportW = maxX - minX;
    const exportH = maxY - minY;
    const scale = 2; // High-res 2x export

    const offscreen = document.createElement('canvas');
    offscreen.width = Math.max(1, Math.round(exportW * scale));
    offscreen.height = Math.max(1, Math.round(exportH * scale));
    const offCtx = offscreen.getContext('2d');

    // Fill background
    const isDark = this.theme === 'dark';
    offCtx.fillStyle = isDark ? '#121212' : '#ffffff';
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);

    // Render elements onto offscreen canvas
    offCtx.save();
    offCtx.scale(scale, scale);
    offCtx.translate(-minX, -minY);

    // Swap context temporarily to render elements cleanly
    const originalCtx = this.ctx;
    this.ctx = offCtx;

    try {
      for (const el of elements) {
        this.drawElement(el);
      }
    } finally {
      this.ctx = originalCtx;
      offCtx.restore();
    }

    return offscreen.toDataURL(type, quality);
  }
}
