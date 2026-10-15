/**
 * Fleck Note-Taking App - LocalStorage Persistence & Export/Import
 * Manages debounced saving, schema validation, and page data import/export.
 */

import { generateId, debounce } from './utils.js';

export class Storage {
  static STORAGE_KEY = 'fleck_data';

  /**
   * @param {string} [storageKey='fleck_data'] Custom storage key if needed
   */
  constructor(storageKey = Storage.STORAGE_KEY) {
    this.STORAGE_KEY = storageKey;

    // 500ms debounced persistence to avoid thrashing localStorage during continuous strokes
    this._debouncedSaveFn = debounce((data) => {
      this._writeToStorage(data);
    }, 500);
  }

  /**
   * Internal direct write to localStorage with error handling.
   * @private
   * @param {object} data
   */
  _writeToStorage(data) {
    if (typeof localStorage === 'undefined') return;
    try {
      const serialized = JSON.stringify(data);
      localStorage.setItem(this.STORAGE_KEY, serialized);
    } catch (err) {
      console.error('[Fleck Storage] Failed to write data to localStorage:', err);
    }
  }

  /**
   * Create the default application state with a single empty page.
   * @returns {object} Default state
   */
  createDefaultData() {
    const initialPageId = generateId();
    const now = Date.now();

    return {
      pages: [
        {
          id: initialPageId,
          name: 'Untitled',
          elements: [],
          camera: { x: 0, y: 0, zoom: 1 },
          createdAt: now,
          updatedAt: now
        }
      ],
      activePageId: initialPageId,
      theme: 'system',
      settings: {
        strokeColor: '#1e1e1e',
        fillColor: 'transparent',
        strokeWidth: 2,
        opacity: 1
      }
    };
  }

  /**
   * Save the entire application state (debounced by 500ms).
   * @param {object} data
   */
  save(data) {
    if (!data) return;
    this._debouncedSaveFn(data);
  }

  /**
   * Immediately save without waiting for the debounce delay.
   * Useful when closing the tab or switching pages.
   * @param {object} data
   */
  saveImmediate(data) {
    if (!data) return;
    this._debouncedSaveFn.cancel();
    this._writeToStorage(data);
  }

  /**
   * Load the application state from localStorage.
   * Returns default data if storage is empty, corrupted, or unavailable.
   * @returns {object} Validated app state
   */
  load() {
    if (typeof localStorage === 'undefined') {
      return this.createDefaultData();
    }

    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) {
        return this.createDefaultData();
      }

      const parsed = JSON.parse(raw);

      // Validate core structure and backfill missing fields if needed
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.pages) || parsed.pages.length === 0) {
        return this.createDefaultData();
      }

      const defaults = this.createDefaultData();

      // Ensure activePageId is valid
      const hasActivePage = parsed.pages.some((p) => p && p.id === parsed.activePageId);
      const activePageId = hasActivePage ? parsed.activePageId : parsed.pages[0].id;

      // Sanitize each page
      const sanitizedPages = parsed.pages.map((p) => ({
        id: p.id || generateId(),
        name: p.name || 'Untitled',
        elements: Array.isArray(p.elements) ? p.elements : [],
        camera: {
          x: typeof p.camera?.x === 'number' ? p.camera.x : 0,
          y: typeof p.camera?.y === 'number' ? p.camera.y : 0,
          zoom: typeof p.camera?.zoom === 'number' ? p.camera.zoom : 1
        },
        createdAt: p.createdAt || Date.now(),
        updatedAt: p.updatedAt || Date.now()
      }));

      return {
        pages: sanitizedPages,
        activePageId,
        theme: parsed.theme || defaults.theme,
        settings: {
          ...defaults.settings,
          ...(parsed.settings || {})
        }
      };
    } catch (err) {
      console.warn('[Fleck Storage] Could not parse stored data, resetting to default:', err);
      return this.createDefaultData();
    }
  }

  /**
   * Export a page to a formatted JSON string.
   * @param {object} page
   * @returns {string} JSON string
   */
  exportPage(page) {
    if (!page) {
      throw new Error('No page provided for export');
    }

    const payload = {
      app: 'fleck',
      version: 1,
      exportedAt: Date.now(),
      page: {
        id: page.id,
        name: page.name,
        elements: page.elements || [],
        camera: page.camera || { x: 0, y: 0, zoom: 1 },
        createdAt: page.createdAt,
        updatedAt: page.updatedAt
      }
    };

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Import a page from a JSON string.
   * Generates a new ID for the imported page to prevent ID collisions.
   * @param {string} jsonString
   * @returns {object} Imported page object
   */
  importPage(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
      throw new Error('Invalid JSON string for page import');
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      throw new Error('Failed to parse page JSON');
    }

    const pageData = parsed.page || parsed;
    if (!pageData || !Array.isArray(pageData.elements)) {
      throw new Error('Invalid Fleck page format: missing elements array');
    }

    const now = Date.now();
    return {
      id: generateId(),
      name: pageData.name ? `${pageData.name} (Imported)` : 'Imported Page',
      elements: pageData.elements.map((el) => ({
        ...el,
        id: generateId() // Assign fresh IDs to avoid duplicate element IDs
      })),
      camera: {
        x: typeof pageData.camera?.x === 'number' ? pageData.camera.x : 0,
        y: typeof pageData.camera?.y === 'number' ? pageData.camera.y : 0,
        zoom: typeof pageData.camera?.zoom === 'number' ? pageData.camera.zoom : 1
      },
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Calculate approximate storage usage of Fleck in bytes.
   * @returns {number} Approximate byte count
   */
  getStorageUsage() {
    if (typeof localStorage === 'undefined') return 0;
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (!data) return 0;
      // In JS, UTF-16 strings take 2 bytes per code unit
      return data.length * 2;
    } catch {
      return 0;
    }
  }
}
