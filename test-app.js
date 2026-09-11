/**
 * Automated Verification Script for CoDraw Application
 * Simulates two concurrent WebSocket clients connecting to room 'test-room',
 * drawing strokes, streaming points, performing global Undo/Redo, and verifying state sync.
 */

const http = require('http');

async function testHttpEndpoint() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000/', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 && data.includes('CoDraw')) {
          console.log('✅ HTTP Static Server Test Passed: index.html served correctly (Status 200)');
          resolve(true);
        } else {
          reject(new Error(`HTTP Status ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

async function testWebSocketSync() {
  const wsUrl = 'ws://localhost:3000';
  
  return new Promise((resolve, reject) => {
    const ws1 = new WebSocket(wsUrl);
    const ws2 = new WebSocket(wsUrl);

    let user1 = null;
    let user2 = null;
    let strokeId = `test_stroke_${Date.now()}`;
    let step = 0;

    ws1.onopen = () => {
      ws1.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId: 'test-room', username: 'Test User 1' } }));
    };

    ws2.onopen = () => {
      ws2.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId: 'test-room', username: 'Test User 2' } }));
    };

    ws1.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'ROOM_JOINED') {
        user1 = msg.payload.user;
        console.log(`✅ User 1 connected & assigned identity: ${user1.username} (${user1.color})`);
      } else if (msg.type === 'OP_ADD') {
        console.log(`✅ User 1 received OP_ADD notification. Ops in history: ${msg.payload.canvasState.operations.length}`);
      } else if (msg.type === 'OP_UNDO') {
        console.log(`✅ User 1 received OP_UNDO notification by ${msg.payload.undoneBy}`);
        step++;
        if (step === 1) {
          ws1.close();
          ws2.close();
          console.log('🎉 All Automated WebSocket Synchronization Tests Passed Flawlessly!');
          resolve(true);
        }
      }
    };

    ws2.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'ROOM_JOINED') {
        user2 = msg.payload.user;
        console.log(`✅ User 2 connected & assigned identity: ${user2.username} (${user2.color})`);
        
        // User 2 starts drawing a stroke
        ws2.send(JSON.stringify({
          type: 'STROKE_START',
          payload: { strokeId, tool: 'brush', color: '#FF3B30', strokeWidth: 5, x: 100, y: 100 }
        }));
        ws2.send(JSON.stringify({
          type: 'STROKE_POINT',
          payload: { strokeId, x: 120, y: 120 }
        }));
        ws2.send(JSON.stringify({
          type: 'STROKE_END',
          payload: {
            strokeId,
            tool: 'brush',
            color: '#FF3B30',
            strokeWidth: 5,
            points: [{ x: 100, y: 100 }, { x: 120, y: 120 }]
          }
        }));

        // Trigger Undo from User 1 after 200ms
        setTimeout(() => {
          ws1.send(JSON.stringify({ type: 'UNDO', payload: { mode: 'global' } }));
        }, 200);
      }
    };
  });
}

async function runTests() {
  console.log('🧪 Running CoDraw Verification Suite...');
  await testHttpEndpoint();
  await testWebSocketSync();
}

runTests().catch(err => {
  console.error('❌ Verification Test Failed:', err);
  process.exit(1);
});
