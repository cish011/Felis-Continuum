export class EventBus {
  constructor() { this.listeners = new Map(); }

  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    return () => this.listeners.get(type)?.delete(callback);
  }

  emit(type, detail = {}) {
    for (const callback of this.listeners.get(type) ?? []) callback(detail);
  }

  clear() { this.listeners.clear(); }
}

export const events = new EventBus();
