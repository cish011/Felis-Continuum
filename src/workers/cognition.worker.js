import { NeedsModel } from '../simulation/needs.js';
import { Personality } from '../simulation/personality.js';
import { SpatialMemory } from '../simulation/memory.js';
import { PerceptionSystem } from '../simulation/perception.js';
import { evaluateUtilities, IntentionSelector } from '../simulation/utility.js';
import { GoalPlanner, targetForGoal } from '../simulation/planner.js';

let needs = new NeedsModel();
let personality = new Personality();
let memory = new SpatialMemory();
let perception = new PerceptionSystem();
let selector = new IntentionSelector();
let planner = new GoalPlanner();
let lastNow = 0;
let lastInput = null;
let feedback = {};

function reset(config = {}) {
  needs = new NeedsModel(config.needs);
  personality = new Personality(config.traits);
  memory = new SpatialMemory();
  perception = new PerceptionSystem();
  selector = new IntentionSelector();
  planner = new GoalPlanner();
  lastNow = config.now ?? 0;
  feedback = {};
}

function tick(input) {
  lastInput = input;
  const now = input.now ?? 0;
  const dt = Math.max(0, Math.min(1, now - lastNow));
  lastNow = now;
  needs.update(dt, {
    activity: input.cat?.activity ?? selector.current,
    intensity: input.cat?.intensity ?? 0,
    warmth: input.cat?.warmth ?? .55,
    security: input.cat?.security ?? .75,
    playerNear: input.cat?.playerNear ?? 0,
  });
  memory.update(dt, now);
  const sensed = perception.sample(input, memory, personality, now);
  const evaluated = evaluateUtilities({
    needs: needs.values, personality, memory, perception: sensed,
    cat: input.cat, world: input.world, now,
  });
  const intention = selector.choose(evaluated.scores, personality, now, feedback);
  const target = targetForGoal(intention.goal, evaluated.targets, sensed);
  const plan = planner.update(intention.goal, target, input.cat, now, { ...feedback, dt });

  postMessage({
    type: 'snapshot', now, needs: needs.snapshot(), personality: personality.snapshot(),
    perception: { attention: sensed.attention, visibleCount: sensed.visible.length, awareness: sensed.awareness },
    memories: memory.snapshot(), utilities: evaluated.scores, intention, plan,
  });
  feedback = { ...feedback, goalComplete: false, goalImpossible: false };
}

self.onmessage = event => {
  const message = event.data ?? {};
  switch (message.type) {
    case 'init':
      reset(message.config);
      postMessage({ type: 'ready' });
      break;
    case 'tick': tick(message.input); break;
    case 'feedback': feedback = { ...feedback, ...message.feedback }; break;
    case 'event': {
      const payload = message.payload ?? {};
      needs.react(message.kind, message.magnitude, payload);
      if (message.kind === 'startle' && payload.position) memory.markScary(payload.position, message.now ?? lastNow, message.magnitude);
      if (message.kind === 'visited' && payload.id) memory.visit(payload.id, message.now ?? lastNow, payload.outcome ?? 0);
      break;
    }
    case 'personality': personality.set(message.traits); break;
    case 'reset': reset(message.config); break;
    default: break;
  }
};
