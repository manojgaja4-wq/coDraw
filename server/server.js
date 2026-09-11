/**
 * Real-Time Collaborative Canvas - Server Entry Point
 * High-performance HTTP static file server + Native RFC 6455 WebSocket Server.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const RoomManager = require('./rooms');

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const roomManager = new RoomManager();

// MIME Types for Static File Serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ==========================================
// 1. HTTP Server for Static Assets
// ==========================================
const server = http.createServer((req, res) => {
  let reqUrl = req.url.split('?')[0];
  if (reqUrl === '/') reqUrl = '/index.html';

  const filePath = path.join(CLIENT_DIR, reqUrl);

  // Security check against directory traversal
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ==========================================
// 2. Native RFC 6455 WebSocket Handshake & Frame Handling
// ==========================================

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Builds an RFC 6455 WebSocket frame buffer from text or JSON payload
 */
function buildWSFrame(data, opcode = 0x01) {
  const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const len = payload.length;

  let header;
  if (len <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f); // FIN bit + Opcode
    header[1] = len;                     // Unmasked len
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

/**
 * Sends a WebSocket JSON message to a client socket
 */
function sendWSMessage(socket, type, payload = {}) {
  if (socket.writable) {
    try {
      socket.write(buildWSFrame({ type, payload }));
    } catch (e) {
      console.error('Socket write error:', e.message);
    }
  }
}

/**
 * Broadcasts a WebSocket message to all users in a room
 */
function broadcastToRoom(room, type, payload, excludeSocket = null) {
  const frame = buildWSFrame({ type, payload });
  for (const [s] of room.users.entries()) {
    if (s !== excludeSocket && s.writable) {
      try {
        s.write(frame);
      } catch (e) {
        // Socket errors handled on close
      }
    }
  }
}

/**
 * Parses incoming WebSocket frames from raw socket buffer
 */
function parseWSFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (buffer.length - offset < 2) break; // Need at least 2 bytes header

    const byte0 = buffer[offset];
    const byte1 = buffer[offset + 1];

    const fin = (byte0 & 0x80) !== 0;
    const opcode = byte0 & 0x0f;
    const isMasked = (byte1 & 0x80) !== 0;
    let payloadLen = byte1 & 0x7f;

    let headerSize = 2;

    if (payloadLen === 126) {
      if (buffer.length - offset < 4) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerSize += 2;
    } else if (payloadLen === 127) {
      if (buffer.length - offset < 10) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headerSize += 8;
    }

    if (isMasked) headerSize += 4; // 4 mask key bytes

    const totalFrameSize = headerSize + payloadLen;
    if (buffer.length - offset < totalFrameSize) break; // Incomplete frame

    let payload;
    if (isMasked) {
      const maskKey = buffer.subarray(offset + headerSize - 4, offset + headerSize);
      const rawPayload = buffer.subarray(offset + headerSize, offset + totalFrameSize);
      payload = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = rawPayload[i] ^ maskKey[i % 4];
      }
    } else {
      payload = buffer.subarray(offset + headerSize, offset + totalFrameSize);
    }

    frames.push({ fin, opcode, payload, totalFrameSize });
    offset += totalFrameSize;
  }

  return { frames, remainingBuffer: buffer.subarray(offset) };
}

