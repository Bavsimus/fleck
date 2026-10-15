/**
 * Fleck Note-Taking App - History Management
 * Robust undo/redo state snapshotting using deep cloning.
 */

/**
 * Deep clone state safely using structuredClone with JSON fallback.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function cloneState(obj) {
  if (obj === undefined || obj === null) return obj;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {
      // Fallback for non-serializable edge cases
    }
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Manages undo and redo stacks for canvas element state snapshots.
 */
export class History {
  /**
   * @param {number} [maxStackSize=50] Maximum number of undo states to keep.
   */
  constructor(maxStackSize = 50) {
    this.maxStackSize = maxStackSize;
    /** @type {Array<Array<object>>} */
    this.undoStack = [];
    /** @type {Array<Array<object>>} */
    this.redoStack = [];
  }

  /**
   * Save a snapshot of the current elements array.
   * Clears the redo stack.
   * @param {Array<object>} elements
   */
  push(elements) {
    if (!elements) return;

    this.undoStack.push(cloneState(elements));
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }

    // A new action invalidates previously undone actions
    this.redoStack = [];
  }

  /**
   * Undo to the previous state.
   * Pushes the current elements onto the redo stack and pops from the undo stack.
   * @param {Array<object>} currentElements Current elements in the canvas
   * @returns {Array<object>|null} Previous state elements, or null if cannot undo
   */
  undo(currentElements) {
    if (!this.canUndo()) {
      return null;
    }

    if (currentElements) {
      this.redoStack.push(cloneState(currentElements));
      if (this.redoStack.length > this.maxStackSize) {
        this.redoStack.shift();
      }
    }

    const previousState = this.undoStack.pop();
    return cloneState(previousState);
  }

  /**
   * Redo to the next state.
   * Pushes the current elements onto the undo stack and pops from the redo stack.
   * @param {Array<object>} currentElements Current elements in the canvas
   * @returns {Array<object>|null} Next state elements, or null if cannot redo
   */
  redo(currentElements) {
    if (!this.canRedo()) {
      return null;
    }

    if (currentElements) {
      this.undoStack.push(cloneState(currentElements));
      if (this.undoStack.length > this.maxStackSize) {
        this.undoStack.shift();
      }
    }

    const nextState = this.redoStack.pop();
    return cloneState(nextState);
  }

  /**
   * Check if undo is available.
   * @returns {boolean}
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available.
   * @returns {boolean}
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all undo and redo history.
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Return number of available undo steps.
   * @returns {number}
   */
  getUndoCount() {
    return this.undoStack.length;
  }

  /**
   * Return number of available redo steps.
   * @returns {number}
   */
  getRedoCount() {
    return this.redoStack.length;
  }
}
