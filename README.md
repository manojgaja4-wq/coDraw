# 🎨 CoDraw - Real-Time Collaborative Drawing Canvas

[![Live Demo](https://img.shields.io/badge/Live_Demo-GitHub_Pages-brightgreen?style=for-the-badge&logo=github)](https://manojgaja4-wq.github.io/coDraw/)

> 🌐 **Live Demo URL**: **[https://manojgaja4-wq.github.io/coDraw/](https://manojgaja4-wq.github.io/coDraw/)**

CoDraw is a production-grade, zero-framework multi-user drawing application built with **Vanilla JavaScript/TypeScript**, **HTML5 Canvas**, and **Node.js WebSockets**. It features sub-frame real-time stroke streaming, deterministic global multi-user undo/redo state synchronization, live remote user cursors, room isolation, path smoothing, and PNG/SVG/JSON vector exports.

---

## 🚀 Quick Start Instructions

### Prerequisites
- Node.js (v18.x or higher) installed.

### Installation & Launch

1. Clone or open the repository:
   ```bash
   cd collaborative-canvas
   ```

2. Run the application:
   ```bash
   npm start
   # or on Windows:
   start.bat
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## 👥 How to Test with Multiple Users

1. Open `http://localhost:3000` in **Window 1**.
2. Open `http://localhost:3000` in **Window 2** (or in an Incognito / Private window, or on a secondary device on the local network).
3. Both clients will automatically connect to the default room (`main`), receive unique assigned avatar colors and creative names, and appear in each other's online user list.
4. **Real-time Drawing**: Draw with the brush in Window 1 — witness the stroke path extending **live in real-time** in Window 2 frame-by-frame.
5. **Live Cursor Indicators**: Move your cursor around the canvas in Window 1 — see your cursor arrow and floating name badge follow smoothly in Window 2.
6. **Global Undo/Redo**: Draw a stroke in Window 1, draw a shape in Window 2, then click **Undo** (`Ctrl+Z`) in Window 1. Notice how the global operation state updates consistently across both users without corrupting remaining drawings.
7. **Room System Isolation**: Change the room name in the top bar to `design-room` and press Enter. Notice how drawing state is isolated per room.

---

## ⚡ Features & Capabilities

- 🖌️ **Drawing Tools**: Brush, Eraser (`destination-out` composite blending), Line, Rectangle, Circle.
- 🎨 **Color & Palette System**: 8 curated color swatches + custom HTML5 color picker.
- 📏 **Stroke Width Adjustment**: Dynamic slider with live pixel preview indicator (1px - 50px).
- ↩️ **Global Multi-User Undo / Redo**: Server-authoritative deterministic action log with state synchronization.
- 📍 **Remote Cursor Tracking**: Floating user cursor arrows with custom user color flags.
- 🚀 **Performance Optimization**: Quadratic Bezier path smoothing, multi-layer canvas stacks, and 60 FPS rendering.
- 💾 **Export Options**: Download PNG image, export clean SVG vector graphics, or download JSON history.
- ⌨️ **Keyboard Shortcuts**:
  - `B`: Brush tool
  - `E`: Eraser tool
  - `L`: Line tool
  - `R`: Rectangle tool
  - `C`: Circle tool
  - `Ctrl + Z`: Global Undo
  - `Ctrl + Y` / `Ctrl + Shift + Z`: Global Redo
  - `Delete`: Clear Canvas

---

## ⏱️ Time Spent

- **Architecture & Protocol Design**: 1 hour
- **Server Engine & WebSocket Handler**: 1.5 hours
- **Canvas Rendering Engine & Bezier Smoothing**: 2 hours
- **Global Undo/Redo & State Sync**: 1.5 hours
- **UI Design System & Polish**: 1 hour
- **Documentation & Verification Suite**: 1 hour
- **Total Time**: ~8 hours

---

## ⚠️ Known Limitations & Considerations

1. **Canvas Size & Resizing**: Canvas scales with high-DPI device pixel ratios (`window.devicePixelRatio`). When resizing windows, operations scale relative to canvas coordinates.
2. **Infinite Canvas Pan/Zoom**: The current canvas viewport is fixed to browser window bounds. Matrix transforms for infinite panning/zooming can be added as a future extension.
