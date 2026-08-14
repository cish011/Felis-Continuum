const GOAL_TARGET_TYPES = {
  eat: 'food', drink: 'water', rest: 'rest', play: 'toy', social: 'player',
  litter: 'litter', scratch: 'scratch', explore: 'unknown', investigate: 'attention',
};

const INTERACTION_RADIUS = {
  eat: .43, drink: .38, rest: .62, play: .72, social: .75,
  litter: .52, scratch: .48, explore: .45, investigate: .58,
};

export class GoalPlanner {
  constructor() {
    this.plan = null;
    this.sequence = 0;
  }

  create(goal, target, cat, now) {
    if (goal === 'observe' || goal === 'groom') {
      this.plan = { id: this.sequence++, goal, target: null, phase: goal, progress: 0, createdAt: now };
      return this.plan;
    }
    if (goal === 'flee') {
      const threat = target?.position ?? cat.position;
      const dx = cat.position.x - threat.x, dz = cat.position.z - threat.z;
      const length = Math.hypot(dx, dz) || 1;
      this.plan = {
        id: this.sequence++, goal, target: {
          id: 'temporary-safety', type: 'safe',
          position: { x: cat.position.x + dx / length * 5, y: 0, z: cat.position.z + dz / length * 5 },
        }, phase: 'orient', progress: 0, createdAt: now,
      };
      return this.plan;
    }
    this.plan = {
      id: this.sequence++, goal, target: target ? JSON.parse(JSON.stringify(target)) : null,
      phase: target ? 'orient' : 'search', progress: 0, createdAt: now,
      interactionRadius: INTERACTION_RADIUS[goal] ?? .5,
    };
    return this.plan;
  }

  update(goal, target, cat, now, feedback = {}) {
    if (!this.plan || this.plan.goal !== goal || (target?.id && this.plan.target?.id !== target.id)) {
      return this.create(goal, target, cat, now);
    }

    const plan = this.plan;
    const distance = feedback.distanceToTarget ?? Infinity;
    const facing = feedback.facingTarget ?? 0;
    if (plan.phase === 'search' && target) {
      plan.target = JSON.parse(JSON.stringify(target));
      plan.phase = 'orient';
    } else if (plan.phase === 'orient' && facing > .82) {
      plan.phase = 'approach';
    } else if (plan.phase === 'approach' && distance < plan.interactionRadius * 1.65) {
      plan.phase = 'position';
    } else if (plan.phase === 'position' && distance < plan.interactionRadius && facing > .68) {
      plan.phase = 'interact';
    }

    if (plan.phase === 'interact') plan.progress = Math.min(1, plan.progress + (feedback.dt ?? 0) * .08);
    else if (Number.isFinite(distance)) plan.progress = Math.max(plan.progress, Math.max(0, 1 - distance / 14) * .72);
    return plan;
  }

  snapshot() { return this.plan ? JSON.parse(JSON.stringify(this.plan)) : null; }
}

export function targetForGoal(goal, targets, perception) {
  if (goal === 'investigate' || goal === 'flee') return perception.attention ?? targets.investigate ?? null;
  if (goal === 'groom' || goal === 'observe') return null;
  return targets[goal] ?? null;
}

export { GOAL_TARGET_TYPES, INTERACTION_RADIUS };
