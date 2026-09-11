/**
 * CoDraw - HTML5 Canvas Engine
 * High-performance multi-layer rendering, quadratic path smoothing, vector tool operations,
 * offscreen buffer redrawing, and PNG/SVG/JSON export generators.
 */

class CanvasEngine {
  constructor(mainCanvas, activeCanvas) {
    this.mainCanvas = mainCanvas;
    this.activeCanvas = activeCanvas;

    this.mainCtx = mainCanvas.getContext('2d');
    this.activeCtx = activeCanvas.getContext('2d');

    // Drawing state
    this.currentTool = 'brush';
    this.currentColor = '#000000';
    this.currentStrokeWidth = 5;

    // Operation history from server
    this.operations = [];

    // Local in-flight stroke
    this.isDrawing = false;
    this.localStrokeId = null;
    this.localPoints = [];
    this.shapeStart = null; // {x, y}

    // Remote in-flight strokes: strokeId -> strokeData
    this.activeRemoteStrokes = new Map();

    // Resize observer & DPR scaling
    this.dpr = window.devicePixelRatio || 1;
    this.width = 0;
    this.height = 0;
    
    this.initCanvasSize();
    window.addEventListener('resize', () => this.initCanvasSize());
  }

  /**
   * Initializes high-DPI crisp canvas sizing
   */
  initCanvasSize() {
    const parent = this.mainCanvas.parentElement;
    this.width = parent.clientWidth;
    this.height = parent.clientHeight;

    [this.mainCanvas, this.activeCanvas].forEach(canvas => {
      canvas.width = this.width * this.dpr;
      canvas.height = this.height * this.dpr;
      canvas.style.width = `${this.width}px`;
      canvas.style.height = `${this.height}px`;
    });

    this.redrawMainCanvas();
  }

  setTool(tool) {
    this.currentTool = tool;
  }

  setColor(color) {
    this.currentColor = color;
  }

  setStrokeWidth(width) {
    this.currentStrokeWidth = width;
  }

  setHistory(operations) {
    this.operations = operations || [];
    this.redrawMainCanvas();
  }

  /**
   * Clears and re-renders all finalized non-undone operations from history onto main canvas
   */
  redrawMainCanvas() {
    // Reset transform to 1:1 identity and clear entire raw pixel buffer
    this.mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);

    // Apply DPR scale exactly once
    this.mainCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Render Whiteboard Solid White Background
    this.mainCtx.fillStyle = '#ffffff';
    this.mainCtx.fillRect(0, 0, this.width, this.height);

    // Draw Subtle Whiteboard Grid Lines
    this.mainCtx.strokeStyle = '#f1f5f9';
    this.mainCtx.lineWidth = 1;
    const gridSize = 24;
    this.mainCtx.beginPath();
    for (let x = gridSize; x < this.width; x += gridSize) {
      this.mainCtx.moveTo(x, 0);
      this.mainCtx.lineTo(x, this.height);
    }
    for (let y = gridSize; y < this.height; y += gridSize) {
      this.mainCtx.moveTo(0, y);
      this.mainCtx.lineTo(this.width, y);
    }
    this.mainCtx.stroke();

    // Sort active operations by sequence ID to guarantee exact deterministic order
    const activeOps = this.operations.filter(op => !op.isUndone);
    activeOps.sort((a, b) => (a.seqId || 0) - (b.seqId || 0));

