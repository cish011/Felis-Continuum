import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createAnatomicalLoft,
  createTorsoGeometry,
  createSkullGeometry,
  createNeckGeometry,
  createNasalBridgeGeometry,
  createJawGeometry,
  createTaperedLimbGeometry,
  createPawGeometry,
  createPinnaGeometry,
  createInnerPinnaGeometry,
  createNoseGeometry,
  createEyelidGeometry,
  createOrbitalMaskGeometry,
} from '../src/simulation/cat-anatomy.js';
import { ProceduralLocomotion } from '../src/simulation/locomotion.js';

const MILLIMETRE = .001;

function assertClose(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, received ${actual}`,
  );
}

function geometrySize(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox.getSize(new THREE.Vector3());
}

function assertFiniteVector(vector, label) {
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Number.isFinite(vector[axis]), `${label}.${axis} must be finite`);
  }
}

function assertFiniteGeometry(name, geometry, { planar = false } = {}) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  assert.ok(position?.count > 0, `${name} must contain vertices`);
  assert.equal(normal?.count, position.count, `${name} must have one normal per vertex`);

  for (const [attributeName, attribute] of Object.entries(geometry.attributes)) {
    for (let index = 0; index < attribute.array.length; index++) {
      assert.ok(
        Number.isFinite(attribute.array[index]),
        `${name}.${attributeName}[${index}] must be finite`,
      );
    }
  }

  if (geometry.index) {
    assert.equal(geometry.index.count % 3, 0, `${name} index must describe triangles`);
    for (const vertexIndex of geometry.index.array) {
      assert.ok(vertexIndex >= 0 && vertexIndex < position.count, `${name} index must be in range`);
    }
  } else {
    assert.equal(position.count % 3, 0, `${name} non-indexed vertices must describe triangles`);
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  assertFiniteVector(geometry.boundingBox.min, `${name}.boundingBox.min`);
  assertFiniteVector(geometry.boundingBox.max, `${name}.boundingBox.max`);
  assertFiniteVector(geometry.boundingSphere.center, `${name}.boundingSphere.center`);
  assert.ok(Number.isFinite(geometry.boundingSphere.radius), `${name} radius must be finite`);
  assert.ok(geometry.boundingSphere.radius > 0, `${name} radius must be positive`);

  const size = geometrySize(geometry);
  assert.ok(size.x > 0 && size.y > 0, `${name} must have non-zero width and height`);
  if (!planar) assert.ok(size.z > 0, `${name} must have non-zero depth`);
}

function widthAt(geometry, z) {
  const position = geometry.getAttribute('position');
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < position.count; index++) {
    if (Math.abs(position.getZ(index) - z) > .25 * MILLIMETRE) continue;
    minimum = Math.min(minimum, position.getX(index));
    maximum = Math.max(maximum, position.getX(index));
  }
  assert.ok(Number.isFinite(minimum) && Number.isFinite(maximum), `missing torso station z=${z}`);
  return maximum - minimum;
}

function verticalRangeAt(geometry, z) {
  const position = geometry.getAttribute('position');
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < position.count; index++) {
    if (Math.abs(position.getZ(index) - z) > .25 * MILLIMETRE) continue;
    minimum = Math.min(minimum, position.getY(index));
    maximum = Math.max(maximum, position.getY(index));
  }
  assert.ok(Number.isFinite(minimum) && Number.isFinite(maximum), `missing torso station z=${z}`);
  return { minimum, maximum };
}

function flatEnvironment(height = 0) {
  return {
    obstacles: [],
    sampleSurface(x, z) {
      const px = x?.isVector3 ? x.x : x;
      const pz = x?.isVector3 ? x.z : z;
      return {
        height,
        position: new THREE.Vector3(px, height, pz),
        normal: new THREE.Vector3(0, 1, 0),
        walkable: true,
        width: Infinity,
      };
    },
    isBlocked() { return false; },
  };
}

function assertFiniteMotion(state, label) {
  for (const key of [
    'heading', 'speed', 'gaitPhase', 'bodyHeight', 'crouch', 'spineBend',
    'bank', 'headPitch', 'tailBalance', 'shoulderHeight', 'pelvisHeight',
    'bodyPitch', 'spineFlex', 'narrowness',
  ]) {
    assert.ok(Number.isFinite(state[key]), `${label}.${key} must be finite`);
  }
  assertFiniteVector(state.position, `${label}.position`);
  assertFiniteVector(state.velocity, `${label}.velocity`);
  for (const [footName, foot] of Object.entries(state.feet)) {
    assertFiniteVector(foot.position, `${label}.${footName}.position`);
    assertFiniteVector(foot.normal, `${label}.${footName}.normal`);
    assert.ok(Number.isFinite(foot.plantWeight), `${label}.${footName}.plantWeight must be finite`);
    assert.ok(Number.isFinite(foot.swing), `${label}.${footName}.swing must be finite`);
    assertClose(foot.normal.length(), 1, 2e-6, `${label}.${footName}.normal length`);
  }
}

test('all smooth anatomy generators produce finite triangle geometry', () => {
  const geometries = {
    arbitraryLoft: createAnatomicalLoft([
      { z: -.02, rx: .01, ry: .012 },
      { z: .02, rx: .015, ry: .01 },
    ], 12),
    torso: createTorsoGeometry(),
    skull: createSkullGeometry(),
    neck: createNeckGeometry(),
    nasalBridge: createNasalBridgeGeometry(),
    jaw: createJawGeometry(),
    forelimb: createTaperedLimbGeometry(.0997, .018, .013),
    hindlimb: createTaperedLimbGeometry(.1105, .021, .0135, { depth: .92 }),
    paw: createPawGeometry(),
    pinna: createPinnaGeometry(),
    innerPinna: createInnerPinnaGeometry(),
    nose: createNoseGeometry(),
    upperEyelid: createEyelidGeometry(.00825, .00575, true),
    lowerEyelid: createEyelidGeometry(.00825, .00575, false),
    orbitalMask: createOrbitalMaskGeometry(),
  };

  try {
    for (const [name, geometry] of Object.entries(geometries)) {
      assertFiniteGeometry(name, geometry, { planar: name === 'innerPinna' || name === 'orbitalMask' });
    }
  } finally {
    for (const geometry of Object.values(geometries)) geometry.dispose();
  }
});

test('torso loft preserves measured ribcage, waist, pelvis, and side silhouette', () => {
  const torso = createTorsoGeometry();
  try {
    const size = geometrySize(torso);
    assertClose(size.x, .140, .1 * MILLIMETRE, 'maximum thorax width');
    assertClose(size.y, .140, .6 * MILLIMETRE, 'maximum torso height');
    assertClose(size.z, .380, .1 * MILLIMETRE, 'pelvis-to-thoracic-inlet length');

    assertClose(widthAt(torso, -.140), .120, .1 * MILLIMETRE, 'pelvic width');
    assertClose(widthAt(torso, -.050), .100, .1 * MILLIMETRE, 'waist width');
    assertClose(widthAt(torso, .105), .140, .1 * MILLIMETRE, 'ribcage width');
    assert.ok(widthAt(torso, .105) > widthAt(torso, -.050) * 1.35, 'ribcage must read wider than waist');

    const ribcage = verticalRangeAt(torso, .105);
    assertClose(ribcage.maximum, .060, .5 * MILLIMETRE, 'ribcage dorsal line');
    assertClose(ribcage.minimum, -.080, .5 * MILLIMETRE, 'ribcage sternum line');

    const axialStations = [...new Set(Array.from(torso.getAttribute('position').array)
      .filter((_, index) => index % 3 === 2)
      .map(value => Number(value.toFixed(3))))].sort((a, b) => a - b);
    for (const station of [-.205, -.18, -.14, -.095, -.05, 0, .055, .105, .145, .175]) {
      assert.ok(axialStations.includes(station), `resampled torso retains measured station ${station}`);
    }
    assert.ok(torso.getAttribute('position').count >= 1400, 'torso uses enough axial samples for a smooth side silhouette');
  } finally {
    torso.dispose();
  }
});

test('cranial, paw, and three-dimensional pinna envelopes stay anatomically scaled', () => {
  const skull = createSkullGeometry();
  const paw = createPawGeometry();
  const pinna = createPinnaGeometry();
  const nose = createNoseGeometry();
  try {
    const skullSize = geometrySize(skull);
    assertClose(skullSize.x, .096, .1 * MILLIMETRE, 'skull width');
    assertClose(skullSize.y, .077, .4 * MILLIMETRE, 'skull height');
    assertClose(skullSize.z, .098, .1 * MILLIMETRE, 'skull length');

    const pawSize = geometrySize(paw);
    assertClose(pawSize.x, .038, .1 * MILLIMETRE, 'paw width');
    assertClose(pawSize.y, .022, .1 * MILLIMETRE, 'paw height');
    assertClose(pawSize.z, .052, .1 * MILLIMETRE, 'paw length');

    const pinnaSize = geometrySize(pinna);
    assert.ok(pinnaSize.x >= .041 && pinnaSize.x <= .044, `pinna width ${pinnaSize.x}`);
    assert.ok(pinnaSize.y >= .057 && pinnaSize.y <= .059, `pinna height ${pinnaSize.y}`);
    assert.ok(pinnaSize.z >= .013 && pinnaSize.z <= .0155, `pinna depth ${pinnaSize.z}`);
    assert.ok(pinna.getAttribute('position').count >= 5000, 'pinna retains curved rim and inner cavity topology');

    const noseSize = geometrySize(nose);
    assert.ok(noseSize.x < skullSize.x * .25, 'nose must remain a short feline feature, not dominate the skull');
    assert.ok(noseSize.y < skullSize.y * .19, 'nose height must remain subordinate to the cranium');
  } finally {
    skull.dispose();
    paw.dispose();
    pinna.dispose();
    nose.dispose();
  }
});

test('measured forelimb and hindlimb segment meshes keep finite exact lengths', () => {
  const measuredSegments = [
    ['humerus', .0997, .018, .014],
    ['radius', .0915, .014, .0105],
    ['carpometacarpus', .0335, .0105, .0085],
    ['femur', .1009, .021, .015],
    ['tibia', .1105, .016, .011],
    ['metatarsus', .0580, .011, .0085],
  ];

  const geometries = measuredSegments.map(([name, length, proximal, distal]) => [
    name,
    length,
    createTaperedLimbGeometry(length, proximal, distal),
  ]);
  try {
    for (const [name, length, geometry] of geometries) {
      assertFiniteGeometry(name, geometry);
      assertClose(geometrySize(geometry).y, length, .01 * MILLIMETRE, `${name} segment length`);
    }
    const foreChain = measuredSegments.slice(0, 3).reduce((sum, segment) => sum + segment[1], 0);
    const hindChain = measuredSegments.slice(3).reduce((sum, segment) => sum + segment[1], 0);
    assertClose(foreChain, .2247, .01 * MILLIMETRE, 'forelimb measured chain');
    assertClose(hindChain, .2694, .01 * MILLIMETRE, 'hindlimb digitigrade chain');
    assert.ok(hindChain > foreChain * 1.19, 'hindlimb chain must retain characteristic longer lever structure');
  } finally {
    for (const [, , geometry] of geometries) geometry.dispose();
  }
});

test('neutral locomotion is a stable metric stance with four planted finite paws', () => {
  const locomotion = new ProceduralLocomotion(flatEnvironment(), {
    position: new THREE.Vector3(0, 4, 0),
    heading: 0,
    bodyScale: 1,
  });

  let state = locomotion.getMotionState();
  assertFiniteMotion(state, 'initial');
  assert.equal(state.gait, 'idle');
  assertClose(state.position.y, 0, 1e-9, 'root ground height');
  assertClose(state.bodyHeight, .190, 1e-9, 'neutral body height');

  const expected = {
    frontLeft: [-.045, 0, .175],
    frontRight: [.045, 0, .175],
    hindLeft: [-.043, 0, -.108],
    hindRight: [.043, 0, -.108],
  };
  for (const [name, coordinates] of Object.entries(expected)) {
    const foot = state.feet[name];
    assertClose(foot.position.x, coordinates[0], 1e-9, `${name}.x`);
    assertClose(foot.position.y, coordinates[1], 1e-9, `${name}.y`);
    assertClose(foot.position.z, coordinates[2], 1e-9, `${name}.z`);
    assert.equal(foot.plantWeight, 1, `${name} must be planted`);
    assert.equal(foot.swing, 0, `${name} must not swing at idle`);
  }
  assertClose(state.feet.frontRight.position.x - state.feet.frontLeft.position.x, .090, 1e-9, 'fore stance width');
  assertClose(state.feet.hindRight.position.x - state.feet.hindLeft.position.x, .086, 1e-9, 'hind stance width');
  assertClose(state.feet.frontLeft.position.z - state.feet.hindLeft.position.z, .283, 1e-9, 'fore-hind stance length');

  for (let frame = 0; frame < 600; frame++) state = locomotion.update(1 / 120);
  assertFiniteMotion(state, 'settled');
  assert.equal(state.gait, 'idle');
  assertClose(state.speed, 0, 1e-12, 'idle speed');
  assertClose(state.bodyHeight, .190, 1e-9, 'settled body height');
  assertClose(state.shoulderHeight, .190, 1e-9, 'settled shoulder height');
  assertClose(state.pelvisHeight, .190, 1e-9, 'settled pelvis height');
  assertClose(state.position.length(), 0, 1e-12, 'idle root drift');
  for (const foot of Object.values(state.feet)) {
    assert.equal(foot.plantWeight, 1);
    assert.equal(foot.swing, 0);
    assertClose(foot.position.y, 0, 1e-12, 'settled paw ground contact');
  }
});

test('the trunk pitches nose-up on +Z uphill terrain', () => {
  const grade = .12;
  const environment = {
    obstacles: [],
    sampleSurface(x, z) {
      const px = x?.isVector3 ? x.x : x;
      const pz = x?.isVector3 ? x.z : z;
      const height = pz * grade;
      return {
        height,
        position: new THREE.Vector3(px, height, pz),
        normal: new THREE.Vector3(0, 1, -grade).normalize(),
        walkable: true,
        width: Infinity,
      };
    },
    isBlocked() { return false; },
  };
  const locomotion = new ProceduralLocomotion(environment, {
    position: new THREE.Vector3(),
    heading: 0,
    bodyScale: 1,
  });

  let state;
  for (let frame = 0; frame < 360; frame++) state = locomotion.update(1 / 120);
  assertFiniteMotion(state, 'uphill');
  assert.ok(state.bodyPitch < -.05, `+Z uphill pitch must be negative, received ${state.bodyPitch}`);
  assert.ok(state.bodyPitch > -.20, `uphill pitch remains anatomically bounded, received ${state.bodyPitch}`);
});

test('a neutral flat-ground walk remains finite and produces bounded paw clearance', () => {
  const locomotion = new ProceduralLocomotion(flatEnvironment(), {
    position: new THREE.Vector3(),
    heading: 0,
    bodyScale: 1,
  });
  const desiredVelocity = new THREE.Vector3(0, 0, .62);
  let state;
  let sawSwing = false;
  let maximumClearance = 0;

  for (let frame = 0; frame < 600; frame++) {
    state = locomotion.update(1 / 120, { desiredVelocity });
    assertFiniteMotion(state, `walk[${frame}]`);
    for (const foot of Object.values(state.feet)) {
      sawSwing ||= foot.swing > 0;
      maximumClearance = Math.max(maximumClearance, foot.position.y);
    }
  }

  assert.equal(state.gait, 'walk');
  assert.ok(sawSwing, 'walk cycle must lift at least one paw');
  assert.ok(maximumClearance >= .024, `paw clearance ${maximumClearance} must reach the 24 mm floor`);
  assert.ok(maximumClearance <= .05, `paw clearance ${maximumClearance} must stay within the neutral walking envelope`);
  assert.ok(state.position.z > 2.5, 'walk must advance the root in the requested direction');
});
