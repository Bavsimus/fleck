// app.js - Main application controller for Fleck
import { generateId, debounce, clamp, screenToWorld, worldToScreen, distance } from './utils.js';
import { History } from './history.js';
import { Storage } from './storage.js';
import { Renderer } from './renderer.js';
import { ToolManager } from './tools.js';

export class App {
  constructor() {
    this.canvas = null;
    this.renderer = null;
    this.toolManager = null;
    this.history = new History(60);
    this.storage = new Storage();
    this.elements = [];
    this.pages = [];
    this.activePage = null;
    this._dirty = false;
    this._frameRequested = false;
    this._lastMinimapAt = 0;
    this._minimapTimer = 0;
    this._coordsFrame = 0;
    this._lastStyleEdit = { key: '', at: 0 };
    this.clipboard = [];
    this.contextMenuPos = { x: 0, y: 0 };
    this.minimapVisible = true;

    this.settings = {
      strokeColor: '#e2e8f0',
      fillColor: 'transparent',
      strokeWidth: 2,
      opacity: 1
    };

    this._saveDebounced = debounce(() => this._doSave(), 500);
  }

  // Setting `dirty = true` schedules exactly one frame; nothing runs while idle.
  get dirty() {
    return this._dirty;
  }

  set dirty(value) {
    this._dirty = !!value;
    if (this._dirty) this._requestFrame();
  }

  _requestFrame() {
    if (this._frameRequested) return;
    this._frameRequested = true;
    requestAnimationFrame(() => this._renderLoop());
  }

  init() {
    // 1. Load persisted data
    const data = this.storage.load();
    this.pages = data.pages && data.pages.length > 0 ? data.pages : [
      {
        id: generateId(),
        name: 'Untitled Note',
        elements: [],
        camera: { x: 0, y: 0, zoom: 1 },
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];

    this.activePage = this.pages.find(p => p.id === data.activePageId) || this.pages[0];
    this.elements = this.activePage.elements || [];

    // 2. Setup theme
    const savedTheme = data.theme || document.documentElement.getAttribute('data-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Default stroke color to match theme if not customized
    if (data.settings) {
      Object.assign(this.settings, data.settings);
    } else if (savedTheme === 'light') {
      this.settings.strokeColor = '#1e293b';
    } else {
      this.settings.strokeColor = '#e2e8f0';
    }
    if (!/^#[0-9a-f]{6}$/i.test(this.settings.strokeColor)) {
      this.settings.strokeColor = savedTheme === 'light' ? '#1e293b' : '#e2e8f0';
    }
    if (
      this.settings.fillColor !== 'transparent' &&
      !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(this.settings.fillColor)
    ) {
      this.settings.fillColor = 'transparent';
    }
    if (!Number.isFinite(this.settings.strokeWidth) || this.settings.strokeWidth <= 0) {
      this.settings.strokeWidth = 2;
    }
    if (!Number.isFinite(this.settings.opacity)) {
      this.settings.opacity = 1;
    }
    this.settings.opacity = clamp(this.settings.opacity, 0, 1);

    // 3. Set up canvas and renderer
    this.canvas = document.getElementById('canvas');
    this.renderer = new Renderer(this.canvas);
    this.renderer.theme = savedTheme;

    // Restore camera
    if (this.activePage.camera) {
      this.renderer.camera = { ...this.activePage.camera };
    }

    // 4. Set up tools
    this.toolManager = new ToolManager(this);
    this.toolManager.setTool('pen');

    // 5. Setup Minimap Canvas
    this.minimapCanvas = document.getElementById('minimap-canvas');
    if (this.minimapCanvas) {
      this.minimapCtx = this.minimapCanvas.getContext('2d');
    }
    this.minimapViewport = document.getElementById('minimap-viewport');

    // 6. Bind UI components
    this.bindEvents();
    this.bindToolbar();
    this.bindProperties();
    this.bindContextMenu();
    this.bindModals();
    this.bindKeyboard();

    // 7. Initial UI Sync
    this.updateStyleUI();
    this.updatePagesUI();
    this.updateZoomUI();
    this.setTheme(savedTheme, false);
    this._checkEmptyState();

    // 8. Start render loop
    this._renderLoop();

    // 9. Handle resize (coalesced to one per frame)
    let resizeQueued = false;
    window.addEventListener('resize', () => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        this.renderer.resize();
        this.dirty = true;
      });
    });

