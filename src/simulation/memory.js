import { clamp } from '../core/math.js';

const TYPE_DECAY = {
  food: .000004,
  water: .000004,
  litter: .000003,
  rest: .000012,
  scratch: .000009,
  player: .00008,
  toy: .00018,
  sound: .0012,
  unknown: .0004,
};

export class SpatialMemory {
  constructor() {
    this.records = new Map();
    this.sequence = 0;
  }

  observe(object, now = 0) {
    if (!object?.id || !object.position) return;
    const previous = this.records.get(object.id);
    const confidence = Math.min(1, (previous?.confidence ?? .25) + .16);
    this.records.set(object.id, {
      id: object.id,
      type: object.type ?? 'unknown',
      label: object.label ?? object.id,
      position: { x: object.position.x, y: object.position.y ?? 0, z: object.position.z },
      confidence,
      valence: clamp(object.valence ?? previous?.valence ?? .5),
      novelty: previous ? Math.max(.03, previous.novelty * .76) : 1,
      lastSeen: now,
      visits: previous?.visits ?? 0,
      accessible: object.accessible !== false,
      moving: Boolean(object.moving),
      sequence: this.sequence++,
    });
  }

  visit(id, now = 0, outcome = 0) {
    const memory = this.records.get(id);
    if (!memory) return;
    memory.visits += 1;
    memory.novelty *= .38;
    memory.valence = clamp(memory.valence * .82 + (.5 + outcome * .5) * .18);
    memory.lastVisited = now;
  }

  markScary(position, now, magnitude = .7) {
    const id = `scary-${Math.round(position.x)}-${Math.round(position.z)}`;
    this.records.set(id, {
      id, type: 'scary', label: 'remembered disturbance',
      position: { x: position.x, y: position.y ?? 0, z: position.z },
      confidence: clamp(magnitude), valence: 0, novelty: .2, lastSeen: now,
      visits: 0, accessible: true, moving: false, sequence: this.sequence++,
    });
  }

  update(dt, now) {
    for (const [id, memory] of this.records) {
      const decay = TYPE_DECAY[memory.type] ?? TYPE_DECAY.unknown;
      memory.confidence = Math.max(0, memory.confidence - decay * dt);
      if (now - memory.lastSeen > 30) memory.novelty = Math.min(1, memory.novelty + dt * .00012);
      if (memory.confidence <= .015) this.records.delete(id);
    }
  }

  byType(...types) {
    return [...this.records.values()]
      .filter(memory => types.includes(memory.type) && memory.confidence > .08)
      .sort((a, b) => b.confidence - a.confidence || b.valence - a.valence);
  }

  get(id) { return this.records.get(id); }

  nearest(type, from) {
    let best = null, bestCost = Infinity;
    for (const memory of this.byType(type)) {
      if (!memory.accessible) continue;
      const dx = memory.position.x - from.x, dz = memory.position.z - from.z;
      const cost = Math.hypot(dx, dz) / (.25 + memory.confidence) - memory.valence;
      if (cost < bestCost) { best = memory; bestCost = cost; }
    }
    return best;
  }

  snapshot() {
    return [...this.records.values()].map(memory => ({ ...memory, position: { ...memory.position } }));
  }
}
