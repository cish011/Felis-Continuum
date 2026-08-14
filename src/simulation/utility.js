import { clamp, smoothstep } from '../core/math.js';

const distanceCost = (memory, position, maxDistance = 20) => {
  if (!memory) return .52;
  return clamp(Math.hypot(memory.position.x - position.x, memory.position.z - position.z) / maxDistance);
};

const targetFor = (type, memory, position) => {
  if (type === 'player' || type === 'toy' || type === 'treat') {
    return memory.byType(type).sort((a, b) => distanceCost(a, position) - distanceCost(b, position))[0] ?? null;
  }
  return memory.nearest(type, position);
};

export function evaluateUtilities({ needs, personality, memory, perception, cat, world, now }) {
  const p = cat.position;
  const targets = {
    eat: targetFor('food', memory, p),
    drink: targetFor('water', memory, p),
    rest: memory.byType('rest').sort((a,b) => (b.valence + b.confidence) - (a.valence + a.confidence))[0] ?? null,
    play: targetFor('toy', memory, p),
    social: targetFor('player', memory, p),
    litter: targetFor('litter', memory, p),
    scratch: targetFor('scratch', memory, p),
    investigate: perception.attention,
    explore: memory.snapshot().filter(m => m.novelty > .28 && !['scary','player'].includes(m.type)).sort((a,b) => b.novelty-a.novelty)[0] ?? null,
  };

  const availability = key => targets[key]?.accessible === false ? .04 : targets[key] ? 1 : .30;
  const scores = {};
  scores.eat = smoothstep(.18, .92, needs.hunger) * 1.16 * availability('eat') * (1 - distanceCost(targets.eat, p) * .28);
  scores.drink = smoothstep(.14, .88, needs.thirst) * 1.24 * availability('drink') * (1 - distanceCost(targets.drink, p) * .25);
  scores.rest = clamp((1 - needs.energy) * .88 + needs.sleepiness * .56 + needs.stress * .12) * personality.utilityModifier('rest') * availability('rest');
  scores.play = clamp(needs.play * .72 + needs.curiosity * .13 + (targets.play?.moving ? .34 : 0)) * personality.utilityModifier('play') * availability('play') * (1 - needs.fear * .8);
  scores.social = clamp(needs.social * .68 + needs.affection * .17) * personality.utilityModifier('social') * availability('social') * (1 - needs.stress * .58);
  scores.groom = clamp((1 - needs.cleanliness) * .78 + needs.comfort * .07 + .045) * (1 - needs.fear);
  scores.litter = smoothstep(.26, .96, needs.bladder) * 1.26 * availability('litter');
  scores.scratch = clamp(.07 + needs.energy * .06 + needs.curiosity * .06) * personality.utilityModifier('scratch') * availability('scratch');
  scores.explore = clamp(needs.curiosity * .46 + (targets.explore?.novelty ?? .18) * .31) * personality.utilityModifier('explore') * availability('explore') * (1 - needs.fear * .72);
  scores.investigate = clamp((perception.attention?.salience ?? 0) * .72 + needs.curiosity * .12) * personality.utilityModifier('investigate') * (1 - needs.fear * .43);
  scores.flee = clamp(needs.fear * .94 + needs.stress * .38 + (perception.attention?.type === 'threat' ? .85 : 0)) * personality.utilityModifier('flee');
  scores.observe = .105 + perception.awareness * .07 + Math.sin(now * .17) * .008;

  if (world?.foodLevel <= .01) scores.eat *= .2;
  if (world?.waterLevel <= .01) scores.drink *= .18;
  if (world?.litterCleanliness <= .08) scores.litter *= .52;

  for (const key of Object.keys(scores)) scores[key] = clamp(scores[key], 0, 1.5);
  return { scores, targets };
}

export class IntentionSelector {
  constructor() {
    this.current = 'observe';
    this.commitment = .18;
    this.startedAt = 0;
    this.lastReason = 'initial orientation';
  }

  choose(scores, personality, now, flags = {}) {
    const ranking = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [challenger, challengerScore] = ranking[0] ?? ['observe', 0];
    const currentScore = scores[this.current] ?? 0;
    const age = now - this.startedAt;
    const commitmentBonus = this.commitment * (.23 + Math.min(age, 30) * .002);
    const interruptionMargin = personality.interruptionMargin();
    const complete = flags.goalComplete || flags.goalImpossible;
    const urgent = challenger === 'flee' && challengerScore > .38;
    const decisivelyBetter = challengerScore > currentScore + commitmentBonus + interruptionMargin;

    if (complete || urgent || (challenger !== this.current && decisivelyBetter)) {
      const previous = this.current;
      this.current = challenger;
      this.commitment = urgent ? .52 : .28;
      this.startedAt = now;
      this.lastReason = complete ? 'previous goal resolved' : urgent ? 'protective interruption' : `${challenger} outscored ${previous}`;
    } else {
      const progress = clamp(flags.progress ?? 0);
      this.commitment = clamp(this.commitment + .006 + progress * .012, .08, .92);
      if (challenger === this.current) this.commitment = clamp(this.commitment + .009, .08, .92);
    }

    return {
      goal: this.current,
      commitment: this.commitment,
      startedAt: this.startedAt,
      reason: this.lastReason,
      ranking,
    };
  }
}
