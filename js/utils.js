/**
 * Fleck Note-Taking App - Core Utility Functions
 * High-performance geometric and coordinate transformation utilities for canvas manipulation.
 */

/**
 * Generate a unique identifier (UUID v4) with fallback for older environments.
 * @returns {string} Unique UUID
 */
export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Calculate Euclidean distance between two points.
 * @param {{x: number, y: number}} p1
 * @param {{x: number, y: number}} p2
 * @returns {number}
 */
export function distance(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Clamp a number between min and max bounds.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Linear interpolation between a and b by factor t.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Test if a point lies within a rectangle (handles negative width/height).
 * @param {number} px
 * @param {number} py
 * @param {number} rx
 * @param {number} ry
 * @param {number} rw
 * @param {number} rh
 * @returns {boolean}
 */
export function pointInRect(px, py, rx, ry, rw, rh) {
  const minX = Math.min(rx, rx + rw);
  const maxX = Math.max(rx, rx + rw);
  const minY = Math.min(ry, ry + rh);
  const maxY = Math.max(ry, ry + rh);
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

/**
 * Test if two rectangles intersect (supports negative width/height).
 * @param {{x: number, y: number, width: number, height: number}} r1
 * @param {{x: number, y: number, width: number, height: number}} r2
 * @returns {boolean}
 */
export function rectsIntersect(r1, r2) {
  const r1MinX = Math.min(r1.x, r1.x + r1.width);
  const r1MaxX = Math.max(r1.x, r1.x + r1.width);
  const r1MinY = Math.min(r1.y, r1.y + r1.height);
  const r1MaxY = Math.max(r1.y, r1.y + r1.height);

  const r2MinX = Math.min(r2.x, r2.x + r2.width);
  const r2MaxX = Math.max(r2.x, r2.x + r2.width);
  const r2MinY = Math.min(r2.y, r2.y + r2.height);
  const r2MaxY = Math.max(r2.y, r2.y + r2.height);

  return !(r2MinX > r1MaxX || r2MaxX < r1MinX || r2MinY > r1MaxY || r2MaxY < r1MinY);
}

/**
 * Calculate the bounding box enclosing an array of 2D points.
 * @param {Array<{x: number, y: number}>} points
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function getBoundingBox(points) {
  if (!points || points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * Check if a point is within threshold distance of a line segment.
 * @param {number} px
 * @param {number} py
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} [threshold=6]
 * @returns {boolean}
 */
export function isPointNearLine(px, py, x1, y1, x2, y2, threshold = 6) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(px - x1, py - y1) <= threshold;
  }

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.hypot(px - projX, py - projY) <= threshold;
}

/**
 * Check if a point is near a polyline path.
 * @param {number} px
 * @param {number} py
 * @param {Array<{x: number, y: number}>} points
 * @param {number} [threshold=6]
 * @returns {boolean}
 */
export function isPointNearPath(px, py, points, threshold = 6) {
  if (!points || points.length === 0) return false;
  if (points.length === 1) {
    return Math.hypot(px - points[0].x, py - points[0].y) <= threshold;
  }

  for (let i = 0; i < points.length - 1; i++) {
    if (isPointNearLine(px, py, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, threshold)) {
      return true;
    }
  }
  return false;
}

/**
 * Smooth an array of points using Catmull-Rom spline interpolation.
 * @param {Array<{x: number, y: number}>} points
 * @param {number} [tension=0.5] Spline tension (0.5 is standard Centripetal/Catmull-Rom)
 * @returns {Array<{x: number, y: number}>} Smoothed array of points
 */
export function smoothPoints(points, tension = 0.5) {
  if (!points || points.length <= 2) {
    return points ? points.map((p) => ({ ...p })) : [];
  }

  const smoothed = [];
  const samplesPerSegment = 6;
  const n = points.length;

  for (let i = 0; i < n - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : { x: 2 * points[0].x - points[1].x, y: 2 * points[0].y - points[1].y };
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < n - 2 ? points[i + 2] : { x: 2 * points[n - 1].x - points[n - 2].x, y: 2 * points[n - 1].y - points[n - 2].y };

    for (let step = 0; step < samplesPerSegment; step++) {
      const t = step / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;

      // Catmull-Rom spline matrix basis
      const c1 = -tension * t3 + 2 * tension * t2 - tension * t;
      const c2 = (2 - tension) * t3 + (tension - 3) * t2 + 1;
      const c3 = (tension - 2) * t3 + (3 - 2 * tension) * t2 + tension * t;
      const c4 = tension * t3 - tension * t2;

      const x = c1 * p0.x + c2 * p1.x + c3 * p2.x + c4 * p3.x;
      const y = c1 * p0.y + c2 * p1.y + c3 * p2.y + c4 * p3.y;

      smoothed.push({ x, y });
    }
  }

  smoothed.push({ ...points[n - 1] });
  return smoothed;
}

/**
 * Compute the triangle vertices of an arrowhead at (toX, toY).
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {number} [size=15] Arrowhead size in pixels
 * @returns {Array<{x: number, y: number}>} Array of 3 points: [wing1, tip, wing2]
 */
