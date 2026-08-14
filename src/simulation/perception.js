import { clamp, saturate } from '../core/math.js';

const BASE_SALIENCE = {
  player: .38, toy: .42, food: .28, water: .18, litter: .08,
  sound: .55, door: .2, window: .14, unknown: .25, threat: .95,
  rest: .06, scratch: .10, treat: .82,
};

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class PerceptionSystem {
  constructor() {
    this.attention = null;
    this.attentionStrength = 0;
    this.lastSwitch = -Infinity;
  }

  sample(input, memory, personality, now) {
    const cat = input.cat;
    const forward = { x: Math.sin(cat.heading ?? 0), z: Math.cos(cat.heading ?? 0) };
    const visible = [];

    for (const object of input.objects ?? []) {
      if (!object?.position) continue;
      const distance = dist2(cat.position, object.position);
      const maxDistance = object.visibleRange ?? (object.type === 'player' ? 12 : 8);
      const dx = (object.position.x - cat.position.x) / Math.max(distance, .001);
      const dz = (object.position.z - cat.position.z) / Math.max(distance, .001);
      const facing = forward.x * dx + forward.z * dz;
      const audible = (object.sound ?? 0) > 0 && distance < (object.hearingRange ?? 16);
      const inVision = distance < maxDistance && (facing > -.46 || distance < 1.6);
      if (!audible && !inVision) continue;

      const known = memory.get(object.id);
      const novelty = known?.novelty ?? 1;
      const motion = clamp((object.speed ?? 0) / 4);
      const proximity = 1 - saturate(distance / maxDistance);
      const base = BASE_SALIENCE[object.type] ?? BASE_SALIENCE.unknown;
      const salience = clamp(
        base + motion * .42 + novelty * personality.get('curious') * .22 +
        proximity * .16 + (object.sound ?? 0) * .44 + (object.urgent ?? 0) * .7
      );
      const perceived = { ...object, distance, facing, audible, inVision, salience };
      visible.push(perceived);
      if (inVision) memory.observe(object, now);
    }

    visible.sort((a, b) => b.salience - a.salience);
    const challenger = visible[0] ?? null;
    const incumbent = visible.find(item => item.id === this.attention?.id);
    if (incumbent) this.attentionStrength = Math.min(1, this.attentionStrength + .05);
    else this.attentionStrength *= .72;

    const switchAdvantage = challenger ? challenger.salience - (incumbent?.salience ?? this.attentionStrength) : -1;
    if (challenger && (!incumbent || (switchAdvantage > .14 && now - this.lastSwitch > .35))) {
      this.attention = challenger;
      this.attentionStrength = challenger.salience;
      this.lastSwitch = now;
    } else if (incumbent) {
      this.attention = incumbent;
    } else if (this.attentionStrength < .08) {
      this.attention = null;
    }

    return {
      visible,
      attention: this.attention ? { ...this.attention } : null,
      awareness: visible.reduce((sum, item) => sum + item.salience, 0) / Math.max(1, visible.length),
    };
  }
}
