# Fleck — Visual Notes & Sketchpad ✏️

**Fleck** is a drawing-first, visual note-taking web application with an infinite canvas and organic hand-drawn aesthetics inspired by Excalidraw. It puts sketch-based thinking in the foreground while providing rich structured tools, multiline text, sticky notes, and multi-page organization across every device (desktop, iPad/tablet, and mobile).

---

## ✨ Features

- **Drawing in the Foreground**: Direct, frictionless sketchpad where drawing, diagramming, and scribbling take center stage.
- **Organic Hand-Drawn Aesthetics**: Subtle jitter lines with seeded PRNG stabilization, Catmull-Rom spline curves, and natural sketch strokes that feel tactile and organic.
- **Infinite Canvas**: Smooth 60fps pan and pinch-to-zoom (from 10% to 1000%) with an adaptive dot grid that scales and fades dynamically.
- **Full Set of Creation Tools**:
  - ✏️ **Pen**: Smooth freehand drawing with quadratic curves and path simplification.
  - 📏 **Line & Arrow**: Straight lines and vector-aligned directional arrows.
  - 🔲 **Shapes**: Rectangles, Ellipses, and Diamonds with fill and border customization.
  - 📝 **Sticky Notes**: Quick pastel color stickies with embedded typography.
  - ✍️ **Text**: Word-wrapping multiline text boxes.
  - 🧼 **Eraser**: Fast continuous stroke and object erasing.
  - 🔍 **Selection & Transform**: Move, box-select, and 8-point interactive resize handles.
- **Multi-Page & Notes System**: Organize your notes into multiple pages. Create, switch, rename, and delete pages with auto-saving to local storage.
- **Device Independent & PWA Ready**:
  - **Desktop**: Mouse and trackpad controls, full keyboard shortcuts, and right-click context menu.
  - **Tablet & Stylus**: Apple Pencil, S-Pen, and touch stylus support with pointer pressure awareness.
  - **Mobile Phone**: Automatic bottom-docked navigation bar, touch-friendly 44px+ hit targets, and two-finger pinch-to-zoom.
  - **100% Offline Capability**: Includes a Service Worker (`sw.js`) and Web App Manifest (`manifest.json`) for installing directly to home screens on iOS, Android, and Desktop.
- **Minimap Navigation**: Live bird's-eye view thumbnail showing your entire drawing with a draggable viewport box.
- **Color & Style Engine**: Live stroke and fill palettes, transparent fills, stroke width sliders, and opacity controls.
- **Undo / Redo Stack**: Up to 50 levels of state snapshots with deep cloning.
- **Dark & Light Mode**: Custom designed palette tailored for high-contrast sketching without eye strain.
- **High-Resolution Export**: 2x scaled PNG export that auto-crops to your drawings and removes UI artifacts.

---

## 🚀 Quick Start / How to Run

Because Fleck is a modern client-side web application built with ES6 modules, you can run it using any local static file server:

### Option 1: Python (Built-in)
```bash
# In the project directory:
python -m http.server 8000
```
Then open: [http://localhost:8000](http://localhost:8000)

### Option 2: Node.js (npx serve)
```bash
npx serve .
```

### Option 3: GitHub Pages / Vercel / Netlify
Simply deploy or push this repository to GitHub and enable **GitHub Pages** (Settings > Pages > Branch: `main` > `/root`). Fleck has zero build steps and runs instantly in all modern browsers.

---

> **Important:** PWA installation and service workers require HTTPS in production. `localhost` is also treated as secure for local testing.

## 📱 Installing as an App (PWA)

- **iPhone / iPad (Safari)**: Tap the **Share** button (`⎋`) and choose **"Add to Home Screen"**.
- **Android (Chrome)**: Tap the three dots menu (`⋮`) and select **"Install app"** or **"Add to Home screen"**.
- **Mac / Windows / Linux (Chrome or Edge)**: Click the install icon in the address bar or select **"Install Fleck"** from the browser menu.

On Windows, open the deployed HTTPS address in Edge or Chrome, then choose **Install Fleck**. The result is a lightweight standalone window with a Start Menu/taskbar shortcut; it uses the browser's existing web engine rather than bundling a second copy of Chromium.

Once installed, Fleck opens in a distraction-free standalone window and works completely offline without an internet connection. The current app stores notes in browser-local storage, so data is **not yet synchronized between devices**. Cross-device synchronization requires adding an authenticated cloud API and a shared database; installing the PWA alone does not provide that.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>V</kbd> | **Select** / Transform tool |
| <kbd>P</kbd> | **Pen** / Freehand draw tool |
| <kbd>L</kbd> | **Line** tool |
| <kbd>A</kbd> | **Arrow** tool |
| <kbd>R</kbd> | **Rectangle** tool |
| <kbd>E</kbd> | **Ellipse** tool |
| <kbd>D</kbd> | **Diamond** tool |
| <kbd>T</kbd> | **Text** tool |
| <kbd>S</kbd> | **Sticky Note** tool |
| <kbd>X</kbd> | **Eraser** tool |
| <kbd>Space</kbd> + Drag | **Pan** the canvas |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> | **Undo** |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | **Redo** |
| <kbd>Ctrl</kbd> + <kbd>A</kbd> | **Select All** elements |
| <kbd>Ctrl</kbd> + <kbd>C</kbd> | **Copy** selected elements |
| <kbd>Ctrl</kbd> + <kbd>V</kbd> | **Paste** elements |
| <kbd>Ctrl</kbd> + <kbd>D</kbd> | **Duplicate** selected elements |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | **Save** notes manually |
| <kbd>Ctrl</kbd> + <kbd>E</kbd> | **Export** as PNG image |
| <kbd>Del</kbd> / <kbd>Backspace</kbd> | **Delete** selected elements |
| <kbd>]</kbd> | **Bring to Front** |
| <kbd>[</kbd> | **Send to Back** |
| <kbd>+</kbd> / <kbd>=</kbd> | **Zoom In** |
| <kbd>-</kbd> | **Zoom Out** |
| <kbd>0</kbd> | **Reset Zoom** (100%) |
| <kbd>M</kbd> | Toggle **Minimap** |
| <kbd>Esc</kbd> | Deselect / Close modal & context menu |

---

## 👆 Touch & Gesture Controls

- **Single Finger / Stylus**: Draw or create shapes with the active tool.
- **Two-Finger Pinch**: Zoom in and out centered on your fingers.
- **Two-Finger Drag**: Pan smoothly across the infinite canvas.
- **Double Tap (Text / Sticky)**: Open inline editor to modify content.
- **Right Click / Long Press**: Open canvas context menu.

---

## 🛠️ Project Structure

```text
fleck/
├── index.html          # Semantic layout, top toolbar, responsive sidebar & modals
├── manifest.json       # PWA manifest for multi-device installation
├── sw.js               # Service Worker for 100% offline persistence
├── icon.svg            # Scalable vector application icon
├── css/
│   └── style.css       # Complete CSS design system, glassmorphism, responsive styles
└── js/
    ├── utils.js        # Geometry, splines, coordinate transforms, hit testing
    ├── history.js      # Undo/redo stack management
    ├── storage.js      # LocalStorage persistence & import/export schema
    ├── renderer.js     # Canvas rendering engine with hand-drawn organic styling
    ├── tools.js        # Unified tool manager & pointer interaction system
    └── app.js          # Core app controller, page management, and UI sync
```

---

## 📄 License
MIT License. Free to use, modify, and build upon.
