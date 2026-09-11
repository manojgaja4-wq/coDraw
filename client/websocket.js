/**
 * CoDraw - WebSocket Client Network Engine
 * Handles connection management, auto-reconnect, JSON frame dispatching, and ping latency tracking.
 */

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.url = this.getWebSocketUrl();
    this.listeners = new Map(); // eventType -> Set of callback functions
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.pingInterval = null;
    this.lastPingTime = 0;
    this.latency = 0;
  }

  getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:3000';
    return `${protocol}//${host}`;
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.emit('_connection_change', { status: 'connected' });
        this.startPingHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const { type, payload } = message;

          if (type === 'PONG') {
            this.latency = Math.max(1, Date.now() - payload.timestamp);
            this.emit('_latency_update', { latency: this.latency });
            return;
          }

          this.emit(type, payload);
        } catch (err) {
          console.error('Error parsing incoming WebSocket message:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.stopPingHeartbeat();
        this.emit('_connection_change', { status: 'disconnected' });
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
        this.emit('_connection_change', { status: 'error', error: err });
      };

    } catch (e) {
      console.error('Failed to create WebSocket connection:', e);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('Max WebSocket reconnect attempts reached.');
      this.emit('_connection_change', { status: 'failed' });
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), 10000);
    console.log(`Reconnecting to WebSocket in ${Math.round(delay)}ms... (Attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  startPingHeartbeat() {
    this.stopPingHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now();
        this.send('PING', { timestamp: this.lastPingTime });
      }
    }, 2000);
  }

  stopPingHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(callback);
  }

  off(type, callback) {
    if (this.listeners.has(type)) {
      this.listeners.get(type).delete(callback);
    }
  }

  emit(type, payload) {
    if (this.listeners.has(type)) {
      for (const cb of this.listeners.get(type)) {
        cb(payload);
      }
    }
  }
}

window.WebSocketClient = WebSocketClient;
