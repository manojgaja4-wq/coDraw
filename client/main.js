/**
 * CoDraw - Application Main Controller
 * Links DOM controls, Pointer Event handlers, FPS tracking, remote cursor management,
 * keyboard shortcuts, and WebSocket network events.
 */

document.addEventListener('DOMContentLoaded', () => {

  // ==========================================
  // 1. DOM Elements & State
  // ==========================================
  const mainCanvas = document.getElementById('main-canvas');
  const activeCanvas = document.getElementById('active-canvas');
  const cursorOverlay = document.getElementById('cursor-overlay');

  const roomInput = document.getElementById('room-input');
  const btnCopyRoom = document.getElementById('btn-copy-room');
  const userCountEl = document.getElementById('user-count');
  const usersAvatarsEl = document.getElementById('users-avatars');

  const valFps = document.getElementById('val-fps');
  const valLatency = document.getElementById('val-latency');
  const connectionBadge = document.getElementById('connection-badge');
  const statusText = document.getElementById('status-text');

  const selfColorDot = document.getElementById('self-color-indicator');
  const selfNameEl = document.getElementById('self-name');

  const toolBtns = document.querySelectorAll('.tool-btn');
  const swatches = document.querySelectorAll('.swatch');
  const customColorInput = document.getElementById('custom-color');
  const pickerPreview = document.getElementById('picker-preview');
  const strokeWidthInput = document.getElementById('stroke-width');
  const strokePreviewDot = document.getElementById('stroke-preview-dot');
  const strokeVal = document.getElementById('stroke-val');

  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const btnClear = document.getElementById('btn-clear');
  const btnExport = document.getElementById('btn-export');
  const exportMenu = document.getElementById('export-menu');
  const exportPng = document.getElementById('export-png');
  const exportSvg = document.getElementById('export-svg');
  const exportJson = document.getElementById('export-json');

  const toastContainer = document.getElementById('toast-container');

  // Parse Room ID from URL parameter (e.g. ?room=design-room)
  const urlParams = new URLSearchParams(window.location.search);
  let currentRoomId = urlParams.get('room') || 'main';
  roomInput.value = currentRoomId;

  // Initialize Engines
  const canvasEngine = new CanvasEngine(mainCanvas, activeCanvas);
  const wsClient = new WebSocketClient();

  // Local user identity
  let currentUser = null;

  // Cursors Map: userId -> DOMElement
  const cursorElements = new Map();

  // Throttled cursor transmission
  let lastCursorSend = 0;

  // FPS Counter
  let frameCount = 0;
  let lastFpsCalc = performance.now();

  function startFpsCounter() {
    function loop(now) {
      frameCount++;
      if (now - lastFpsCalc >= 1000) {
        valFps.textContent = Math.round((frameCount * 1000) / (now - lastFpsCalc));
        frameCount = 0;
        lastFpsCalc = now;
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
  startFpsCounter();

  // Toast Helper
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ==========================================
  // 2. Network Event Listeners & Standalone Mode
  // ==========================================
  wsClient.on('_connection_change', ({ status }) => {
    connectionBadge.className = `status-badge ${status}`;
    if (status === 'connected') {
      statusText.textContent = 'Live Connected';
      showToast('Connected to Live WebSocket Server!', 'success');
      wsClient.send('JOIN_ROOM', { roomId: currentRoomId });
    } else if (status === 'disconnected' || status === 'failed' || status === 'error') {
      statusBadgeToStandalone();
    }
  });

  function statusBadgeToStandalone() {
    connectionBadge.className = 'status-badge connected';
    statusText.textContent = 'Standalone Mode';
    if (!currentUser) {
      currentUser = {
        id: 'local_user',
        username: 'Draw Pad User',
        color: '#3b82f6'
      };
      selfNameEl.textContent = currentUser.username;
      selfColorDot.style.background = currentUser.color;
      updateOnlineUsers([currentUser]);
    }
  }

  // Fallback to Standalone Mode if offline after 2 seconds
  setTimeout(() => {
    if (!wsClient.isConnected) {
      statusBadgeToStandalone();
    }
  }, 1500);

  wsClient.on('_latency_update', ({ latency }) => {
    valLatency.textContent = latency;
  });

  wsClient.on('ROOM_JOINED', (payload) => {
    currentUser = payload.user;
    selfNameEl.textContent = currentUser.username;
    selfColorDot.style.background = currentUser.color;

    updateOnlineUsers(payload.onlineUsers);

    if (payload.canvasState && payload.canvasState.operations) {
      canvasEngine.setHistory(payload.canvasState.operations);
    }

    showToast(`Joined Room: "${payload.roomId}" as ${currentUser.username}`, 'success');
  });

  wsClient.on('USER_JOINED', (payload) => {
    updateOnlineUsers(payload.onlineUsers);
    showToast(`${payload.user.username} joined the room!`, 'info');
  });

  wsClient.on('USER_LEFT', (payload) => {
    updateOnlineUsers(payload.onlineUsers);
    removeCursor(payload.userId);
    showToast(`${payload.username} left the room.`, 'info');
  });

  wsClient.on('USER_CURSOR', (payload) => {
    updateRemoteCursor(payload);
  });

  wsClient.on('REMOTE_STROKE_START', (payload) => {
    canvasEngine.startRemoteStroke(payload);
  });

  wsClient.on('REMOTE_STROKE_POINT', (payload) => {
    canvasEngine.addRemotePoint(payload);
  });

  wsClient.on('OP_ADD', (payload) => {
    if (payload.operation) {
      canvasEngine.removeRemoteStroke(payload.operation.id);
    }
    if (payload.canvasState && payload.canvasState.operations) {
      canvasEngine.setHistory(payload.canvasState.operations);
    }
  });

  wsClient.on('OP_UNDO', (payload) => {
    if (payload.canvasState && payload.canvasState.operations) {
      canvasEngine.setHistory(payload.canvasState.operations);
    }
    showToast(`Undo performed by ${payload.undoneBy}`, 'warning');
  });

  wsClient.on('OP_REDO', (payload) => {
    if (payload.canvasState && payload.canvasState.operations) {
      canvasEngine.setHistory(payload.canvasState.operations);
    }
    showToast(`Redo performed by ${payload.redoneBy}`, 'info');
  });

  wsClient.on('CANVAS_CLEARED', (payload) => {
    if (payload.canvasState && payload.canvasState.operations) {
      canvasEngine.setHistory(payload.canvasState.operations);
    }
    showToast(`Canvas cleared by ${payload.clearedBy}`, 'danger');
  });

  // Start Connection
  wsClient.connect();

  // ==========================================
  // 3. User & Remote Cursor Management
  // ==========================================
  function updateOnlineUsers(users) {
    userCountEl.textContent = users.length;
    usersAvatarsEl.innerHTML = '';

    users.forEach(u => {
      const avatar = document.createElement('div');
      avatar.className = 'user-avatar';
      avatar.style.background = u.color;
      avatar.textContent = u.username.charAt(0).toUpperCase();
      avatar.title = `${u.username} ${u.id === currentUser?.id ? '(You)' : ''}`;
      usersAvatarsEl.appendChild(avatar);
    });
  }

  function updateRemoteCursor(data) {
    let el = cursorElements.get(data.userId);
    if (!el) {
      el = document.createElement('div');
      el.className = 'remote-cursor';
      el.innerHTML = `
        <div class="cursor-pointer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${data.color}" stroke="#ffffff" stroke-width="1.5">
            <path d="M3 3l7 18 3-7 7-3L3 3z"/>
          </svg>
        </div>
        <div class="cursor-flag" style="background: ${data.color};">${data.username}</div>
      `;
      cursorOverlay.appendChild(el);
      cursorElements.set(data.userId, el);
    }

    el.style.transform = `translate3d(${data.x}px, ${data.y}px, 0)`;
  }

  function removeCursor(userId) {
    const el = cursorElements.get(userId);
    if (el) {
      el.remove();
      cursorElements.delete(userId);
    }
  }

  // ==========================================
  // 4. Pointer Event Handlers (Mouse, Stylus, Touch)
  // ==========================================
  
  // Disable context menu on canvas so right-click holding draws smoothly
  mainCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  activeCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function getCanvasCoords(e) {
    const rect = mainCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  mainCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { mainCanvas.setPointerCapture(e.pointerId); } catch (err) {}

    const coords = getCanvasCoords(e);
    const strokeData = canvasEngine.startLocalStroke(coords.x, coords.y);

    if (strokeData) {
      wsClient.send('STROKE_START', strokeData);
    }
  });

  mainCanvas.addEventListener('pointermove', (e) => {
    e.preventDefault();
    const coords = getCanvasCoords(e);

    // Throttled Cursor Position Sending (~40 Hz)
    const now = Date.now();
    if (now - lastCursorSend > 25) {
      wsClient.send('CURSOR_MOVE', { x: coords.x, y: coords.y });
      lastCursorSend = now;
    }

    if (canvasEngine.isDrawing) {
      const pointData = canvasEngine.addLocalPoint(coords.x, coords.y);
      if (pointData) {
        wsClient.send('STROKE_POINT', pointData);
      }
    }
  });

  const handlePointerUp = (e) => {
    if (canvasEngine.isDrawing) {
      if (e.pointerId) {
        try { mainCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      const endData = canvasEngine.endLocalStroke();
      if (endData) {
        wsClient.send('STROKE_END', endData);
      }
    }
  };

  mainCanvas.addEventListener('pointerup', handlePointerUp);
  mainCanvas.addEventListener('pointercancel', handlePointerUp);

  // ==========================================
  // 5. UI Controls & Toolbar Listeners
  // ==========================================

  // Tool Switching
  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toolBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tool = btn.getAttribute('data-tool');
      canvasEngine.setTool(tool);

      if (tool === 'eraser') {
        mainCanvas.style.cursor = 'cell';
      } else {
        mainCanvas.style.cursor = 'crosshair';
      }
    });
  });

  // Color Swatches
  swatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      swatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');

      const color = swatch.getAttribute('data-color');
      canvasEngine.setColor(color);
      customColorInput.value = color;
      pickerPreview.style.background = color;
    });
  });

  // Custom Color Input
  customColorInput.addEventListener('input', (e) => {
    const color = e.target.value;
    canvasEngine.setColor(color);
    swatches.forEach(s => s.classList.remove('active'));
    pickerPreview.style.background = color;
  });

  // Stroke Width Slider
  strokeWidthInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    strokeVal.textContent = `${val}px`;
    strokePreviewDot.style.width = `${Math.max(3, val)}px`;
    strokePreviewDot.style.height = `${Math.max(3, val)}px`;
    canvasEngine.setStrokeWidth(val);
  });

  // Actions
  btnUndo.addEventListener('click', () => {
    if (wsClient.isConnected) {
      wsClient.send('UNDO', { mode: 'global' });
    } else {
      for (let i = canvasEngine.operations.length - 1; i >= 0; i--) {
        if (!canvasEngine.operations[i].isUndone) {
          canvasEngine.operations[i].isUndone = true;
          canvasEngine.redrawMainCanvas();
          showToast('Undo performed', 'warning');
          break;
        }
      }
    }
  });

  btnRedo.addEventListener('click', () => {
    if (wsClient.isConnected) {
      wsClient.send('REDO', { mode: 'global' });
    } else {
      for (let i = canvasEngine.operations.length - 1; i >= 0; i--) {
        if (canvasEngine.operations[i].isUndone) {
          canvasEngine.operations[i].isUndone = false;
          canvasEngine.redrawMainCanvas();
          showToast('Redo performed', 'info');
          break;
        }
      }
    }
  });

  btnClear.addEventListener('click', () => {
    if (confirm('Clear the canvas?')) {
      if (wsClient.isConnected) {
        wsClient.send('CLEAR_CANVAS');
      } else {
        canvasEngine.operations = [];
        canvasEngine.redrawMainCanvas();
        showToast('Canvas cleared', 'danger');
      }
    }
  });

  // Export Menu
  btnExport.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    exportMenu.classList.remove('show');
  });

  exportPng.addEventListener('click', () => canvasEngine.exportPNG());
  exportSvg.addEventListener('click', () => canvasEngine.exportSVG());
  exportJson.addEventListener('click', () => canvasEngine.exportJSON());

  // Copy Room Link
  btnCopyRoom.addEventListener('click', () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Room link copied to clipboard!', 'success');
    }).catch(() => {
      showToast(`Room Code: ${currentRoomId}`, 'info');
    });
  });

  // Room Switching via Input
  roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const newRoom = roomInput.value.trim().toLowerCase();
      if (newRoom && newRoom !== currentRoomId) {
        currentRoomId = newRoom;
        window.history.pushState({}, '', `?room=${currentRoomId}`);
        wsClient.send('JOIN_ROOM', { roomId: currentRoomId });
      }
    }
  });

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) {
          wsClient.send('REDO', { mode: 'global' });
        } else {
          wsClient.send('UNDO', { mode: 'global' });
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        wsClient.send('REDO', { mode: 'global' });
      }
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'b':
        document.querySelector('[data-tool="brush"]').click();
        break;
      case 'e':
        document.querySelector('[data-tool="eraser"]').click();
        break;
      case 'l':
        document.querySelector('[data-tool="line"]').click();
        break;
      case 'r':
        document.querySelector('[data-tool="rectangle"]').click();
        break;
      case 'c':
        document.querySelector('[data-tool="circle"]').click();
        break;
      case 'delete':
      case 'backspace':
        btnClear.click();
        break;
    }
  });
});