// WebSocket Upgrade Listener
server.on('upgrade', (req, socket, head) => {
  const secKey = req.headers['sec-websocket-key'];
  const upgradeHeader = req.headers['upgrade'];

  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket' || !secKey) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  // Calculate Accept Key
  const hash = crypto.createHash('sha1')
    .update(secKey + WS_MAGIC_GUID)
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${hash}`,
    '\r\n'
  ];

  socket.write(headers.join('\r\n'));

  // Socket State Buffer
  let socketBuffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    socketBuffer = Buffer.concat([socketBuffer, chunk]);
    const { frames, remainingBuffer } = parseWSFrames(socketBuffer);
    socketBuffer = remainingBuffer;

    for (const frame of frames) {
      if (frame.opcode === 0x08) {
        // Connection Close Frame
        handleUserDisconnect(socket);
        try { socket.end(buildWSFrame('', 0x08)); } catch (e) {}
        break;
      } else if (frame.opcode === 0x09) {
        // Ping -> Pong
        try { socket.write(buildWSFrame(frame.payload, 0x0a)); } catch (e) {}
      } else if (frame.opcode === 0x01) {
        // Text JSON Frame
        try {
          const messageStr = frame.payload.toString('utf-8');
          const message = JSON.parse(messageStr);
          handleWSMessage(socket, message);
        } catch (err) {
          console.error('Failed to parse WebSocket JSON payload:', err.message);
        }
      }
    }
  });

  socket.on('error', (err) => {
    handleUserDisconnect(socket);
  });

  socket.on('close', () => {
    handleUserDisconnect(socket);
  });
});

// ==========================================
// 3. Application WebSocket Event Dispatcher
// ==========================================

function handleWSMessage(socket, message) {
  const { type, payload = {} } = message;

  if (type === 'PING') {
    sendWSMessage(socket, 'PONG', { timestamp: payload.timestamp });
    return;
  }

  if (type === 'JOIN_ROOM') {
    const room = roomManager.getOrCreateRoom(payload.roomId);
    const user = room.addUser(socket, payload.username);

    // Send acknowledgement to joining user
    sendWSMessage(socket, 'ROOM_JOINED', {
      user,
      roomId: room.id,
      onlineUsers: room.getUsersList(),
      canvasState: room.state.getSnapshot()
    });

    // Notify other room users
    broadcastToRoom(room, 'USER_JOINED', {
      user,
      onlineUsers: room.getUsersList()
    }, socket);

    return;
  }

  // Ensure user belongs to a room for subsequent events
  const room = roomManager.getRoomOfSocket(socket);
  if (!room) return;

  const user = room.getUser(socket);
  if (!user) return;

  switch (type) {
    case 'CURSOR_MOVE': {
      user.cursorX = payload.x;
      user.cursorY = payload.y;
      broadcastToRoom(room, 'USER_CURSOR', {
        userId: user.id,
        username: user.username,
        color: user.color,
        x: payload.x,
        y: payload.y
      }, socket);
      break;
    }

    case 'STROKE_START': {
      broadcastToRoom(room, 'REMOTE_STROKE_START', {
        strokeId: payload.strokeId,
        userId: user.id,
        username: user.username,
        color: user.color,
        tool: payload.tool,
        colorVal: payload.color,
        strokeWidth: payload.strokeWidth,
        x: payload.x,
        y: payload.y
      }, socket);
      break;
    }

    case 'STROKE_POINT': {
      broadcastToRoom(room, 'REMOTE_STROKE_POINT', {
        strokeId: payload.strokeId,
        userId: user.id,
        x: payload.x,
        y: payload.y
      }, socket);
      break;
    }

    case 'STROKE_END': {
      // Save completed operation to room drawing state
      const operation = room.state.addOperation({
        id: payload.strokeId,
        userId: user.id,
        username: user.username,
        userColor: user.color,
        tool: payload.tool,
        color: payload.color,
        strokeWidth: payload.strokeWidth,
        points: payload.points,
        shapeData: payload.shapeData
      });

      broadcastToRoom(room, 'OP_ADD', {
        operation,
        canvasState: room.state.getSnapshot()
      }, socket);
      break;
    }

    case 'UNDO': {
      const mode = payload.mode || 'global';
      const targetUserId = mode === 'user' ? user.id : null;
      const undoneOp = room.state.undoLastOperation(targetUserId);

      if (undoneOp) {
        broadcastToRoom(room, 'OP_UNDO', {
          undoneOpId: undoneOp.id,
          undoneBy: user.username,
          canvasState: room.state.getSnapshot()
        });
        // Send feedback to requester as well
        sendWSMessage(socket, 'OP_UNDO', {
          undoneOpId: undoneOp.id,
          undoneBy: user.username,
          canvasState: room.state.getSnapshot()
        });
      }
      break;
    }

    case 'REDO': {
      const mode = payload.mode || 'global';
      const targetUserId = mode === 'user' ? user.id : null;
      const redoneOp = room.state.redoLastOperation(targetUserId);

      if (redoneOp) {
        broadcastToRoom(room, 'OP_REDO', {
          redoneOpId: redoneOp.id,
          redoneBy: user.username,
          canvasState: room.state.getSnapshot()
        });
        sendWSMessage(socket, 'OP_REDO', {
          redoneOpId: redoneOp.id,
          redoneBy: user.username,
          canvasState: room.state.getSnapshot()
        });
      }
      break;
    }

    case 'CLEAR_CANVAS': {
      room.state.clearHistory();
      broadcastToRoom(room, 'CANVAS_CLEARED', {
        clearedBy: user.username,
        canvasState: room.state.getSnapshot()
      });
      sendWSMessage(socket, 'CANVAS_CLEARED', {
        clearedBy: user.username,
        canvasState: room.state.getSnapshot()
      });
      break;
    }
  }
}

function handleUserDisconnect(socket) {
  const room = roomManager.getRoomOfSocket(socket);
  if (room) {
    const user = room.removeUser(socket);
    if (user) {
      broadcastToRoom(room, 'USER_LEFT', {
        userId: user.id,
        username: user.username,
        onlineUsers: room.getUsersList()
      });
    }
    roomManager.cleanEmptyRooms();
  }
}

// Start Server
const serverPort = PORT;

function startServer(portToUse) {
  server.listen(portToUse, () => {
    console.log(`=======================================================`);
    console.log(`🎨 Collaborative Drawing Canvas Server Running!`);
    console.log(`🌐 Local Web Server: http://localhost:${portToUse}`);
    console.log(`⚡ WebSocket Server: ws://localhost:${portToUse}`);
    console.log(`=======================================================`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const nextPort = Number(PORT) + 1;
    console.warn(`⚠️ Port ${PORT} is currently in use. Trying port ${nextPort}...`);
    startServer(nextPort);
  } else {
    console.error('Server error:', err);
  }
});

startServer(serverPort);