export function getArrowHead(fromX, fromY, toX, toY, size = 15) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const spread = Math.PI / 6; // 30 degrees spread

  const wing1 = {
    x: toX - size * Math.cos(angle - spread),
    y: toY - size * Math.sin(angle - spread)
  };
  const tip = { x: toX, y: toY };
  const wing2 = {
    x: toX - size * Math.cos(angle + spread),
    y: toY - size * Math.sin(angle + spread)
  };

  return [wing1, tip, wing2];
}

/**
 * Rotate a 2D point around a center by an angle in radians.
 * @param {number} px
 * @param {number} py
 * @param {number} cx
 * @param {number} cy
 * @param {number} angle In radians
 * @returns {{x: number, y: number}}
 */
function rotatePoint(px, py, cx, cy, angle) {
  if (!angle) return { x: px, y: py };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos
  };
}

/**
 * Comprehensive hit-testing for any element type in world coordinates.
 * @param {number} worldX
 * @param {number} worldY
 * @param {object} element
 * @param {number} [threshold=6]
 * @returns {boolean}
 */
export function hitTestElement(worldX, worldY, element, threshold = 6) {
  if (!element) return false;

  const strokeWidth = element.strokeWidth || 2;
  const effectiveThreshold = Math.max(threshold, strokeWidth / 2 + 4);

  // Normalize rotation by transforming the test point to the unrotated local space
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const localPos = element.rotation ? rotatePoint(worldX, worldY, cx, cy, -element.rotation) : { x: worldX, y: worldY };
  const lx = localPos.x;
  const ly = localPos.y;

  const hasFill = element.fillColor && element.fillColor !== 'transparent';

  switch (element.type) {
    case 'pen': {
      if (!element.points || element.points.length === 0) return false;
      // Points in element.points are relative to element.x, element.y
      const relX = lx - element.x;
      const relY = ly - element.y;
      return isPointNearPath(relX, relY, element.points, effectiveThreshold);
    }

    case 'line': {
      if (!element.points || element.points.length < 2) {
        return isPointNearLine(lx, ly, element.x, element.y, element.x + element.width, element.y + element.height, effectiveThreshold);
      }
      const relX = lx - element.x;
      const relY = ly - element.y;
      return isPointNearPath(relX, relY, element.points, effectiveThreshold);
    }

    case 'arrow': {
      let p1, p2;
      if (element.points && element.points.length >= 2) {
        p1 = { x: element.x + element.points[0].x, y: element.y + element.points[0].y };
        p2 = { x: element.x + element.points[element.points.length - 1].x, y: element.y + element.points[element.points.length - 1].y };
        const relX = lx - element.x;
        const relY = ly - element.y;
        if (isPointNearPath(relX, relY, element.points, effectiveThreshold)) {
          return true;
        }
      } else {
        p1 = { x: element.x, y: element.y };
        p2 = { x: element.x + element.width, y: element.y + element.height };
        if (isPointNearLine(lx, ly, p1.x, p1.y, p2.x, p2.y, effectiveThreshold)) {
          return true;
        }
      }

      // Check near arrowhead
      const head = getArrowHead(p1.x, p1.y, p2.x, p2.y, 16);
      if (isPointNearLine(lx, ly, head[0].x, head[0].y, head[1].x, head[1].y, effectiveThreshold)) return true;
      if (isPointNearLine(lx, ly, head[2].x, head[2].y, head[1].x, head[1].y, effectiveThreshold)) return true;
      return false;
    }

    case 'rectangle': {
      const minX = Math.min(element.x, element.x + element.width);
      const maxX = Math.max(element.x, element.x + element.width);
      const minY = Math.min(element.y, element.y + element.height);
      const maxY = Math.max(element.y, element.y + element.height);

      if (hasFill) {
        return lx >= minX && lx <= maxX && ly >= minY && ly <= maxY;
      }

      // Check distance to 4 border segments
      const nearTop = isPointNearLine(lx, ly, minX, minY, maxX, minY, effectiveThreshold);
      const nearBottom = isPointNearLine(lx, ly, minX, maxY, maxX, maxY, effectiveThreshold);
      const nearLeft = isPointNearLine(lx, ly, minX, minY, minX, maxY, effectiveThreshold);
      const nearRight = isPointNearLine(lx, ly, maxX, minY, maxX, maxY, effectiveThreshold);

      return nearTop || nearBottom || nearLeft || nearRight;
    }

    case 'ellipse': {
      const rx = Math.abs(element.width) / 2;
      const ry = Math.abs(element.height) / 2;
      if (rx === 0 || ry === 0) return false;

      const norm = Math.pow((lx - cx) / rx, 2) + Math.pow((ly - cy) / ry, 2);

      if (hasFill) {
        return norm <= 1.05;
      }

      // Border proximity approximation
      const distFromPerimeter = Math.abs(Math.sqrt(norm) - 1) * Math.min(rx, ry);
      return distFromPerimeter <= effectiveThreshold;
    }

    case 'diamond': {
      const rx = Math.abs(element.width) / 2;
      const ry = Math.abs(element.height) / 2;
      if (rx === 0 || ry === 0) return false;

      const top = { x: cx, y: element.y };
      const right = { x: element.x + element.width, y: cy };
      const bottom = { x: cx, y: element.y + element.height };
      const left = { x: element.x, y: cy };

      if (hasFill) {
        const norm = Math.abs(lx - cx) / rx + Math.abs(ly - cy) / ry;
        return norm <= 1.05;
      }

      return (
        isPointNearLine(lx, ly, top.x, top.y, right.x, right.y, effectiveThreshold) ||
        isPointNearLine(lx, ly, right.x, right.y, bottom.x, bottom.y, effectiveThreshold) ||
        isPointNearLine(lx, ly, bottom.x, bottom.y, left.x, left.y, effectiveThreshold) ||
        isPointNearLine(lx, ly, left.x, left.y, top.x, top.y, effectiveThreshold)
      );
    }

    case 'text':
    case 'stickynote': {
      const minX = Math.min(element.x, element.x + element.width);
      const maxX = Math.max(element.x, element.x + element.width);
      const minY = Math.min(element.y, element.y + element.height);
      const maxY = Math.max(element.y, element.y + element.height);
      return lx >= minX && lx <= maxX && ly >= minY && ly <= maxY;
    }

    default:
      return pointInRect(lx, ly, element.x, element.y, element.width, element.height);
  }
}

