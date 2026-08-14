import { clamp, damp } from '../core/math.js';

const DEFAULTS = Object.freeze({
  hunger: 0.24,
  thirst: 0.18,
  energy: 0.82,
  sleepiness: 0.16,
  curiosity: 0.68,
  play: 0.54,
  social: 0.31,
  affection: 0.62,
  stress: 0.07,
  fear: 0.03,
  comfort: 0.74,
  cleanliness: 0.86,
  bladder: 0.13,
});

const BASE_RATES = Object.freeze({
  hunger: 0.00042,
  thirst: 0.00058,
  energy: -0.00023,
  sleepiness: 0.00027,
  curiosity: 0.00011,
  play: 0.00022,
  social: 0.00012,
  affection: 0,
  stress: -0.00012,
  fear: -0.00034,
  comfort: -0.000035,
  cleanliness: -0.000055,
  bladder: 0.00025,
});

export class NeedsModel {
  constructor(initial = {}) {
    this.values = { ...DEFAULTS, ...initial };
    this.activity = 'observe';
    this.activityIntensity = 0;
    this.touchComfort = 0;
  }

  update(dt, context = {}) {
    const activity = context.activity ?? this.activity;
    const intensity = clamp(context.intensity ?? this.activityIntensity);
    const warm = clamp(context.warmth ?? .55);
    const secure = clamp(context.security ?? .75);
    const playerNear = clamp(context.playerNear ?? 0);

    for (const [name, rate] of Object.entries(BASE_RATES)) {
      this.values[name] = clamp(this.values[name] + rate * dt);
    }

    const exertion = intensity * dt;
    this.values.energy = clamp(this.values.energy - exertion * .00042);
    this.values.thirst = clamp(this.values.thirst + exertion * .00025);
    this.values.hunger = clamp(this.values.hunger + exertion * .00012);
    this.values.comfort = damp(this.values.comfort, warm * .5 + secure * .5, .018, dt);
    this.values.affection = damp(this.values.affection, .45 + playerNear * .35 + this.touchComfort * .2, .006, dt);

    if (activity === 'eat') {
      this.values.hunger = clamp(this.values.hunger - dt * .035);
      this.values.comfort = clamp(this.values.comfort + dt * .002);
    } else if (activity === 'drink') {
      this.values.thirst = clamp(this.values.thirst - dt * .052);
    } else if (activity === 'rest') {
      this.values.energy = clamp(this.values.energy + dt * .011);
      this.values.sleepiness = clamp(this.values.sleepiness - dt * .012);
      this.values.stress = clamp(this.values.stress - dt * .003);
    } else if (activity === 'play') {
      this.values.play = clamp(this.values.play - dt * .014);
      this.values.curiosity = clamp(this.values.curiosity - dt * .005);
      this.values.energy = clamp(this.values.energy - dt * .003);
    } else if (activity === 'groom') {
      this.values.cleanliness = clamp(this.values.cleanliness + dt * .017);
      this.values.comfort = clamp(this.values.comfort + dt * .003);
    } else if (activity === 'litter') {
      this.values.bladder = clamp(this.values.bladder - dt * .08);
    } else if (activity === 'social' || activity === 'pet') {
      this.values.social = clamp(this.values.social - dt * .018);
      this.values.affection = clamp(this.values.affection + dt * .006);
      this.values.stress = clamp(this.values.stress - dt * .001);
    } else if (activity === 'explore' || activity === 'investigate') {
      this.values.curiosity = clamp(this.values.curiosity - dt * .006);
    }

    this.touchComfort = Math.max(0, this.touchComfort - dt * .015);
    this.activity = activity;
    this.activityIntensity = intensity;
  }

  react(kind, magnitude = .5, meta = {}) {
    const amount = clamp(magnitude);
    switch (kind) {
      case 'startle':
        this.values.fear = clamp(this.values.fear + amount * .65);
        this.values.stress = clamp(this.values.stress + amount * .42);
        break;
      case 'reassure':
        this.values.fear = clamp(this.values.fear - amount * .3);
        this.values.stress = clamp(this.values.stress - amount * .25);
        break;
      case 'pet': {
        const preference = meta.preference ?? .5;
        this.touchComfort = clamp(this.touchComfort + (preference - .28) * amount);
        this.values.social = clamp(this.values.social - preference * amount * .08);
        this.values.stress = clamp(this.values.stress + Math.max(0, .4 - preference) * amount * .25 - preference * amount * .04);
        break;
      }
      case 'treat':
        this.values.hunger = clamp(this.values.hunger - amount * .18);
        this.values.affection = clamp(this.values.affection + amount * .08);
        break;
      case 'dirty':
        this.values.cleanliness = clamp(this.values.cleanliness - amount * .18);
        break;
      default: break;
    }
  }

  snapshot() { return { ...this.values }; }
}

export { DEFAULTS as DEFAULT_NEEDS };
