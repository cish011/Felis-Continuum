import { clamp } from '../core/math.js';

const BASE = Object.freeze({
  affectionate: .55,
  independent: .55,
  curious: .65,
  cautious: .45,
  playful: .60,
  energetic: .55,
  social: .55,
  mischievous: .45,
});

export class Personality {
  constructor(traits = {}) {
    this.traits = { ...BASE };
    this.set(traits);
  }

  set(traits = {}) {
    for (const key of Object.keys(BASE)) {
      if (Number.isFinite(traits[key])) this.traits[key] = clamp(traits[key]);
    }
  }

  get(name) { return this.traits[name] ?? .5; }

  utilityModifier(goal) {
    const t = this.traits;
    switch (goal) {
      case 'play': return .45 + t.playful * .8 + t.energetic * .35;
      case 'explore': return .45 + t.curious * .85 + t.mischievous * .2 - t.cautious * .18;
      case 'investigate': return .4 + t.curious * .9 - t.cautious * .32;
      case 'social': return .35 + t.social * .72 + t.affectionate * .55 - t.independent * .25;
      case 'flee': return .5 + t.cautious * .85;
      case 'rest': return .72 + (1 - t.energetic) * .42;
      case 'scratch': return .78 + t.mischievous * .24;
      default: return 1;
    }
  }

  interruptionMargin() {
    return .16 + this.traits.independent * .08 + (1 - this.traits.curious) * .05;
  }

  snapshot() { return { ...this.traits }; }
}