    // 10. Flush pending saves when the window is hidden or closed
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._flushSave();
    });
    window.addEventListener('pagehide', () => this._flushSave());

    console.log('Fleck drawing app initialized successfully ✨');
  }

  // ─── Render Loop ──────────────────────────────────────────

  _renderLoop() {
    this._frameRequested = false;
    if (!this._dirty) return;
    this._dirty = false;

    this.renderer.render(
      this.elements,
      this.toolManager.selectedIds,
      this.toolManager.selectionRect,
      this.toolManager.currentElement
    );
    this._scheduleMinimap();
  }

  // The minimap walks every element, so refresh it at most ~7 times a second.
  _scheduleMinimap() {
    if (!this.minimapVisible || !this.minimapCtx) return;
    const wait = 150 - (performance.now() - this._lastMinimapAt);
    if (wait <= 0) {
      this._lastMinimapAt = performance.now();
      this.updateMinimap();
    } else if (!this._minimapTimer) {
      this._minimapTimer = setTimeout(() => {
        this._minimapTimer = 0;
        this._lastMinimapAt = performance.now();
        this.updateMinimap();
      }, wait);
    }
  }

  // ─── Minimap ──────────────────────────────────────────────

  updateMinimap() {
    if (!this.minimapCanvas || !this.minimapCtx || !this.minimapVisible) return;

    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;

    ctx.clearRect(0, 0, w, h);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.fillStyle = isDark ? '#18191c' : '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    // Calculate bounding box of all elements and current camera viewport
    const visibleBounds = this.renderer.getVisibleBounds();

    let minX = Math.min(-600, visibleBounds.minX);
    let maxX = Math.max(600, visibleBounds.maxX);
    let minY = Math.min(-400, visibleBounds.minY);
    let maxY = Math.max(400, visibleBounds.maxY);

    for (const el of this.elements) {
      const elX2 = el.x + (el.width || 0);
      const elY2 = el.y + (el.height || 0);
      minX = Math.min(minX, el.x, elX2);
      maxX = Math.max(maxX, el.x, elX2);
      minY = Math.min(minY, el.y, elY2);
      maxY = Math.max(maxY, el.y, elY2);
    }

    const pad = 100;
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;

    const worldW = maxX - minX || 1;
    const worldH = maxY - minY || 1;

    const scaleX = w / worldW;
    const scaleY = h / worldH;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (w - worldW * scale) / 2;
    const offsetY = (h - worldH * scale) / 2;

    const toMiniX = (wx) => offsetX + (wx - minX) * scale;
    const toMiniY = (wy) => offsetY + (wy - minY) * scale;

    // Draw elements thumbnail
    ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.35)';
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 1;

    for (const el of this.elements) {
      const mx = toMiniX(el.x);
      const my = toMiniY(el.y);
      const mw = Math.max(2, (el.width || 4) * scale);
      const mh = Math.max(2, (el.height || 4) * scale);

      if (el.type === 'pen' && el.points && el.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(toMiniX(el.x + el.points[0].x), toMiniY(el.y + el.points[0].y));
        for (let i = 1; i < el.points.length; i++) {
          ctx.lineTo(toMiniX(el.x + el.points[i].x), toMiniY(el.y + el.points[i].y));
        }
        ctx.stroke();
      } else if (el.type === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(mx + mw / 2, my + mh / 2, Math.max(1, mw / 2), Math.max(1, mh / 2), 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(mx, my, mw, mh);
      }
    }

    // Update viewport indicator
    if (this.minimapViewport) {
      const vx = toMiniX(visibleBounds.minX);
      const vy = toMiniY(visibleBounds.minY);
      const vw = (visibleBounds.maxX - visibleBounds.minX) * scale;
      const vh = (visibleBounds.maxY - visibleBounds.minY) * scale;

      this.minimapViewport.style.left = `${Math.max(0, Math.min(w, vx))}px`;
      this.minimapViewport.style.top = `${Math.max(0, Math.min(h, vy))}px`;
      this.minimapViewport.style.width = `${Math.max(6, Math.min(w, vw))}px`;
      this.minimapViewport.style.height = `${Math.max(6, Math.min(h, vh))}px`;
    }
  }

  // ─── Event Binding ────────────────────────────────────────

  bindEvents() {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (e) => {
      this.closeContextMenu();
      canvas.setPointerCapture(e.pointerId);
      this.toolManager.onPointerDown(e);
    });

    canvas.addEventListener('pointermove', (e) => {
      this.toolManager.onPointerMove(e);
    });

    canvas.addEventListener('pointerup', (e) => {
      this.toolManager.onPointerUp(e);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    });

    canvas.addEventListener('dblclick', (e) => {
      this.toolManager.onDoubleClick(e);
    });

    canvas.addEventListener('wheel', (e) => {
      this.toolManager.onWheel(e);
    }, { passive: false });

    // Touch support
    canvas.addEventListener('touchstart', (e) => this.toolManager.onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.toolManager.onTouchMove(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this.toolManager.onTouchEnd(e));

    // Custom Context menu on canvas
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openContextMenu(e.clientX, e.clientY);
    });

    // Close context menu on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#context-menu')) {
        this.closeContextMenu();
      }
    });
  }

  bindToolbar() {
    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (tool) this.toolManager.setTool(tool);
      });
    });

    // Undo / Redo
    const undoBtn = document.getElementById('btn-undo') || document.getElementById('undo-btn');
    const redoBtn = document.getElementById('btn-redo') || document.getElementById('redo-btn');
    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
    if (redoBtn) redoBtn.addEventListener('click', () => this.redo());

    // Zoom controls
    const zoomInBtn = document.getElementById('btn-zoom-in') || document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('btn-zoom-out') || document.getElementById('zoom-out-btn');
    const zoomResetBtn = document.getElementById('btn-zoom-reset') || document.getElementById('zoom-reset-btn');
    const zoomDisplayBtn = document.getElementById('zoom-display');

    if (zoomInBtn) zoomInBtn.addEventListener('click', () => { this.renderer.zoomIn(); this.dirty = true; this.updateZoomUI(); });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { this.renderer.zoomOut(); this.dirty = true; this.updateZoomUI(); });
    if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => { this.renderer.resetZoom(); this.dirty = true; this.updateZoomUI(); });
    if (zoomDisplayBtn) zoomDisplayBtn.addEventListener('click', () => { this.renderer.resetZoom(); this.dirty = true; this.updateZoomUI(); });

    // Clear canvas
    const clearBtn = document.getElementById('btn-clear') || document.getElementById('clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (this.elements.length === 0) return;
      if (confirm('Clear everything on this page?')) {
        this.history.push(this.elements);
        this.elements.length = 0;
        this.toolManager.selectedIds.clear();
        this.saveState();
        this.dirty = true;
        this._checkEmptyState();
      }
    });

    // Export PNG
    const exportBtn = document.getElementById('btn-export-png') || document.getElementById('export-btn');
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportPNG());

    // Theme toggle
    const themeBtn = document.getElementById('btn-theme-toggle') || document.getElementById('theme-btn');
    if (themeBtn) themeBtn.addEventListener('click', () => this.toggleTheme());

    // Pages selector dropdown
    const pageSelect = document.getElementById('page-select');
    if (pageSelect) {
      pageSelect.addEventListener('change', (e) => {
        this.switchPage(e.target.value);
      });
    }

    // New page button
    const newPageBtn = document.getElementById('btn-new-page') || document.getElementById('new-page-btn');
    if (newPageBtn) {
      newPageBtn.addEventListener('click', () => {
        const name = prompt('Page name:', `Page ${this.pages.length + 1}`);
        if (name && name.trim()) this.createPage(name.trim());
      });
    }

    // Minimap toggles
    const toggleMinimapBtn = document.getElementById('btn-toggle-minimap');
    const closeMinimapBtn = document.getElementById('btn-close-minimap');
    const minimapCard = document.getElementById('minimap-card');

    if (toggleMinimapBtn && minimapCard) {
      toggleMinimapBtn.addEventListener('click', () => {
        this.minimapVisible = !this.minimapVisible;
        minimapCard.style.display = this.minimapVisible ? 'block' : 'none';
        if (this.minimapVisible) {
          this._lastMinimapAt = 0;
          this.dirty = true;
        }
      });
    }

    if (closeMinimapBtn && minimapCard) {
      closeMinimapBtn.addEventListener('click', () => {
        this.minimapVisible = false;
        minimapCard.style.display = 'none';
      });
    }
  }

  bindProperties() {
    const propertiesPanel = document.getElementById('properties-section');
    const styleFab = document.getElementById('btn-style-settings');
    const setPanel = (open) => {
      if (propertiesPanel) propertiesPanel.hidden = !open;
      if (styleFab) {
        styleFab.classList.toggle('active', open);
        styleFab.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      try { localStorage.setItem('fleck_style_panel', open ? '1' : '0'); } catch (_) {}
    };
    if (styleFab) styleFab.addEventListener('click', () => setPanel(propertiesPanel?.hidden));
    let wasOpen = false;
    try { wasOpen = localStorage.getItem('fleck_style_panel') === '1'; } catch (_) {}
    setPanel(wasOpen);

    // Stroke color picker
    const strokePicker = document.getElementById('stroke-color-picker') || document.getElementById('stroke-color');
    const strokeIndicator = document.getElementById('stroke-color-indicator');

    if (strokePicker) {
      strokePicker.value = this.settings.strokeColor;
      const applyStrokeColor = (e) => {
        this.setStrokeColor(e.target.value);
      };
      strokePicker.addEventListener('input', applyStrokeColor);
      strokePicker.addEventListener('change', applyStrokeColor);
    }

    // Stroke swatches
    document.querySelectorAll('#stroke-palette .swatch-mini').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const color = swatch.dataset.color;
        if (color) this.setStrokeColor(color);
      });
    });

    // Fill color picker
    const fillPicker = document.getElementById('fill-color-picker') || document.getElementById('fill-color');
    const fillIndicator = document.getElementById('fill-color-indicator');
    const fillTransparentBtn = document.getElementById('btn-fill-transparent') || document.getElementById('fill-toggle');

    if (fillPicker) {
      fillPicker.value = this.settings.fillColor === 'transparent' ? '#3b82f6' : this.settings.fillColor.slice(0, 7);
      const applyFillColor = (e) => {
        this.setFillColor(e.target.value);
      };
      fillPicker.addEventListener('input', applyFillColor);
      fillPicker.addEventListener('change', applyFillColor);
    }

    // Fill transparent toggle
    if (fillTransparentBtn) {
      fillTransparentBtn.addEventListener('click', () => {
        if (this.settings.fillColor === 'transparent') {
          const val = fillPicker ? fillPicker.value : '#3b82f6';
          this.setFillColor(val);
        } else {
          this.setFillColor('transparent');
        }
      });
    }

    // Fill swatches
    document.querySelectorAll('#fill-palette .swatch-mini').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const color = swatch.dataset.color;
        if (color) this.setFillColor(color);
      });
    });

    // Stroke width options
    const strokeWidthBadge = document.getElementById('stroke-width-badge') || document.getElementById('stroke-width-val');
    document.querySelectorAll('#stroke-width-options .option-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const val = parseInt(button.dataset.value, 10);
        this.settings.strokeWidth = val;
        if (strokeWidthBadge) strokeWidthBadge.textContent = `${val}px`;
        this._updateSelectedElementsStyle({ strokeWidth: val });
        this.updateStyleUI();
        this.saveState();
      });
    });

    // Opacity options
    const opacityBadge = document.getElementById('opacity-badge') || document.getElementById('opacity-val');
    document.querySelectorAll('#opacity-options .option-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const pct = parseInt(button.dataset.value, 10);
        const val = pct / 100;
        this.settings.opacity = val;
        if (opacityBadge) opacityBadge.textContent = `${pct}%`;
        this._updateSelectedElementsStyle({ opacity: val });
        this.updateStyleUI();
        this.saveState();
      });
    });
  }

  setStrokeColor(color) {
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return;
    this.settings.strokeColor = color;
    const strokePicker = document.getElementById('stroke-color-picker') || document.getElementById('stroke-color');
    const strokeIndicator = document.getElementById('stroke-color-indicator');

    if (strokePicker && color.startsWith('#') && color.length === 7) {
      strokePicker.value = color;
    }
    if (strokeIndicator) {
      strokeIndicator.style.backgroundColor = color;
    }
    const fabSwatch = document.getElementById('style-fab-swatch');
    if (fabSwatch) fabSwatch.style.backgroundColor = color;

    this._updateSelectedElementsStyle({ strokeColor: color });
    this.saveState();
  }

  setFillColor(color) {
    if (typeof color !== 'string' || (color !== 'transparent' && !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color))) {
      return;
    }
    this.settings.fillColor = color;
    const fillPicker = document.getElementById('fill-color-picker') || document.getElementById('fill-color');
    const fillIndicator = document.getElementById('fill-color-indicator');
    const fillTransparentBtn = document.getElementById('btn-fill-transparent') || document.getElementById('fill-toggle');

    if (color === 'transparent') {
      if (fillTransparentBtn) fillTransparentBtn.classList.add('active');
      if (fillIndicator) {
        fillIndicator.classList.add('transparent-pattern');
        fillIndicator.style.backgroundColor = '';
      }
    } else {
      if (fillTransparentBtn) fillTransparentBtn.classList.remove('active');
      if (fillIndicator) {
        fillIndicator.classList.remove('transparent-pattern');
        fillIndicator.style.backgroundColor = color;
      }
      if (fillPicker && color.startsWith('#') && color.length >= 7) {
        fillPicker.value = color.slice(0, 7);
      }
    }

    this._updateSelectedElementsStyle({ fillColor: color });
    this.saveState();
  }

  _updateSelectedElementsStyle(props) {
    if (this.toolManager.selectedIds.size > 0) {
      let changed = false;
      // Dragging a color picker fires dozens of events; keep one undo step per burst.
      const key = `${[...this.toolManager.selectedIds].join(',')}|${Object.keys(props).join(',')}`;
      const now = performance.now();
      const coalesce = key === this._lastStyleEdit.key && now - this._lastStyleEdit.at < 800;
      this._lastStyleEdit = { key, at: now };
      if (!coalesce) this.history.push(this.elements);
      for (const id of this.toolManager.selectedIds) {
        const el = this.elements.find(e => e.id === id);
        if (el) {
          Object.assign(el, props, { updatedAt: Date.now() });
          changed = true;
        }
      }
      if (changed) {
        this.dirty = true;
        this.saveState();
      } else if (!coalesce) {
        this.history.undoStack.pop();
      }
    }
  }

  // ─── Context Menu ─────────────────────────────────────────

  bindContextMenu() {
    const menu = document.getElementById('context-menu');
    if (!menu) return;

    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        this.executeContextAction(action);
        this.closeContextMenu();
      });
    });
  }

  openContextMenu(clientX, clientY) {
    const menu = document.getElementById('context-menu');
    if (!menu) return;

    // Hit test: if right clicked on an unselected element, select it
    const rect = this.canvas.getBoundingClientRect();
    const world = screenToWorld(clientX - rect.left, clientY - rect.top, this.renderer.camera);
    const hit = this.toolManager.getElementAtPoint(world.x, world.y);

    if (hit && !this.toolManager.selectedIds.has(hit.id)) {
      this.toolManager.selectedIds.clear();
      this.toolManager.selectedIds.add(hit.id);
      this.dirty = true;
    }

    this.contextMenuPos = { x: clientX, y: clientY };
    menu.hidden = false;
    menu.style.left = `${Math.min(window.innerWidth - 180, clientX)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 240, clientY)}px`;
  }

  closeContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) menu.hidden = true;
  }

  executeContextAction(action) {
    switch (action) {
      case 'bring-front': this.bringToFront(); break;
      case 'send-back': this.sendToBack(); break;
      case 'duplicate': this.duplicateSelected(); break;
      case 'copy': this.copySelected(); break;
      case 'paste': this.paste(); break;
      case 'delete': this.toolManager.deleteSelected(); break;
    }
  }

  bringToFront() {
    if (this.toolManager.selectedIds.size === 0) return;
    this.history.push(this.elements);

    const selected = [];
    const rest = [];
    for (const el of this.elements) {
      if (this.toolManager.selectedIds.has(el.id)) {
        selected.push(el);
      } else {
        rest.push(el);
      }
    }
    this.elements = rest.concat(selected);
    this.activePage.elements = this.elements;
    this.saveState();
    this.dirty = true;
  }

  sendToBack() {
    if (this.toolManager.selectedIds.size === 0) return;
    this.history.push(this.elements);

    const selected = [];
    const rest = [];
    for (const el of this.elements) {
      if (this.toolManager.selectedIds.has(el.id)) {
        selected.push(el);
      } else {
        rest.push(el);
      }
    }
    this.elements = selected.concat(rest);
    this.activePage.elements = this.elements;
    this.saveState();
    this.dirty = true;
  }

  copySelected() {
    if (this.toolManager.selectedIds.size === 0) return;
    this.clipboard = [];
    for (const id of this.toolManager.selectedIds) {
      const el = this.elements.find(e => e.id === id);
      if (el) {
        this.clipboard.push(structuredClone(el));
      }
    }
  }

  paste() {
    if (this.clipboard.length === 0) return;
    this.history.push(this.elements);

    const newIds = new Set();
    for (const item of this.clipboard) {
      const clone = structuredClone(item);
      clone.id = generateId();
      clone.x += 24;
      clone.y += 24;
      clone.createdAt = Date.now();
      clone.updatedAt = Date.now();
      this.elements.push(clone);
      newIds.add(clone.id);
    }

    this.toolManager.selectedIds = newIds;
    this.activePage.elements = this.elements;
    this._checkEmptyState();
    this.saveState();
    this.dirty = true;
  }

  // ─── Modals (Pages Manager) ───────────────────────────────

  bindModals() {
    const pageManagerBtn = document.getElementById('btn-page-manager');
    const modalBackdrop = document.getElementById('pages-modal-backdrop');
    const closeBtn = document.getElementById('btn-close-pages-modal');
    const doneBtn = document.getElementById('btn-modal-done');
    const newPageForm = document.getElementById('new-page-form');
    const newPageInput = document.getElementById('new-page-input');

    const openModal = () => {
      if (modalBackdrop) {
        this.renderPagesModalList();
        modalBackdrop.hidden = false;
        if (newPageInput) newPageInput.focus();
      }
    };

    const closeModal = () => {
      if (modalBackdrop) modalBackdrop.hidden = true;
    };

    if (pageManagerBtn) pageManagerBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (doneBtn) doneBtn.addEventListener('click', closeModal);

    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeModal();
      });
    }

    if (newPageForm && newPageInput) {
      newPageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = newPageInput.value.trim();
        if (val) {
          this.createPage(val);
          newPageInput.value = '';
          this.renderPagesModalList();
        }
      });
    }
  }

  renderPagesModalList() {
    const list = document.getElementById('modal-pages-list');
    if (!list) return;

    list.innerHTML = '';
    this.pages.forEach((page) => {
      const li = document.createElement('li');
      li.className = `page-list-item ${page.id === this.activePage.id ? 'active' : ''}`;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'page-item-name';
      nameSpan.textContent = page.name;
      nameSpan.title = 'Click to switch';
      nameSpan.addEventListener('click', () => {
        this.switchPage(page.id);
        this.renderPagesModalList();
      });

      const countBadge = document.createElement('span');
      countBadge.className = 'page-item-count';
      countBadge.textContent = `${page.elements ? page.elements.length : 0} items`;

      const actionsGroup = document.createElement('div');
      actionsGroup.className = 'page-item-actions';

      // Rename button
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'btn-icon-xs';
      renameBtn.title = 'Rename page';
      renameBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      `;
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = prompt('New page name:', page.name);
        if (newName && newName.trim()) {
          this.renamePage(page.id, newName.trim());
          this.renderPagesModalList();
        }
      });

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon-xs btn-danger-hover';
      delBtn.title = 'Delete page';
      delBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.pages.length <= 1) {
          alert('Cannot delete the last remaining page.');
          return;
        }
        if (confirm(`Delete "${page.name}"?`)) {
          this.deletePage(page.id);
          this.renderPagesModalList();
        }
      });

      actionsGroup.appendChild(renameBtn);
      if (this.pages.length > 1) {
        actionsGroup.appendChild(delBtn);
      }

      li.appendChild(nameSpan);
      li.appendChild(countBadge);
      li.appendChild(actionsGroup);
      list.appendChild(li);
    });
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Don't handle shortcuts when typing in inputs or contenteditables
      if (this.toolManager.editingElement) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      if (!ctrl && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v': this.toolManager.setTool('select'); e.preventDefault(); return;
          case 'p': this.toolManager.setTool('pen'); e.preventDefault(); return;
          case 'l': this.toolManager.setTool('line'); e.preventDefault(); return;
          case 'a': this.toolManager.setTool('arrow'); e.preventDefault(); return;
          case 'r': this.toolManager.setTool('rectangle'); e.preventDefault(); return;
          case 'e': this.toolManager.setTool('ellipse'); e.preventDefault(); return;
          case 'd': this.toolManager.setTool('diamond'); e.preventDefault(); return;
          case 't': this.toolManager.setTool('text'); e.preventDefault(); return;
          case 'x': this.toolManager.setTool('eraser'); e.preventDefault(); return;
          case 's': this.toolManager.setTool('stickynote'); e.preventDefault(); return;
          case 'm':
            const toggleBtn = document.getElementById('btn-toggle-minimap');
            if (toggleBtn) toggleBtn.click();
            e.preventDefault();
            return;
          case 'delete':
          case 'backspace':
            this.toolManager.deleteSelected();
            e.preventDefault();
            return;
          case 'escape':
            this.toolManager.selectedIds.clear();
            this.toolManager.currentElement = null;
            this.toolManager.isDrawing = false;
            this.closeContextMenu();
            const modal = document.getElementById('pages-modal-backdrop');
            if (modal) modal.hidden = true;
            this.dirty = true;
            e.preventDefault();
            return;
          case '=':
          case '+':
            this.renderer.zoomIn();
            this.dirty = true;
            this.updateZoomUI();
            e.preventDefault();
            return;
          case '-':
            this.renderer.zoomOut();
            this.dirty = true;
            this.updateZoomUI();
            e.preventDefault();
            return;
          case '0':
            this.renderer.resetZoom();
            this.dirty = true;
            this.updateZoomUI();
            e.preventDefault();
            return;
          case ']':
            this.bringToFront();
            e.preventDefault();
            return;
          case '[':
            this.sendToBack();
            e.preventDefault();
            return;
        }
      }

      if (ctrl) {
        switch (e.key.toLowerCase()) {
          case 'z':
            if (e.shiftKey) { this.redo(); } else { this.undo(); }
            e.preventDefault();
            return;
          case 'y':
            this.redo();
            e.preventDefault();
            return;
          case 'a':
            this.toolManager.setTool('select');
            this.toolManager.selectAll();
            e.preventDefault();
            return;
          case 'c':
            this.copySelected();
            e.preventDefault();
            return;
          case 'v':
            this.paste();
            e.preventDefault();
            return;
          case 'd':
            this.duplicateSelected();
            e.preventDefault();
            return;
          case 's':
            this._flushSave();
            e.preventDefault();
            return;
          case 'e':
            this.exportPNG();
            e.preventDefault();
            return;
        }
      }
    });
  }

  // ─── Element Operations ───────────────────────────────────

  addElement(element) {
    this.elements.push(element);
    this._checkEmptyState();
    this.dirty = true;
  }

  removeElement(id) {
    const idx = this.elements.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.elements.splice(idx, 1);
      this.toolManager.selectedIds.delete(id);
      this._checkEmptyState();
      this.dirty = true;
    }
  }

  duplicateSelected() {
    if (this.toolManager.selectedIds.size === 0) return;
    this.history.push(this.elements);

    const newIds = new Set();
    for (const id of this.toolManager.selectedIds) {
      const el = this.elements.find(e => e.id === id);
      if (el) {
        const clone = structuredClone(el);
        clone.id = generateId();
        clone.x += 20;
        clone.y += 20;
        clone.createdAt = Date.now();
        clone.updatedAt = Date.now();
        this.elements.push(clone);
        newIds.add(clone.id);
      }
    }
    this.toolManager.selectedIds = newIds;
    this.saveState();
    this.dirty = true;
  }

  // ─── Undo / Redo ──────────────────────────────────────────

  undo() {
    if (!this.history.canUndo()) return;
    const state = this.history.undo(this.elements);
    this.elements.length = 0;
    this.elements.push(...state);
    this.activePage.elements = this.elements;
    this.toolManager.selectedIds.clear();
    this.saveState();
    this.dirty = true;
    this._checkEmptyState();
  }

  redo() {
    if (!this.history.canRedo()) return;
    const state = this.history.redo(this.elements);
    this.elements.length = 0;
    this.elements.push(...state);
    this.activePage.elements = this.elements;
    this.toolManager.selectedIds.clear();
    this.saveState();
    this.dirty = true;
    this._checkEmptyState();
  }

  // ─── Page Management ──────────────────────────────────────

  createPage(name) {
    const page = {
      id: generateId(),
      name: name || `Page ${this.pages.length + 1}`,
      elements: [],
      camera: { x: 0, y: 0, zoom: 1 },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.pages.push(page);
    this.switchPage(page.id);
    this.updatePagesUI();
    this.saveState();
  }

  switchPage(pageId) {
    if (this.activePage) {
      this.activePage.elements = this.elements;
      this.activePage.camera = { ...this.renderer.camera };
      this.activePage.updatedAt = Date.now();
    }

    const page = this.pages.find(p => p.id === pageId);
    if (!page) return;

    this.activePage = page;
    this.elements = page.elements || [];
    this.history.clear();
    this.toolManager.selectedIds.clear();

    if (page.camera) {
      this.renderer.camera = { ...page.camera };
    } else {
      this.renderer.resetZoom();
    }

    this.updatePagesUI();
    this.updateZoomUI();
    this.saveState();
    this.dirty = true;
    this._checkEmptyState();
  }

  deletePage(pageId) {
    if (this.pages.length <= 1) return;
    const idx = this.pages.findIndex(p => p.id === pageId);
    if (idx === -1) return;

    this.pages.splice(idx, 1);
    if (this.activePage.id === pageId) {
      this.switchPage(this.pages[0].id);
    }

    this.updatePagesUI();
    this.saveState();
  }

  renamePage(pageId, name) {
    const page = this.pages.find(p => p.id === pageId);
    if (page) {
      page.name = name;
      page.updatedAt = Date.now();
      this.updatePagesUI();
      this.saveState();
    }
  }

  updatePagesUI() {
    const select = document.getElementById('page-select');
    if (!select) return;

    select.innerHTML = '';
    for (const page of this.pages) {
      const opt = document.createElement('option');
      opt.value = page.id;
      opt.textContent = page.name;
      opt.selected = page.id === this.activePage.id;
      select.appendChild(opt);
    }
  }

  // ─── Persistence & Export ─────────────────────────────────

  saveState() {
    this._saveDebounced();
  }

  _flushSave() {
    this._saveDebounced.cancel();
    this._doSave(true);
  }

  _doSave(immediate = false) {
    if (this.activePage) {
      this.activePage.elements = this.elements;
      this.activePage.camera = { ...this.renderer.camera };
      this.activePage.updatedAt = Date.now();
    }

    const payload = {
      pages: this.pages,
      activePageId: this.activePage?.id,
      theme: document.documentElement.getAttribute('data-theme'),
      settings: { ...this.settings }
    };
    if (immediate) {
      this.storage.saveImmediate(payload);
    } else {
      this.storage.save(payload);
    }
  }

  exportPNG() {
    const dataURL = this.renderer.toDataURL(this.elements);
    const link = document.createElement('a');
    const safeName = (this.activePage?.name || 'sketch').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    link.download = `fleck-${safeName}-${Date.now()}.png`;
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ─── Theme ────────────────────────────────────────────────

  setTheme(theme, save = true) {
    document.documentElement.setAttribute('data-theme', theme);
    this.renderer.theme = theme;
    this.dirty = true;

    if (save) {
      this.saveState();
    }

    // Toggle theme icons
    const themeBtn = document.getElementById('btn-theme-toggle') || document.getElementById('theme-btn');
    if (themeBtn && typeof themeBtn.querySelector === 'function') {
      const sunIcon = themeBtn.querySelector('.icon-sun');
      const moonIcon = themeBtn.querySelector('.icon-moon');
      if (sunIcon && moonIcon) {
        sunIcon.style.display = theme === 'dark' ? 'none' : 'block';
        moonIcon.style.display = theme === 'dark' ? 'block' : 'none';
      }
    }
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
  }

  // ─── UI Status Updates ────────────────────────────────────

  updateToolUI(toolName) {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      const tool = btn.dataset.tool;
      const normalized = tool === 'rect' ? 'rectangle' : (tool === 'sticky' ? 'stickynote' : tool);
      const isCurrent = normalized === toolName || tool === toolName;
      btn.classList.toggle('active', isCurrent);
      btn.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
    });
  }

  updateStyleUI() {
    const strokePicker = document.getElementById('stroke-color-picker') || document.getElementById('stroke-color');
    const strokeIndicator = document.getElementById('stroke-color-indicator');
    const fillPicker = document.getElementById('fill-color-picker') || document.getElementById('fill-color');
    const fillIndicator = document.getElementById('fill-color-indicator');
    const fillTransparentBtn = document.getElementById('btn-fill-transparent') || document.getElementById('fill-toggle');
    const strokeWidthSlider = document.getElementById('stroke-width-slider') || document.getElementById('stroke-width');
    const strokeWidthBadge = document.getElementById('stroke-width-badge') || document.getElementById('stroke-width-val');
    const opacitySlider = document.getElementById('opacity-slider') || document.getElementById('opacity');
    const opacityBadge = document.getElementById('opacity-badge') || document.getElementById('opacity-val');

    if (strokePicker && this.settings.strokeColor.startsWith('#') && this.settings.strokeColor.length === 7) {
      strokePicker.value = this.settings.strokeColor;
    }
    if (strokeIndicator) {
      strokeIndicator.style.backgroundColor = this.settings.strokeColor;
    }
    const fabSwatch = document.getElementById('style-fab-swatch');
    if (fabSwatch) fabSwatch.style.backgroundColor = this.settings.strokeColor;

    if (this.settings.fillColor === 'transparent') {
      if (fillTransparentBtn) fillTransparentBtn.classList.add('active');
      if (fillIndicator) {
        fillIndicator.classList.add('transparent-pattern');
        fillIndicator.style.backgroundColor = '';
      }
    } else {
      if (fillTransparentBtn) fillTransparentBtn.classList.remove('active');
      if (fillIndicator) {
        fillIndicator.classList.remove('transparent-pattern');
        fillIndicator.style.backgroundColor = this.settings.fillColor;
      }
      if (fillPicker && this.settings.fillColor.startsWith('#') && this.settings.fillColor.length >= 7) {
        fillPicker.value = this.settings.fillColor.slice(0, 7);
      }
    }

    if (strokeWidthBadge) {
      strokeWidthBadge.textContent = `${this.settings.strokeWidth}px`;
    }
    document.querySelectorAll('#stroke-width-options .option-btn').forEach((button) => {
      button.classList.toggle('active', parseInt(button.dataset.value, 10) === this.settings.strokeWidth);
    });

    if (opacityBadge) {
      opacityBadge.textContent = `${Math.round(this.settings.opacity * 100)}%`;
    }
    document.querySelectorAll('#opacity-options .option-btn').forEach((button) => {
      button.classList.toggle('active', parseInt(button.dataset.value, 10) === Math.round(this.settings.opacity * 100));
    });
  }

  updateZoomUI() {
    const pct = `${Math.round(this.renderer.camera.zoom * 100)}%`;

    const zoomDisplay = document.getElementById('zoom-display');
    if (zoomDisplay) zoomDisplay.textContent = pct;

    const bottomZoomDisplay = document.getElementById('bottom-zoom-display');
    if (bottomZoomDisplay) bottomZoomDisplay.textContent = pct;

    const zoomLevelLegacy = document.getElementById('zoom-level');
    if (zoomLevelLegacy) zoomLevelLegacy.textContent = pct;
  }

  updateCoords(x, y) {
    if (this._coordsFrame) {
      this._pendingCoords = { x, y };
      return;
    }
    this._pendingCoords = { x, y };
    this._coordsFrame = requestAnimationFrame(() => {
      this._coordsFrame = 0;
      this._writeCoords(this._pendingCoords.x, this._pendingCoords.y);
    });
  }

  _writeCoords(x, y) {
    const coordX = document.getElementById('coord-x');
    const coordY = document.getElementById('coord-y');
    if (coordX && coordY) {
      coordX.textContent = `${x}`;
      coordY.textContent = `${y}`;
    }

    const legacy = document.getElementById('coords-display');
    if (legacy) {
      legacy.textContent = `${x}, ${y}`;
    }
  }

  _checkEmptyState() {
    const emptyState = document.getElementById('empty-state');
    if (emptyState) {
      const isEmpty = this.elements.length === 0;
      emptyState.style.display = isEmpty ? 'flex' : 'none';
      emptyState.setAttribute('aria-hidden', isEmpty ? 'false' : 'true');
    }
  }
}

// ─── Bootstrap ────────────────────────────────────────────

const app = new App();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}
window.fleckApp = app;