/**
 * Get 8 resize handles for an element (corners and edge midpoints),
 * positioned in world space and rotated according to the element's rotation.
 * @param {object} element
 * @returns {Array<{id: string, x: number, y: number, cursor: string}>}
 */
export function getResizeHandles(element) {
  const minX = Math.min(element.x, element.x + element.width);
  const maxX = Math.max(element.x, element.x + element.width);
  const minY = Math.min(element.y, element.y + element.height);
  const maxY = Math.max(element.y, element.y + element.height);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  const rawHandles = [
    { id: 'nw', x: minX, y: minY, cursor: 'nwse-resize' },
    { id: 'n',  x: midX, y: minY, cursor: 'ns-resize' },
    { id: 'ne', x: maxX, y: minY, cursor: 'nesw-resize' },
    { id: 'e',  x: maxX, y: midY, cursor: 'ew-resize' },
    { id: 'se', x: maxX, y: maxY, cursor: 'nwse-resize' },
    { id: 's',  x: midX, y: maxY, cursor: 'ns-resize' },
    { id: 'sw', x: minX, y: maxY, cursor: 'nesw-resize' },
    { id: 'w',  x: minX, y: midY, cursor: 'ew-resize' }
  ];

  if (!element.rotation) {
    return rawHandles;
  }

  return rawHandles.map((handle) => {
    const rotated = rotatePoint(handle.x, handle.y, cx, cy, element.rotation);
    return {
      ...handle,
      x: rotated.x,
      y: rotated.y
    };
  });
}

/**
 * Throttle function execution to at most once per delay milliseconds.
 * @param {Function} fn
 * @param {number} delay In milliseconds
 * @returns {Function}
 */
export function throttle(fn, delay) {
  let lastCall = 0;
  let timerId = null;
  let lastArgs = null;

  return function throttled(...args) {
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    if (remaining <= 0) {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      lastCall = now;
      fn.apply(this, args);
    } else if (!timerId) {
      lastArgs = args;
      timerId = setTimeout(() => {
        lastCall = Date.now();
        timerId = null;
        fn.apply(this, lastArgs);
      }, remaining);
    } else {
      lastArgs = args;
    }
  };
}

/**
 * Debounce function execution until delay milliseconds have elapsed since last call.
 * @param {Function} fn
 * @param {number} delay In milliseconds
 * @returns {Function}
 */
export function debounce(fn, delay) {
  let timerId = null;

  const debounced = function (...args) {
    if (timerId) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      timerId = null;
      fn.apply(this, args);
    }, delay);
  };

  debounced.cancel = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  debounced.flush = function (...args) {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
      fn.apply(this, args);
    }
  };

  return debounced;
}

/**
 * Convert screen coordinates (canvas pixel coordinates) to world coordinates.
 * @param {number} screenX
 * @param {number} screenY
 * @param {{x: number, y: number, zoom: number}} camera
 * @returns {{x: number, y: number}}
 */
export function screenToWorld(screenX, screenY, camera) {
  const zoom = camera.zoom || 1;
  return {
    x: (screenX - camera.x) / zoom,
    y: (screenY - camera.y) / zoom
  };
}

/**
 * Convert world coordinates to screen coordinates (canvas pixel coordinates).
 * @param {number} worldX
 * @param {number} worldY
 * @param {{x: number, y: number, zoom: number}} camera
 * @returns {{x: number, y: number}}
 */
export function worldToScreen(worldX, worldY, camera) {
  const zoom = camera.zoom || 1;
  return {
    x: worldX * zoom + camera.x,
    y: worldY * zoom + camera.y
  };
}
