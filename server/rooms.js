/**
 * Real-Time Collaborative Canvas - Room & User Manager
 * Handles multi-room canvas isolation, unique user color allocation, and user metadata tracking.
 */

const DrawingState = require('./drawing-state');

const USER_COLORS = [
  '#FF5733', '#3357FF', '#2ECC71', '#F39C12', 
  '#9B59B6', '#1ABC9C', '#E74C3C', '#00D2D3', 
  '#FF9FF3', '#FECA57', '#54A0FF', '#5F27CD'
];

const ADJECTIVES = ['Swift', 'Neon', 'Cosmic', 'Pixel', 'Vivid', 'Solar', 'Cyber', 'Starlight', 'Hyper', 'Electric'];
const ANIMALS = ['Falcon', 'Lynx', 'Gecko', 'Panther', 'Raven', 'Otter', 'Dragon', 'Tiger', 'Phoenix', 'Wolf'];

function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const num = Math.floor(Math.random() * 90 + 10);
  return `${adj} ${animal} ${num}`;
}

class Room {
  constructor(id) {
    this.id = id;
    this.users = new Map(); // socket -> User object
    this.state = new DrawingState();
    this.colorIndex = 0;
  }

  addUser(socket, usernameInput = null) {
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const color = USER_COLORS[this.colorIndex % USER_COLORS.length];
    this.colorIndex++;

    const username = (usernameInput && usernameInput.trim()) ? usernameInput.trim() : generateRandomName();

    const user = {
      id: userId,
      username,
      color,
      cursorX: 0,
      cursorY: 0,
      joinedAt: Date.now()
    };

    this.users.set(socket, user);
    return user;
  }

  removeUser(socket) {
    const user = this.users.get(socket);
    if (user) {
      this.users.delete(socket);
    }
    return user;
  }

  getUser(socket) {
    return this.users.get(socket);
  }

  getUsersList() {
    return Array.from(this.users.values()).map(u => ({
      id: u.id,
      username: u.username,
      color: u.color,
      cursorX: u.cursorX,
      cursorY: u.cursorY
    }));
  }

  isEmpty() {
    return this.users.size === 0;
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> Room
  }

  getOrCreateRoom(roomId = 'main') {
    const cleanId = (roomId || 'main').toLowerCase().trim();
    if (!this.rooms.has(cleanId)) {
      this.rooms.set(cleanId, new Room(cleanId));
    }
    return this.rooms.get(cleanId);
  }

  getRoomOfSocket(socket) {
    for (const room of this.rooms.values()) {
      if (room.users.has(socket)) {
        return room;
      }
    }
    return null;
  }

  cleanEmptyRooms() {
    for (const [id, room] of this.rooms.entries()) {
      if (id !== 'main' && room.isEmpty()) {
        this.rooms.delete(id);
      }
    }
  }
}

module.exports = RoomManager;