    for (const op of activeOps) {
      this.drawOperationOnCtx(this.mainCtx, op);
    }
  }

  /**
   * Re-renders active canvas layer (in-flight local shape preview + remote live strokes)
   */
  redrawActiveCanvas() {
    // Reset transform to 1:1 identity and clear entire raw pixel buffer
    this.activeCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.activeCtx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);

    // Apply DPR scale exactly once
    this.activeCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Draw active local stroke in progress
    if (this.isDrawing && this.localPoints && this.localPoints.length > 0) {
      if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
        this.drawStrokePath(this.activeCtx, this.currentTool, this.currentColor, this.currentStrokeWidth, this.localPoints);
      } else if (this.shapeStart && this.localPoints.length > 0) {
        const lastPt = this.localPoints[this.localPoints.length - 1];
        this.drawShape(this.activeCtx, this.currentTool, this.currentColor, this.currentStrokeWidth, {
          startX: this.shapeStart.x,
          startY: this.shapeStart.y,
          endX: lastPt.x,
          endY: lastPt.y
        });
      }
    }

    // Draw active remote strokes
    for (const stroke of this.activeRemoteStrokes.values()) {
      this.drawStrokePath(this.activeCtx, stroke.tool, stroke.colorVal, stroke.strokeWidth, stroke.points);
    }
  }

  /**
   * Draws a single operation onto any 2D canvas context
   */
  drawOperationOnCtx(ctx, op) {
    if (op.shapeData) {
      this.drawShape(ctx, op.tool, op.color, op.strokeWidth, op.shapeData);
    } else if (op.points && op.points.length > 0) {
      this.drawStrokePath(ctx, op.tool, op.color, op.strokeWidth, op.points);
    }
  }

  /**
   * Renders smooth freehand stroke path using Quadratic Bezier Curve interpolation
   */
  drawStrokePath(ctx, tool, color, width, points) {
    if (!points || points.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = width * 2; // Extra broad eraser
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
    }

    ctx.beginPath();

    const drawRadius = tool === 'eraser' ? width : width / 2;

    if (points.length === 1) {
      // Single dot stroke
      ctx.arc(points[0].x, points[0].y, drawRadius, 0, Math.PI * 2);
      ctx.fillStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.fill();
    } else if (points.length === 2) {
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
    } else {
      // Quadratic Bezier Curve Smoothing across successive points
      ctx.moveTo(points[0].x, points[0].y);

      for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
      }

      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Renders Vector Shape (Line, Rectangle, Circle)
   */
  drawShape(ctx, tool, color, width, shapeData) {
    const { startX, startY, endX, endY } = shapeData;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();

    if (tool === 'line') {
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    } else if (tool === 'rectangle') {
      const rectX = Math.min(startX, endX);
      const rectY = Math.min(startY, endY);
      const rectW = Math.abs(endX - startX);
      const rectH = Math.abs(endY - startY);
      ctx.strokeRect(rectX, rectY, rectW, rectH);
    } else if (tool === 'circle') {
      const radiusX = Math.abs(endX - startX) / 2;
      const radiusY = Math.abs(endY - startY) / 2;
      const centerX = Math.min(startX, endX) + radiusX;
      const centerY = Math.min(startY, endY) + radiusY;
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ==========================================
  // Local In-Flight Stroke Methods
  // ==========================================
  startLocalStroke(x, y) {
    this.isDrawing = true;
    this.localStrokeId = `str_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.localPoints = [{ x, y }];
    this.shapeStart = { x, y };

    if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
      this.drawStrokePath(this.activeCtx, this.currentTool, this.currentColor, this.currentStrokeWidth, this.localPoints);
    }

    return {
      strokeId: this.localStrokeId,
      tool: this.currentTool,
      color: this.currentColor,
      strokeWidth: this.currentStrokeWidth,
      x,
      y
    };
  }

  addLocalPoint(x, y) {
    if (!this.isDrawing) return null;

    this.localPoints.push({ x, y });

    if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
      // Re-render active layer for smooth preview
      this.redrawActiveCanvas();
      this.drawStrokePath(this.activeCtx, this.currentTool, this.currentColor, this.currentStrokeWidth, this.localPoints);
    } else {
      // Shape Preview (Line, Rectangle, Circle)
      this.redrawActiveCanvas();
      this.drawShape(this.activeCtx, this.currentTool, this.currentColor, this.currentStrokeWidth, {
        startX: this.shapeStart.x,
        startY: this.shapeStart.y,
        endX: x,
        endY: y
      });
    }

    return {
      strokeId: this.localStrokeId,
      x,
      y
    };
  }

  endLocalStroke() {
    if (!this.isDrawing) return null;

    this.isDrawing = false;
    const strokeId = this.localStrokeId;
    const points = [...this.localPoints];
    const tool = this.currentTool;
    const color = this.currentColor;
    const strokeWidth = this.currentStrokeWidth;

    let shapeData = null;
    if (tool !== 'brush' && tool !== 'eraser' && points.length > 0) {
      const endPoint = points[points.length - 1];
      shapeData = {
        startX: this.shapeStart.x,
        startY: this.shapeStart.y,
        endX: endPoint.x,
        endY: endPoint.y
      };
    }

    // Immediately commit operation to local history & redraw main canvas instantly
    const localOp = {
      id: strokeId,
      seqId: Date.now(),
      tool,
      color,
      strokeWidth,
      points,
      shapeData,
      isUndone: false
    };

    // Avoid duplicate if op already exists
    if (!this.operations.some(op => op.id === strokeId)) {
      this.operations.push(localOp);
    }

    // Clear active canvas layer and update main canvas immediately
    this.redrawActiveCanvas();
    this.redrawMainCanvas();

    this.localStrokeId = null;
    this.localPoints = [];
    this.shapeStart = null;

    return {
      strokeId,
      tool,
      color,
      strokeWidth,
      points,
      shapeData
    };
  }

  // ==========================================
  // Remote In-Flight Stroke Methods
  // ==========================================
  startRemoteStroke(data) {
    this.activeRemoteStrokes.set(data.strokeId, {
      strokeId: data.strokeId,
      userId: data.userId,
      username: data.username,
      colorVal: data.colorVal,
      tool: data.tool,
      strokeWidth: data.strokeWidth,
      points: [{ x: data.x, y: data.y }]
    });
    this.redrawActiveCanvas();
  }

  addRemotePoint(data) {
    const stroke = this.activeRemoteStrokes.get(data.strokeId);
    if (stroke) {
      stroke.points.push({ x: data.x, y: data.y });
      this.redrawActiveCanvas();
    }
  }

  removeRemoteStroke(strokeId) {
    this.activeRemoteStrokes.delete(strokeId);
    this.redrawActiveCanvas();
  }

  // ==========================================
  // Export Methods
  // ==========================================
  exportPNG() {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.mainCanvas.width;
    tempCanvas.height = this.mainCanvas.height;
    const ctx = tempCanvas.getContext('2d');

    // White Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Draw main canvas contents
    ctx.drawImage(this.mainCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = `codraw-export-${Date.now()}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  }

  exportSVG() {
    const activeOps = this.operations.filter(op => !op.isUndone);
    activeOps.sort((a, b) => (a.seqId || 0) - (b.seqId || 0));

    let svgElements = '';

    for (const op of activeOps) {
      if (op.shapeData) {
        const { startX, startY, endX, endY } = op.shapeData;
        if (op.tool === 'line') {
          svgElements += `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="${op.color}" stroke-width="${op.strokeWidth}" stroke-linecap="round"/>\n`;
        } else if (op.tool === 'rectangle') {
          const rx = Math.min(startX, endX);
          const ry = Math.min(startY, endY);
          const rw = Math.abs(endX - startX);
          const rh = Math.abs(endY - startY);
          svgElements += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="${op.color}" stroke-width="${op.strokeWidth}" stroke-linejoin="round"/>\n`;
        } else if (op.tool === 'circle') {
          const radiusX = Math.abs(endX - startX) / 2;
          const radiusY = Math.abs(endY - startY) / 2;
          const cx = Math.min(startX, endX) + radiusX;
          const cy = Math.min(startY, endY) + radiusY;
          svgElements += `<ellipse cx="${cx}" cy="${cy}" rx="${radiusX}" ry="${radiusY}" fill="none" stroke="${op.color}" stroke-width="${op.strokeWidth}"/>\n`;
        }
      } else if (op.points && op.points.length > 0) {
        if (op.tool !== 'eraser') {
          const pts = op.points.map(p => `${p.x},${p.y}`).join(' ');
          svgElements += `<polyline points="${pts}" fill="none" stroke="${op.color}" stroke-width="${op.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>\n`;
        }
      }
    }

    const svgDoc = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${svgElements}
</svg>`;

    const blob = new Blob([svgDoc], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `codraw-vector-${Date.now()}.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  exportJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.operations, null, 2));
    const link = document.createElement('a');
    link.download = `codraw-history-${Date.now()}.json`;
    link.href = dataStr;
    link.click();
  }
}

window.CanvasEngine = CanvasEngine;
