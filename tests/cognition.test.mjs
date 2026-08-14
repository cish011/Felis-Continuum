import test from 'node:test';
import assert from 'node:assert/strict';
import { NeedsModel } from '../src/simulation/needs.js';
import { Personality } from '../src/simulation/personality.js';
import { SpatialMemory } from '../src/simulation/memory.js';
import { IntentionSelector } from '../src/simulation/utility.js';

test('needs change continuously and resolve during an activity', () => {
  const needs = new NeedsModel({ thirst: .7 });
  needs.update(10, { activity: 'walk', intensity: .6 });
  const afterWalking = needs.values.thirst;
  assert.ok(afterWalking > .7);
  needs.update(10, { activity: 'drink' });
  assert.ok(needs.values.thirst < afterWalking);
});

test('spatial memory integrates observations rather than replacing history', () => {
  const memory = new SpatialMemory();
  memory.observe({ id:'water-bowl', type:'water', position:{x:2,y:0,z:4}, valence:.8 }, 1);
  memory.observe({ id:'water-bowl', type:'water', position:{x:2.1,y:0,z:4}, valence:.8 }, 2);
  assert.equal(memory.byType('water').length, 1);
  assert.ok(memory.get('water-bowl').confidence > .4);
  memory.visit('water-bowl', 3, 1);
  assert.equal(memory.get('water-bowl').visits, 1);
});

test('intention inertia rejects a marginal challenger', () => {
  const selector = new IntentionSelector();
  const personality = new Personality({ independent:.7 });
  selector.choose({ observe:.2, explore:.7 }, personality, 1, {});
  assert.equal(selector.current, 'explore');
  selector.commitment = .8;
  const result = selector.choose({ explore:.62, play:.68, observe:.1 }, personality, 2, {});
  assert.equal(result.goal, 'explore');
});

test('urgent fear can interrupt a committed intention', () => {
  const selector = new IntentionSelector();
  const personality = new Personality();
  selector.current = 'eat'; selector.commitment = .9; selector.startedAt = 0;
  const result = selector.choose({ eat:.7, flee:1.1, observe:.1 }, personality, 10, {});
  assert.equal(result.goal, 'flee');
});
