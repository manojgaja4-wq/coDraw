/**
 * Real-Time Collaborative Canvas - Server State Management
 * Handles operation history log, sequence numbering, and global Undo/Redo tombstoning.
 */

class DrawingState {
  constructor() {
    this.operations = []; // Array of completed operations
    this.seqId = 0;        // Monotonic sequence counter
  }

  /**
   * Adds a completed drawing operation to history
   * @param {Object} opData Operation attributes from client
   * @returns {Object} Finalized operation with seqId and ID
   */
  addOperation(opData) {
    this.seqId++;
    const operation = {
      id: opData.id || `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      seqId: this.seqId,
      userId: opData.userId,
      username: opData.username,
      userColor: opData.userColor,
      tool: opData.tool || 'brush',
      color: opData.color || '#000000',
      strokeWidth: opData.strokeWidth || 5,
      points: opData.points || [],       // Array of {x, y}
      shapeData: opData.shapeData || null, // For rect, circle, line: {startX, startY, endX, endY}
      timestamp: Date.now(),
      isUndone: false
    };

    this.operations.push(operation);
    return operation;
  }

  /**
   * Performs Undo on the operation history stack
   * @param {string|null} userId If provided, undoes last operation by this user; if null, global undo
   * @returns {Object|null} The operation that was undone, or null if nothing to undo
   */
  undoLastOperation(userId = null) {
    // Traverse history backwards to find the last active (non-undone) operation
    for (let i = this.operations.length - 1; i >= 0; i--) {
      const op = this.operations[i];
      if (!op.isUndone) {
        if (userId === null || op.userId === userId) {
          op.isUndone = true;
          return op;
        }
      }
    }
    return null;
  }

  /**
   * Performs Redo on the operation history stack
   * @param {string|null} userId If provided, redoes last undone operation by this user; if null, global redo
   * @returns {Object|null} The operation that was redone, or null if nothing to redo
   */
  redoLastOperation(userId = null) {
    // Traverse history forwards (or find earliest undone operation after last active)
    for (let i = this.operations.length - 1; i >= 0; i--) {
      const op = this.operations[i];
      if (op.isUndone) {
        if (userId === null || op.userId === userId) {
          op.isUndone = false;
          return op;
        }
      }
    }
    return null;
  }

  /**
   * Clears all drawing history in the room
   */
  clearHistory() {
    this.operations = [];
    this.seqId = 0;
  }

  /**
   * Returns complete history snapshot (active operations)
   */
  getSnapshot() {
    return {
      operations: this.operations,
      seqId: this.seqId
    };
  }
}

module.exports = DrawingState;
