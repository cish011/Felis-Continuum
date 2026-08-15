import * as THREE from 'three';

const TAU = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Matrix4();

/**
 * Coarse semantic labels are stored per vertex in `aCatRegion`.  They are not
 * used to construct the silhouette, so changing coat shaders cannot alter the
 * anatomical surface.
 */
export const CAT_SKIN_REGIONS = Object.freeze({
  torso: 0,
  head: 1,
  forelimb: 2,
  hindlimb: 3,
  paw: 4,
  tail: 5,
});

export const CAT_SKIN_PART_BY_REGION = Object.freeze([
  'torso',
  'head',
  'frontLeg',
  'hindLeg',
  'paw',
  'tail',
]);

export const CAT_SKIN_QUALITY = Object.freeze({
  low: [35, 55, 113],
  balanced: [43, 67, 139],
  high: [53, 87, 169],
});

export const DEFAULT_CAT_SKIN_OPTIONS = Object.freeze({
  quality: 'balanced',
  isoLevel: 0,
  eyeSockets: true,
  color: 0x777b78,
  roughness: 0.82,
});

const SKIN_BOUNDS = Object.freeze({
  min: Object.freeze([-0.105, -0.205, -0.530]),
  max: Object.freeze([0.105, 0.180, 0.295]),
});

const TORSO_RINGS = Object.freeze([
  Object.freeze({ z:-0.220, rx:0.015, ry:0.017, y:0.028, ventralTaper:0.10, dorsalTaper:0.04 }),
  Object.freeze({ z:-0.202, rx:0.043, ry:0.040, y:0.013, ventralTaper:0.18, dorsalTaper:0.06 }),
  Object.freeze({ z:-0.166, rx:0.064, ry:0.056, y:0.003, ventralTaper:0.25, dorsalTaper:0.08 }),
  Object.freeze({ z:-0.125, rx:0.066, ry:0.057, y:0.004, ventralTaper:0.28, dorsalTaper:0.09 }),
  Object.freeze({ z:-0.082, rx:0.052, ry:0.044, y:0.009, ventralTaper:0.36, dorsalTaper:0.10 }),
  Object.freeze({ z:-0.045, rx:0.047, ry:0.038, y:0.012, ventralTaper:0.42, dorsalTaper:0.11 }),
  Object.freeze({ z:-0.010, rx:0.051, ry:0.045, y:0.009, ventralTaper:0.40, dorsalTaper:0.10 }),
  Object.freeze({ z: 0.028, rx:0.060, ry:0.058, y:0.001, ventralTaper:0.46, dorsalTaper:0.10 }),
  Object.freeze({ z: 0.070, rx:0.069, ry:0.068, y:-0.003, ventralTaper:0.52, dorsalTaper:0.09 }),
  Object.freeze({ z: 0.108, rx:0.071, ry:0.074, y:-0.004, ventralTaper:0.56, dorsalTaper:0.08 }),
  Object.freeze({ z: 0.142, rx:0.063, ry:0.056, y:0.008, ventralTaper:0.52, dorsalTaper:0.08 }),
  Object.freeze({ z: 0.170, rx:0.049, ry:0.036, y:0.020, ventralTaper:0.44, dorsalTaper:0.07 }),
  Object.freeze({ z: 0.190, rx:0.036, ry:0.025, y:0.035, ventralTaper:0.30, dorsalTaper:0.05 }),
]);

// The skull stations are already translated into body space.  The flattened
// forehead, zygomatic width and tapered rostrum deliberately avoid a sphere.
const SKULL_RINGS = Object.freeze([
  Object.freeze({ z:0.155, rx:0.026, ry:0.023, y:0.081 }),
  Object.freeze({ z:0.162, rx:0.041, ry:0.034, y:0.085 }),
  Object.freeze({ z:0.178, rx:0.049, ry:0.040, y:0.086 }),
  Object.freeze({ z:0.193, rx:0.050, ry:0.040, y:0.084 }),
  Object.freeze({ z:0.207, rx:0.047, ry:0.036, y:0.080 }),
  Object.freeze({ z:0.218, rx:0.039, ry:0.029, y:0.074 }),
  Object.freeze({ z:0.225, rx:0.030, ry:0.021, y:0.068 }),
]);

const FORE_LANDMARKS = Object.freeze({
  left: Object.freeze({
    shoulder: Object.freeze([-0.053, -0.004, 0.143]),
    elbow: Object.freeze([-0.050, -0.076, 0.086]),
    carpus: Object.freeze([-0.045, -0.151, 0.139]),
    mcp: Object.freeze([-0.043, -0.177, 0.159]),
    foot: Object.freeze([-0.043, -0.182, 0.181]),
  }),
  right: Object.freeze({
    shoulder: Object.freeze([0.053, -0.004, 0.143]),
    elbow: Object.freeze([0.050, -0.076, 0.086]),
    carpus: Object.freeze([0.045, -0.151, 0.139]),
    mcp: Object.freeze([0.043, -0.177, 0.159]),
    foot: Object.freeze([0.043, -0.182, 0.181]),
  }),
});

const HIND_LANDMARKS = Object.freeze({
  left: Object.freeze({
    hip: Object.freeze([-0.041, 0.006, -0.145]),
    stifle: Object.freeze([-0.050, -0.071, -0.077]),
    hock: Object.freeze([-0.048, -0.145, -0.164]),
    mtp: Object.freeze([-0.043, -0.178, -0.121]),
    foot: Object.freeze([-0.043, -0.182, -0.091]),
  }),
  right: Object.freeze({
    hip: Object.freeze([0.041, 0.006, -0.145]),
    stifle: Object.freeze([0.050, -0.071, -0.077]),
    hock: Object.freeze([0.048, -0.145, -0.164]),
    mtp: Object.freeze([0.043, -0.178, -0.121]),
    foot: Object.freeze([0.043, -0.182, -0.091]),
  }),
});

const TAIL_LENGTHS = Object.freeze(Array.from({ length: 14 }, (_, index) => 0.023 - index * 0.00028));
const TORSO_SECTION_BONES = Object.freeze([
  Object.freeze({ name:'pelvis', centerZ:-0.150 }),
  Object.freeze({ name:'lumbar', centerZ:-0.045 }),
  Object.freeze({ name:'thorax', centerZ:0.108 }),
]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function smoothstep(edge0, edge1, value) {
  const t=clamp((value-edge0)/(edge1-edge0),0,1);
  return t*t*(3-2*t);
}

function smoothMin(a, b, radius) {
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  if (radius <= 0) return Math.min(a, b);
  const h = Math.max(radius - Math.abs(a - b), 0) / radius;
  return Math.min(a, b) - h * h * h * radius / 6;
}

function smoothMax(a, b, radius) {
  return -smoothMin(-a, -b, radius);
}

function ellipsoidDistance(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = x - cx;
  const py = y - cy;
  const pz = z - cz;
  const qx = px / rx;
  const qy = py / ry;
  const qz = pz / rz;
  const k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  if (k0 < 1e-8) return -Math.min(rx, ry, rz);
  const k1 = Math.sqrt(
    px * px / (rx * rx * rx * rx)
    + py * py / (ry * ry * ry * ry)
    + pz * pz / (rz * rz * rz * rz),
  );
  return k1 > 1e-8 ? k0 * (k0 - 1) / k1 : (k0 - 1) * Math.min(rx, ry, rz);
}

function makeLoftDistance(rings) {
  return (x, y, z) => {
    let left = rings[0];
    let right = rings[rings.length - 1];
    if (z <= left.z) {
      const cap = Math.max(0.009, rings[1].z - left.z);
      return ellipsoidDistance(x, y, z, 0, left.y, left.z, left.rx, left.ry, cap);
    }
    if (z >= right.z) {
      const cap = Math.max(0.009, right.z - rings[rings.length - 2].z);
      return ellipsoidDistance(x, y, z, 0, right.y, right.z, right.rx, right.ry, cap);
    }
    for (let index = 0; index < rings.length - 1; index += 1) {
      left = rings[index];
      right = rings[index + 1];
      if (z > right.z) continue;
      const t = (z - left.z) / (right.z - left.z);
      const rx = mix(left.rx, right.rx, t);
      const ry = mix(left.ry, right.ry, t);
      const centerY = mix(left.y, right.y, t);
      const qy = (y - centerY) / ry;
      const ventralTaper=mix(left.ventralTaper ?? 0,right.ventralTaper ?? 0,t);
      const dorsalTaper=mix(left.dorsalTaper ?? 0,right.dorsalTaper ?? 0,t);
      const verticalTaper=qy<0
        ? ventralTaper*Math.pow(Math.min(1,-qy),1.35)
        : dorsalTaper*Math.pow(Math.min(1,qy),2);
      const localHalfWidth=rx*Math.max(.48,1-verticalTaper);
      const qx = x / localHalfWidth;
      return (Math.sqrt(qx * qx + qy * qy) - 1) * Math.min(rx, ry);
    }
    return 1;
  };
}

function makeEllipsoidDistance(center, radii) {
  const [cx, cy, cz] = center;
  const [rx, ry, rz] = radii;
  return (x, y, z) => ellipsoidDistance(x, y, z, cx, cy, cz, rx, ry, rz);
}

/**
 * An elliptical tapered capsule.  Projection is performed along its skeletal
 * centreline, while the residual is measured against anatomically useful X/Y/Z
 * radii.  The clamped projection also produces rounded, non-mechanical ends.
 */
function makeCapsuleDistance(start, end, startRadii, endRadii = startRadii) {
  const ax = start[0];
  const ay = start[1];
  const az = start[2];
  const dx = end[0] - ax;
  const dy = end[1] - ay;
  const dz = end[2] - az;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  return (x, y, z) => {
    const projection = lengthSquared > 1e-10
      ? ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / lengthSquared
      : 0;
    const t = clamp(projection, 0, 1);
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const cz = az + dz * t;
    const rx = mix(startRadii[0], endRadii[0], t);
    const ry = mix(startRadii[1], endRadii[1], t);
    const rz = mix(startRadii[2], endRadii[2], t);
    return ellipsoidDistance(x, y, z, cx, cy, cz, rx, ry, rz);
  };
}

function pointFrom(array) {
  return new THREE.Vector3(array[0], array[1], array[2]);
}

function segmentMatrix(startArray, endArray) {
  const start = pointFrom(startArray);
  const end = pointFrom(endArray);
  const center = start.clone().add(end).multiplyScalar(0.5);
  const direction = end.clone().sub(start);
  const quaternion = new THREE.Quaternion();
  if (direction.lengthSq() > 1e-12) quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
  return new THREE.Matrix4().compose(center, quaternion, new THREE.Vector3(1, 1, 1));
}

function transformMatrix(position, rotation = [0, 0, 0]) {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
  return new THREE.Matrix4().compose(pointFrom(position), quaternion, new THREE.Vector3(1, 1, 1));
}

function createTailLandmarks() {
  const segments = [];
  // Segment zero begins well inside the sacral envelope. The visible tail
  // emerges only after the centreline has traversed the pelvis, avoiding an
  // annular hose joint at the rump.
  let start = [0, 0.034, -0.198];
  for (let index = 0; index < TAIL_LENGTHS.length; index += 1) {
    const lift = 0.151 * Math.exp(-index / 4.2) - 0.018 * (index / (TAIL_LENGTHS.length - 1));
    const yaw = Math.sin(index * 0.42) * 0.025;
    const cosPitch = Math.cos(lift);
    const direction = [Math.sin(yaw) * cosPitch, Math.sin(lift), -Math.cos(yaw) * cosPitch];
    const length = TAIL_LENGTHS[index];
    const end = [
      start[0] + direction[0] * length,
      start[1] + direction[1] * length,
      start[2] + direction[2] * length,
    ];
    segments.push(Object.freeze({ start: Object.freeze(start), end: Object.freeze(end), length }));
    start = end;
  }
  return Object.freeze(segments);
}

const TAIL_LANDMARKS = createTailLandmarks();

function createField(options) {
  const primitives = [];
  const bones = [];
  const boneIndex = new Map();

  const addBone = (name, restMatrix) => {
    if (boneIndex.has(name)) return boneIndex.get(name);
    const index = bones.length;
    boneIndex.set(name, index);
    bones.push({ name, restMatrix: restMatrix.clone() });
    return index;
  };

  const addPrimitive = ({ name, bone, region, distance, blend = 0.0055 }) => {
    const index = addBone(bone, IDENTITY);
    primitives.push({ name, bone, boneIndex: index, region, distance, blend });
  };

  addBone('torso', IDENTITY);
  for(const section of TORSO_SECTION_BONES) {
    addBone(section.name,transformMatrix([0,0,section.centerZ]));
  }
  addBone('neck', transformMatrix([0, 0.030, 0.170], [-0.20, 0, 0]));
  addBone('head', transformMatrix([0, 0.078, 0.170]));
  addBone('frontLeft.scapula', transformMatrix([-0.056, 0.037, 0.112], [-0.17, 0, 0]));
  addBone('frontRight.scapula', transformMatrix([0.056, 0.037, 0.112], [-0.17, 0, 0]));

  addPrimitive({
    name: 'pelvis-waist-ribcage',
    bone: 'torso',
    region: CAT_SKIN_REGIONS.torso,
    distance: makeLoftDistance(TORSO_RINGS),
    blend: 0,
  });

  addPrimitive({
    name: 'sacral-tail-transition',
    bone: 'pelvis',
    region: CAT_SKIN_REGIONS.torso,
    distance: makeCapsuleDistance([0, 0.027, -0.168], [0, 0.034, -0.218], [0.030, 0.025, 0.038], [0.016, 0.016, 0.020]),
    blend: 0.014,
  });

  addPrimitive({
    name: 'cervical-column',
    bone: 'neck',
    region: CAT_SKIN_REGIONS.torso,
    distance: makeCapsuleDistance([0, 0.026, 0.151], [0, 0.075, 0.157], [0.024, 0.018, 0.020], [0.025, 0.020, 0.019]),
    blend: 0.012,
  });

  addPrimitive({
    name: 'dorsal-nuchal-bridge',
    bone: 'neck',
    region: CAT_SKIN_REGIONS.torso,
    distance: makeCapsuleDistance([0, 0.055, 0.143], [0, 0.088, 0.158], [0.032, 0.014, 0.022], [0.027, 0.016, 0.019]),
    blend: 0.012,
  });

  addPrimitive({
    name: 'mesocephalic-cranium',
    bone: 'head',
    region: CAT_SKIN_REGIONS.head,
    distance: makeLoftDistance(SKULL_RINGS),
    blend: 0.007,
  });

  for (const sign of [-1, 1]) {
    addPrimitive({
      name: `${sign < 0 ? 'left' : 'right'}-zygomatic-arch`,
      bone: 'head',
      region: CAT_SKIN_REGIONS.head,
      distance: makeEllipsoidDistance([sign * 0.033, 0.068, 0.193], [0.017, 0.019, 0.020]),
      blend: 0.007,
    });
    addPrimitive({
      name: `${sign < 0 ? 'left' : 'right'}-whisker-pad`,
      bone: 'head',
      region: CAT_SKIN_REGIONS.head,
      distance: makeEllipsoidDistance([sign * 0.0155, 0.056, 0.229], [0.017, 0.0115, 0.010]),
      blend: 0.010,
    });
    addPrimitive({
      name: `${sign < 0 ? 'left' : 'right'}-auricular-root`,
      bone: 'head',
      region: CAT_SKIN_REGIONS.head,
      distance: makeEllipsoidDistance([sign * 0.031, 0.109, 0.177], [0.020, 0.018, 0.015]),
      blend: 0.004,
    });
  }

  addPrimitive({
    name: 'nasal-bridge-and-rostrum',
    bone: 'head',
    region: CAT_SKIN_REGIONS.head,
    distance: makeCapsuleDistance([0, 0.090, 0.219], [0, 0.061, 0.240], [0.015, 0.010, 0.011], [0.0085, 0.0075, 0.008]),
    blend: 0.008,
  });
  addPrimitive({
    name: 'mandible',
    bone: 'head',
    region: CAT_SKIN_REGIONS.head,
    distance: makeCapsuleDistance([0, 0.054, 0.207], [0, 0.050, 0.234], [0.020, 0.010, 0.012], [0.012, 0.0075, 0.007]),
    blend: 0.007,
  });

  const addLimb = (sideName, landmarks, front) => {
    const prefix = `${front ? 'front' : 'hind'}${sideName[0].toUpperCase()}${sideName.slice(1)}`;
    const proximalName = front ? 'upper' : 'upper';
    const middleName = 'lower';
    const distalName = 'metapodial';
    const pawName = 'paw';
    const proximalStart = front ? landmarks.shoulder : landmarks.hip;
    const proximalEnd = front ? landmarks.elbow : landmarks.stifle;
    const middleEnd = front ? landmarks.carpus : landmarks.hock;
    const distalEnd = front ? landmarks.mcp : landmarks.mtp;
    const region = front ? CAT_SKIN_REGIONS.forelimb : CAT_SKIN_REGIONS.hindlimb;

    addBone(`${prefix}.${proximalName}`, segmentMatrix(proximalStart, proximalEnd));
    addBone(`${prefix}.${middleName}`, segmentMatrix(proximalEnd, middleEnd));
    addBone(`${prefix}.${distalName}`, segmentMatrix(middleEnd, distalEnd));
    const contactOffset = front ? 0.0085 : 0.0080;
    const pawBoneCenter = [landmarks.foot[0], landmarks.foot[1] + contactOffset, landmarks.foot[2]];
    const pawCenter = [landmarks.foot[0], landmarks.foot[1] + contactOffset, landmarks.foot[2] - 0.002];
    addBone(`${prefix}.${pawName}`, transformMatrix(pawBoneCenter));

    if(front) {
      const sideSign=landmarks.shoulder[0]<0?-1:1;
      addPrimitive({
        name: `${prefix}-scapular-mantle`,
        bone: `${prefix}.scapula`,
        region,
        distance: makeCapsuleDistance(
          [sideSign*0.044,0.045,0.096],
          [sideSign*0.052,-0.006,0.142],
          [0.011,0.010,0.026],
          [0.017,0.016,0.016],
        ),
        blend:0.009,
      });
    } else {
      addPrimitive({
        name: `${prefix}-pelvic-gluteal-fusion`,
        bone: 'pelvis',
        region,
        distance: makeEllipsoidDistance(
          [landmarks.hip[0] < 0 ? -0.044 : 0.044,0.006,-0.151],
          [0.029,0.036,0.044],
        ),
        blend:0.014,
      });
    }

    addPrimitive({
      name: `${prefix}-proximal-muscle`,
      bone: `${prefix}.${proximalName}`,
      region,
      distance: front
        ? makeCapsuleDistance(proximalStart,proximalEnd,[0.018,0.021,0.017],[0.013,0.014,0.011])
        : makeCapsuleDistance(
          proximalStart,
          [landmarks.hip[0] < 0 ? -0.048 : 0.048,-0.040,-0.108],
          [0.033,0.036,0.031],
          [0.028,0.031,0.026],
        ),
      blend: front ? 0.009 : 0.011,
    });
    if(!front) {
      addPrimitive({
        name:`${prefix}-distal-thigh`,
        bone:`${prefix}.${proximalName}`,
        region,
        distance:makeCapsuleDistance(
          [landmarks.hip[0] < 0 ? -0.048 : 0.048,-0.040,-0.108],
          proximalEnd,
          [0.028,0.031,0.026],
          [0.017,0.019,0.015],
        ),
        blend:0.011,
      });
    }
    addPrimitive({
      name: `${prefix}-middle-muscle`,
      bone: `${prefix}.${middleName}`,
      region,
      distance: front
        ? makeCapsuleDistance(proximalEnd,middleEnd,[0.015,0.016,0.013],[0.008,0.009,0.007])
        : makeCapsuleDistance(
          proximalEnd,
          [landmarks.hock[0] < 0 ? -0.050 : 0.050,-0.112,-0.125],
          [0.020,0.023,0.017],
          [0.016,0.019,0.014],
        ),
      blend: front ? 0.006 : 0.008,
    });
    if(!front) {
      addPrimitive({
        name:`${prefix}-distal-crus`,
        bone:`${prefix}.${middleName}`,
        region,
        distance:makeCapsuleDistance(
          [landmarks.hock[0] < 0 ? -0.050 : 0.050,-0.112,-0.125],
          middleEnd,
          [0.014,0.016,0.012],
          [0.009,0.010,0.008],
        ),
        blend:0.007,
      });
    }
    addPrimitive({
      name: `${prefix}-digitigrade-metapodial`,
      bone: `${prefix}.${distalName}`,
      region,
      distance: makeCapsuleDistance(
        middleEnd,
        distalEnd,
        front ? [0.0080, 0.0080, 0.0068] : [0.0090, 0.0095, 0.0075],
        front ? [0.0065, 0.0070, 0.0060] : [0.0068, 0.0072, 0.0062],
      ),
      blend: 0.004,
    });

    const bridgeEnd=[
      landmarks.foot[0],
      landmarks.foot[1]+(front?0.0065:0.0060),
      landmarks.foot[2]-(front?0.010:0.012),
    ];
    addPrimitive({
      name:`${prefix}-paw-chain-bridge`,
      bone:`${prefix}.${distalName}`,
      region,
      distance:makeCapsuleDistance(
        distalEnd,
        bridgeEnd,
        front?[0.0065,0.0070,0.0060]:[0.0068,0.0072,0.0062],
        front?[0.0085,0.0075,0.0080]:[0.0080,0.0072,0.0085],
      ),
      blend:0.006,
    });

    const pawRadii = front ? [0.0135, 0.0085, 0.0145] : [0.0125, 0.0080, 0.0150];
    addPrimitive({
      name: `${prefix}-metacarpal-pad-and-paw`,
      bone: `${prefix}.${pawName}`,
      region: CAT_SKIN_REGIONS.paw,
      distance: makeEllipsoidDistance(pawCenter, pawRadii),
      blend: 0.004,
    });
    const toeOffsets=[-0.0065,-0.0022,0.0022,0.0065];
    for (let digit = 0; digit < 4; digit += 1) {
      const lateral = toeOffsets[digit];
      addPrimitive({
        name: `${prefix}-digit-${digit}`,
        bone: `${prefix}.${pawName}`,
        region: CAT_SKIN_REGIONS.paw,
        distance: makeEllipsoidDistance(
          [landmarks.foot[0] + lateral, landmarks.foot[1] + (front ? 0.0055 : 0.0052), landmarks.foot[2] + (front ? 0.0115 : 0.0125)],
          front ? [0.0040,0.0054,0.0060] : [0.0039,0.0051,0.0060],
        ),
        blend: 0.0025,
      });
    }
  };

  addLimb('left', FORE_LANDMARKS.left, true);
  addLimb('right', FORE_LANDMARKS.right, true);
  addLimb('left', HIND_LANDMARKS.left, false);
  addLimb('right', HIND_LANDMARKS.right, false);

  for (let index = 0; index < TAIL_LANDMARKS.length; index += 1) {
    const landmark = TAIL_LANDMARKS[index];
    const bone = `tail.${index}`;
    const authoredRadii=[0.0170,0.0150,0.0130];
    const startRadius = authoredRadii[index] ?? mix(0.0105, 0.0044, (index - 2) / (TAIL_LANDMARKS.length - 3));
    const endRadius = authoredRadii[index + 1] ?? mix(0.0105, 0.0042, (index - 1) / (TAIL_LANDMARKS.length - 3));
    addBone(bone, segmentMatrix(landmark.start, landmark.end));
    addPrimitive({
      name: `tail-skin-${index}`,
      bone,
      region: CAT_SKIN_REGIONS.tail,
      distance: makeCapsuleDistance(
        landmark.start,
        landmark.end,
        [startRadius, startRadius, startRadius],
        [endRadius, endRadius, endRadius],
      ),
      blend: index === 0 ? 0.012 : index < 3 ? 0.006 : 0.004,
    });
  }

  // Replace placeholder identity matrices for named bones with their authored
  // rest matrices.  addPrimitive intentionally accepts bones in any order.
  const setRest = (name, matrix) => {
    const index = boneIndex.get(name);
    if (index !== undefined) bones[index].restMatrix.copy(matrix);
  };
  setRest('torso', IDENTITY);
  for(const section of TORSO_SECTION_BONES) {
    setRest(section.name,transformMatrix([0,0,section.centerZ]));
  }
  setRest('neck', transformMatrix([0, 0.030, 0.170], [-0.20, 0, 0]));
  setRest('head', transformMatrix([0, 0.078, 0.170]));
  setRest('frontLeft.scapula', transformMatrix([-0.056, 0.037, 0.112], [-0.17, 0, 0]));
  setRest('frontRight.scapula', transformMatrix([0.056, 0.037, 0.112], [-0.17, 0, 0]));
  for (const [sideName, landmarks] of Object.entries(FORE_LANDMARKS)) {
    const prefix = `front${sideName[0].toUpperCase()}${sideName.slice(1)}`;
    setRest(`${prefix}.upper`, segmentMatrix(landmarks.shoulder, landmarks.elbow));
    setRest(`${prefix}.lower`, segmentMatrix(landmarks.elbow, landmarks.carpus));
    setRest(`${prefix}.metapodial`, segmentMatrix(landmarks.carpus, landmarks.mcp));
    setRest(`${prefix}.paw`, transformMatrix([landmarks.foot[0], landmarks.foot[1] + 0.0085, landmarks.foot[2]]));
  }
  for (const [sideName, landmarks] of Object.entries(HIND_LANDMARKS)) {
    const prefix = `hind${sideName[0].toUpperCase()}${sideName.slice(1)}`;
    setRest(`${prefix}.upper`, segmentMatrix(landmarks.hip, landmarks.stifle));
    setRest(`${prefix}.lower`, segmentMatrix(landmarks.stifle, landmarks.hock));
    setRest(`${prefix}.metapodial`, segmentMatrix(landmarks.hock, landmarks.mtp));
    setRest(`${prefix}.paw`, transformMatrix([landmarks.foot[0], landmarks.foot[1] + 0.0080, landmarks.foot[2]]));
  }
  TAIL_LANDMARKS.forEach((landmark, index) => setRest(`tail.${index}`, segmentMatrix(landmark.start, landmark.end)));

  const socketDistance = options.eyeSockets === false
    ? null
    : (x, y, z) => Math.min(
      ellipsoidDistance(x, y, z, -0.028, 0.087, 0.212, 0.0095, 0.0075, 0.013),
      ellipsoidDistance(x, y, z, 0.028, 0.087, 0.212, 0.0095, 0.0075, 0.013),
    );

  const distance = (x, y, z) => {
    let result = Number.POSITIVE_INFINITY;
    for (let index = 0; index < primitives.length; index += 1) {
      const primitive = primitives[index];
      result = smoothMin(result, primitive.distance(x, y, z), primitive.blend);
    }
    if (socketDistance) result = smoothMax(result, -socketDistance(x, y, z), 0.0022);
    return result;
  };

  return { primitives, bones, boneIndex, distance };
}

function resolveResolution(options) {
  if (Array.isArray(options.resolution) && options.resolution.length === 3) {
    // Below the low preset a four-millimetre tail tip can fall between grid
    // samples and become a tiny detached island.  Preserve the topology even
    // when a caller supplies an aggressively small custom grid.
    return options.resolution.map((value, axis) => clamp(
      Math.round(Number(value) || 0),
      CAT_SKIN_QUALITY.low[axis],
      240,
    ));
  }
  return [...(CAT_SKIN_QUALITY[options.quality] ?? CAT_SKIN_QUALITY.balanced)];
}

function vertexKey(indexA, indexB, sampleCount) {
  const low = Math.min(indexA, indexB);
  const high = Math.max(indexA, indexB);
  return low * sampleCount + high;
}

function buildIsosurface(field, resolution, isoLevel, bounds) {
  const [nx, ny, nz] = resolution;
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const stepX = (maxX - minX) / (nx - 1);
  const stepY = (maxY - minY) / (ny - 1);
  const stepZ = (maxZ - minZ) / (nz - 1);
  const sampleCount = nx * ny * nz;
  const samples = new Float32Array(sampleCount);
  const xs = new Float32Array(nx);
  const ys = new Float32Array(ny);
  const zs = new Float32Array(nz);
  for (let x = 0; x < nx; x += 1) xs[x] = minX + x * stepX;
  for (let y = 0; y < ny; y += 1) ys[y] = minY + y * stepY;
  for (let z = 0; z < nz; z += 1) zs[z] = minZ + z * stepZ;

  let pointer = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        samples[pointer] = field.distance(xs[x], ys[y], zs[z]) - isoLevel;
        pointer += 1;
      }
    }
  }

  const positions = [];
  const indices = [];
  const edgeVertices = new Map();
  const cornerSamples = new Float64Array(8);
  const cornerIndices = new Float64Array(8);
  const cornerX = new Float64Array(8);
  const cornerY = new Float64Array(8);
  const cornerZ = new Float64Array(8);
  const tetrahedra = [
    [0, 5, 1, 6],
    [0, 1, 2, 6],
    [0, 2, 3, 6],
    [0, 3, 7, 6],
    [0, 7, 4, 6],
    [0, 4, 5, 6],
  ];

  const getVertex = (cornerA, cornerB) => {
    const globalA = cornerIndices[cornerA];
    const globalB = cornerIndices[cornerB];
    const key = vertexKey(globalA, globalB, sampleCount);
    const cached = edgeVertices.get(key);
    if (cached !== undefined) return cached;
    const valueA = cornerSamples[cornerA];
    const valueB = cornerSamples[cornerB];
    const denominator = valueA - valueB;
    const t = Math.abs(denominator) > 1e-12 ? clamp(valueA / denominator, 0, 1) : 0.5;
    const vertex = positions.length / 3;
    positions.push(
      mix(cornerX[cornerA], cornerX[cornerB], t),
      mix(cornerY[cornerA], cornerY[cornerB], t),
      mix(cornerZ[cornerA], cornerZ[cornerB], t),
    );
    edgeVertices.set(key, vertex);
    return vertex;
  };

  const addTriangle = (a, b, c, outwardX, outwardY, outwardZ) => {
    if (a === b || b === c || c === a) return;
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const abx = positions[b * 3] - ax;
    const aby = positions[b * 3 + 1] - ay;
    const abz = positions[b * 3 + 2] - az;
    const acx = positions[c * 3] - ax;
    const acy = positions[c * 3 + 1] - ay;
    const acz = positions[c * 3 + 2] - az;
    const nxTriangle = aby * acz - abz * acy;
    const nyTriangle = abz * acx - abx * acz;
    const nzTriangle = abx * acy - aby * acx;
    if (nxTriangle * outwardX + nyTriangle * outwardY + nzTriangle * outwardZ < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };

  const polygoniseTetrahedron = tetrahedron => {
    const inside = [];
    const outside = [];
    for (let index = 0; index < 4; index += 1) {
      const corner = tetrahedron[index];
      (cornerSamples[corner] <= 0 ? inside : outside).push(corner);
    }
    if (inside.length === 0 || inside.length === 4) return;

    let insideX = 0;
    let insideY = 0;
    let insideZ = 0;
    let outsideX = 0;
    let outsideY = 0;
    let outsideZ = 0;
    for (const corner of inside) {
      insideX += cornerX[corner];
      insideY += cornerY[corner];
      insideZ += cornerZ[corner];
    }
    for (const corner of outside) {
      outsideX += cornerX[corner];
      outsideY += cornerY[corner];
      outsideZ += cornerZ[corner];
    }
    insideX /= inside.length;
    insideY /= inside.length;
    insideZ /= inside.length;
    outsideX /= outside.length;
    outsideY /= outside.length;
    outsideZ /= outside.length;
    const outwardX = outsideX - insideX;
    const outwardY = outsideY - insideY;
    const outwardZ = outsideZ - insideZ;

    if (inside.length === 1) {
      const anchor = inside[0];
      addTriangle(
        getVertex(anchor, outside[0]),
        getVertex(anchor, outside[1]),
        getVertex(anchor, outside[2]),
        outwardX,
        outwardY,
        outwardZ,
      );
      return;
    }
    if (inside.length === 3) {
      const anchor = outside[0];
      addTriangle(
        getVertex(anchor, inside[0]),
        getVertex(anchor, inside[1]),
        getVertex(anchor, inside[2]),
        outwardX,
        outwardY,
        outwardZ,
      );
      return;
    }

    const ac = getVertex(inside[0], outside[0]);
    const ad = getVertex(inside[0], outside[1]);
    const bc = getVertex(inside[1], outside[0]);
    const bd = getVertex(inside[1], outside[1]);
    addTriangle(ac, ad, bd, outwardX, outwardY, outwardZ);
    addTriangle(ac, bd, bc, outwardX, outwardY, outwardZ);
  };

  const slice = nx * ny;
  for (let z = 0; z < nz - 1; z += 1) {
    for (let y = 0; y < ny - 1; y += 1) {
      for (let x = 0; x < nx - 1; x += 1) {
        const i000 = x + nx * y + slice * z;
        const corners = [
          i000,
          i000 + 1,
          i000 + 1 + nx,
          i000 + nx,
          i000 + slice,
          i000 + slice + 1,
          i000 + slice + 1 + nx,
          i000 + slice + nx,
        ];
        const coordinates = [
          [xs[x], ys[y], zs[z]],
          [xs[x + 1], ys[y], zs[z]],
          [xs[x + 1], ys[y + 1], zs[z]],
          [xs[x], ys[y + 1], zs[z]],
          [xs[x], ys[y], zs[z + 1]],
          [xs[x + 1], ys[y], zs[z + 1]],
          [xs[x + 1], ys[y + 1], zs[z + 1]],
          [xs[x], ys[y + 1], zs[z + 1]],
        ];
        let minimum = Number.POSITIVE_INFINITY;
        let maximum = Number.NEGATIVE_INFINITY;
        for (let corner = 0; corner < 8; corner += 1) {
          const sample = samples[corners[corner]];
          cornerSamples[corner] = sample;
          cornerIndices[corner] = corners[corner];
          cornerX[corner] = coordinates[corner][0];
          cornerY[corner] = coordinates[corner][1];
          cornerZ[corner] = coordinates[corner][2];
          minimum = Math.min(minimum, sample);
          maximum = Math.max(maximum, sample);
        }
        if (minimum > 0 || maximum <= 0) continue;
        for (const tetrahedron of tetrahedra) polygoniseTetrahedron(tetrahedron);
      }
    }
  }

  return { positions, indices, sampleCount, step: [stepX, stepY, stepZ] };
}

function addSkinningAttributes(geometry, field, bounds) {
  const position = geometry.getAttribute('position');
  const vertexCount = position.count;
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  const regions = new Float32Array(vertexCount);
  const uvs = new Float32Array(vertexCount * 2);
  const byBone = new Float64Array(field.bones.length);
  const candidates = [];
  const minY = bounds.min[1];
  const height = bounds.max[1] - minY;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    const z = position.getZ(vertex);
    byBone.fill(Number.POSITIVE_INFINITY);
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestRegion = CAT_SKIN_REGIONS.torso;
    for (let index = 0; index < field.primitives.length; index += 1) {
      const primitive = field.primitives[index];
      const distance = primitive.distance(x, y, z);
      if(primitive.name==='pelvis-waist-ribcage') {
        // Explicit longitudinal weights prevent all three spine frames from
        // averaging into another rigid capsule. Pelvis dominates the croup,
        // lumbar dominates the tuck, and thorax dominates the ribcage.
        const pelvisWeight=1-smoothstep(-0.125,-0.055,z);
        const thoraxWeight=smoothstep(-0.015,0.075,z);
        const lumbarWeight=Math.max(0,1-pelvisWeight-thoraxWeight);
        const sectionWeights={pelvis:pelvisWeight,lumbar:lumbarWeight,thorax:thoraxWeight};
        for(const section of TORSO_SECTION_BONES) {
          const weight=Math.max(1e-5,sectionWeights[section.name]*0.92);
          const sectionIndex=field.boneIndex.get(section.name);
          byBone[sectionIndex]=Math.min(byBone[sectionIndex],distance-Math.log(weight)*0.009);
        }
        byBone[primitive.boneIndex]=Math.min(byBone[primitive.boneIndex],distance-Math.log(0.08)*0.009);
      } else {
        if(distance<byBone[primitive.boneIndex]) byBone[primitive.boneIndex]=distance;
        if(primitive.name.endsWith('-scapular-mantle')) {
          const prefix=primitive.name.slice(0,-'-scapular-mantle'.length);
          const upperIndex=field.boneIndex.get(`${prefix}.upper`);
          const thoraxIndex=field.boneIndex.get('thorax');
          const lowerHalf=y<0.024;
          byBone[upperIndex]=Math.min(byBone[upperIndex],distance+(lowerHalf?0.001:0.006));
          byBone[thoraxIndex]=Math.min(byBone[thoraxIndex],distance+(lowerHalf?0.005:0.001));
        } else if(primitive.name.endsWith('-pelvic-gluteal-fusion')) {
          const prefix=primitive.name.slice(0,-'-pelvic-gluteal-fusion'.length);
          const upperIndex=field.boneIndex.get(`${prefix}.upper`);
          byBone[upperIndex]=Math.min(byBone[upperIndex],distance+0.003);
        } else if(primitive.name.endsWith('-distal-thigh')) {
          const pelvisIndex=field.boneIndex.get('pelvis');
          byBone[pelvisIndex]=Math.min(byBone[pelvisIndex],distance+0.010);
        } else if(primitive.name.endsWith('-paw-chain-bridge')) {
          const prefix=primitive.name.slice(0,-'-paw-chain-bridge'.length);
          const pawIndex=field.boneIndex.get(`${prefix}.paw`);
          byBone[pawIndex]=Math.min(byBone[pawIndex],distance+0.0015);
        }
      }
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestRegion = primitive.region;
      }
    }
    candidates.length = 0;
    for (let bone = 0; bone < byBone.length; bone += 1) {
      const delta = byBone[bone] - nearestDistance;
      if (delta <= 0.040) candidates.push([bone, Math.exp(-Math.max(0, delta) / 0.009)]);
    }
    candidates.sort((a, b) => b[1] - a[1]);
    let totalWeight = 0;
    for (let influence = 0; influence < 4; influence += 1) {
      const candidate = candidates[influence];
      const offset = vertex * 4 + influence;
      if (!candidate) {
        skinIndices[offset] = 0;
        skinWeights[offset] = 0;
        continue;
      }
      skinIndices[offset] = candidate[0];
      skinWeights[offset] = candidate[1];
      totalWeight += candidate[1];
    }
    if (totalWeight <= 1e-8) {
      skinIndices[vertex * 4] = 0;
      skinWeights[vertex * 4] = 1;
    } else {
      for (let influence = 0; influence < 4; influence += 1) skinWeights[vertex * 4 + influence] /= totalWeight;
    }
    regions[vertex] = nearestRegion;
    uvs[vertex * 2] = 0.5 + Math.atan2(x, z) / TAU;
    uvs[vertex * 2 + 1] = (y - minY) / height;
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setAttribute('aCatRegion', new THREE.Float32BufferAttribute(regions, 1));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
}

/**
 * Generates the one-piece rest surface and its four-weight linear skinning
 * attributes.  This is intentionally a startup operation; pose updates only
 * move skeleton matrices and never rerun marching tetrahedra.
 */
export function generateContinuousCatSkinGeometry(options = {}) {
  const resolved = { ...DEFAULT_CAT_SKIN_OPTIONS, ...options };
  const resolution = resolveResolution(resolved);
  const bounds = {
    min: [...(resolved.bounds?.min ?? SKIN_BOUNDS.min)],
    max: [...(resolved.bounds?.max ?? SKIN_BOUNDS.max)],
  };
  const started = globalThis.performance?.now?.() ?? Date.now();
  const field = createField(resolved);
  const surface = buildIsosurface(field, resolution, Number(resolved.isoLevel) || 0, bounds);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3));
  geometry.setIndex(surface.indices);
  addSkinningAttributes(geometry, field, bounds);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'continuous-implicit-domestic-cat-skin';
  const elapsedMilliseconds = (globalThis.performance?.now?.() ?? Date.now()) - started;
  const stats = Object.freeze({
    resolution: Object.freeze([...resolution]),
    samples: surface.sampleCount,
    vertices: geometry.getAttribute('position').count,
    triangles: geometry.index.count / 3,
    bones: field.bones.length,
    generationMilliseconds: elapsedMilliseconds,
    voxelSize: Object.freeze([...surface.step]),
  });
  geometry.userData.catSkin = {
    version: 1,
    stats,
    boneNames: field.bones.map(bone => bone.name),
    regions: CAT_SKIN_REGIONS,
  };
  return { geometry, field, stats, bounds };
}

function copyObjectMatrix(targetBone, sourceObject, parentMatrix = null, temporary = new THREE.Matrix4()) {
  if (!targetBone || !sourceObject) return false;
  sourceObject.updateMatrix?.();
  if (parentMatrix) targetBone.matrix.copy(temporary.multiplyMatrices(parentMatrix, sourceObject.matrix));
  else targetBone.matrix.copy(sourceObject.matrix);
  targetBone.matrixWorldNeedsUpdate = true;
  return true;
}

/**
 * Runtime wrapper around the generated SkinnedMesh.  All bones are siblings in
 * cat-root space, which makes the adapter tolerant of the current procedural
 * rig's mixed body-child and root-child transforms.
 */
export class ContinuousCatSkin {
  constructor(options = {}) {
    const generated = generateContinuousCatSkinGeometry(options);
    this.geometry = generated.geometry;
    this.stats = generated.stats;
    this.bounds = generated.bounds;
    this.ownsMaterial = !options.material;
    this.material = options.material ?? new THREE.MeshStandardMaterial({
      name: 'neutral-shorthaired-anatomy-surface',
      color: options.color ?? DEFAULT_CAT_SKIN_OPTIONS.color,
      roughness: options.roughness ?? DEFAULT_CAT_SKIN_OPTIONS.roughness,
      metalness: 0,
      side: THREE.FrontSide,
    });
    this.mesh = new THREE.SkinnedMesh(this.geometry, this.material);
    this.mesh.name = 'continuous-neutral-shorthair-skin';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    // Existing interaction code sees a conservative torso fallback.  Newer
    // callers can use resolvePetPart(intersection) for per-face semantics.
    this.mesh.userData.catPart = 'torso';
    this.mesh.userData.catSkin = this.geometry.userData.catSkin;
    this.mesh.userData.resolveCatPart = intersection => this.resolvePetPart(intersection);
    this.bones = new Map();
    this.restMatrices = new Map();
    const skeletonBones = [];
    for (const definition of generated.field.bones) {
      const bone = new THREE.Bone();
      bone.name = `skin.${definition.name}`;
      bone.matrixAutoUpdate = false;
      bone.matrix.copy(definition.restMatrix);
      bone.matrixWorldNeedsUpdate = true;
      this.mesh.add(bone);
      this.bones.set(definition.name, bone);
      this.restMatrices.set(definition.name, definition.restMatrix.clone());
      skeletonBones.push(bone);
    }
    this.mesh.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(skeletonBones);
    this.mesh.bind(this.skeleton);
    this.mesh.normalizeSkinWeights();
    this._temporaryMatrix = new THREE.Matrix4();
    this._sectionMatrix = new THREE.Matrix4();
    this._sectionLocalMatrix = new THREE.Matrix4();
    this._sectionQuaternion = new THREE.Quaternion();
    this._sectionEuler = new THREE.Euler();
    this._sectionPosition = new THREE.Vector3();
    this._sectionScale = new THREE.Vector3(1, 1, 1);
    this._sectionRestInverse = new THREE.Matrix4();
    this._pelvisLocalDelta = new THREE.Matrix4();
    this._pelvisRootDelta = new THREE.Matrix4();
    this._bodyInverse = new THREE.Matrix4();
    this._hiddenLegacy = new Map();
    this._catModel = null;
  }

  get object3d() {
    return this.mesh;
  }

  setBoneMatrix(name, matrix) {
    const bone = this.bones.get(name);
    if (!bone || !matrix?.isMatrix4) return false;
    bone.matrix.copy(matrix);
    bone.matrixWorldNeedsUpdate = true;
    return true;
  }

  /** Apply any subset of root-local matrices keyed by the exported bone names. */
  updatePose(pose = {}) {
    const matrices = pose.bones ?? pose;
    for (const [name, matrix] of Object.entries(matrices)) this.setBoneMatrix(name, matrix);
    this.mesh.updateMatrixWorld(true);
    this.skeleton.update();
  }

  resetPose() {
    for (const [name, matrix] of this.restMatrices) this.setBoneMatrix(name, matrix);
    this.mesh.updateMatrixWorld(true);
    this.skeleton.update();
  }

  resolvePetPart(intersection) {
    const region = this.geometry.getAttribute('aCatRegion');
    const face = intersection?.face;
    if (!region || !face) return 'torso';
    const values = [region.getX(face.a), region.getX(face.b), region.getX(face.c)].map(Math.round);
    const selected = values[0] === values[1] || values[0] === values[2]
      ? values[0]
      : values[1] === values[2]
        ? values[1]
        : values[0];
    return CAT_SKIN_PART_BY_REGION[selected] ?? 'torso';
  }

  /**
   * Copies the live CatModel pose after CatModel.update().  No geometry is
   * rebuilt: this path is matrix-only and is safe to call every animation frame.
   */
  updateFromCatModel(catModel = this._catModel) {
    if (!catModel?.body) return false;
    catModel.body.updateMatrix?.();
    const bodyMatrix = catModel.body.matrix;
    copyObjectMatrix(this.bones.get('torso'), catModel.body);

    const motion=catModel.lastMotion ?? {};
    const bodyScale=Math.max(0.001,catModel.root?.scale?.x ?? 1);
    const bodyHeight=Number(motion.bodyHeight);
    const pelvisHeight=Number(motion.pelvisHeight);
    const shoulderHeight=Number(motion.shoulderHeight);
    const pelvisOffset=Number.isFinite(pelvisHeight)&&Number.isFinite(bodyHeight)
      ? clamp((pelvisHeight-bodyHeight)/bodyScale,-0.032,0.032)
      : 0;
    const thoraxOffset=Number.isFinite(shoulderHeight)&&Number.isFinite(bodyHeight)
      ? clamp((shoulderHeight-bodyHeight)/bodyScale,-0.032,0.032)
      : 0;
    const bend=clamp(Number(motion.spineBend)||0,-0.32,0.32);
    const speed=Math.max(0,Number(motion.speed)||0);
    const phase=Number(motion.gaitPhase)||0;
    const move=smoothstep(0.05,0.9,speed);
    const walkWindow=smoothstep(0.08,0.8,speed)*(1-smoothstep(1.5,2.2,speed));
    const walkWave=Math.sin(phase*TAU)*walkWindow*0.028;
    const flex=clamp((Number(motion.spineFlex)||0)+walkWave,-0.16,0.16);
    const counter=Math.cos(phase*TAU)*move;
    const sectionPose={
      pelvis:{ y:pelvisOffset-counter*0.0035, z:Math.abs(flex)*0.010, pitch:-flex*0.50, yaw:-bend*0.42, roll:walkWave*0.012 },
      lumbar:{ y:mix(pelvisOffset,thoraxOffset,0.46)+Math.abs(flex)*0.012, z:0, pitch:flex*1.35, yaw:bend*0.78, roll:0 },
      thorax:{ y:thoraxOffset+counter*0.0025, z:-Math.abs(flex)*0.006, pitch:flex*0.36, yaw:bend*0.20, roll:-walkWave*0.010 },
    };
    for(const section of TORSO_SECTION_BONES) {
      const pose=sectionPose[section.name];
      this._sectionPosition.set(0,pose.y,section.centerZ+pose.z);
      this._sectionEuler.set(pose.pitch,pose.yaw,pose.roll,'XYZ');
      this._sectionQuaternion.setFromEuler(this._sectionEuler);
      if(section.name==='lumbar') this._sectionScale.set(1,1+Math.abs(flex)*0.10,1-Math.abs(flex)*0.04);
      else this._sectionScale.set(1,1,1);
      this._sectionLocalMatrix.compose(this._sectionPosition,this._sectionQuaternion,this._sectionScale);
      this._sectionMatrix.multiplyMatrices(bodyMatrix,this._sectionLocalMatrix);
      this.setBoneMatrix(section.name,this._sectionMatrix);
      if(section.name==='pelvis') {
        this._sectionRestInverse.copy(this.restMatrices.get('pelvis')).invert();
        this._pelvisLocalDelta.multiplyMatrices(this._sectionLocalMatrix,this._sectionRestInverse);
      }
    }
    this._bodyInverse.copy(bodyMatrix).invert();
    this._pelvisRootDelta.copy(bodyMatrix).multiply(this._pelvisLocalDelta).multiply(this._bodyInverse);
    copyObjectMatrix(this.bones.get('neck'), catModel.anatomy?.neck?.group, bodyMatrix, this._temporaryMatrix);
    copyObjectMatrix(this.bones.get('head'), catModel.headRig, bodyMatrix, this._temporaryMatrix);
    copyObjectMatrix(this.bones.get('frontLeft.scapula'),catModel.anatomy?.scapulaLeft?.group,bodyMatrix,this._temporaryMatrix);
    copyObjectMatrix(this.bones.get('frontRight.scapula'),catModel.anatomy?.scapulaRight?.group,bodyMatrix,this._temporaryMatrix);

    const limbMap = {
      frontLeft: 'frontLeft',
      frontRight: 'frontRight',
      hindLeft: 'hindLeft',
      hindRight: 'hindRight',
    };
    for (const [sourceName, targetPrefix] of Object.entries(limbMap)) {
      const limb = catModel.limbs?.[sourceName];
      if (!limb) continue;
      copyObjectMatrix(this.bones.get(`${targetPrefix}.upper`), limb.upper?.group);
      copyObjectMatrix(this.bones.get(`${targetPrefix}.lower`), limb.lower?.group);
      copyObjectMatrix(this.bones.get(`${targetPrefix}.metapodial`), limb.metapodial?.group);
      copyObjectMatrix(this.bones.get(`${targetPrefix}.paw`), limb.paw?.group);
    }
    for (let index = 0; index < TAIL_LANDMARKS.length; index += 1) {
      copyObjectMatrix(this.bones.get(`tail.${index}`), catModel.tail?.[index]?.part?.group,this._pelvisRootDelta,this._temporaryMatrix);
    }
    this.mesh.updateMatrixWorld(true);
    this.skeleton.update();
    return true;
  }

  /**
   * Convenience integration that can be removed without touching CatModel.
   * Pinnae, eyelids, eyes, nose, whiskers and pads remain live legacy details;
   * only the visibly segmented skin pieces are hidden.
   */
  attachToCatModel(catModel, { hideLegacySkin = true, registerPettable = true } = {}) {
    if (!catModel?.root) throw new TypeError('attachToCatModel requires a CatModel instance');
    if (this._catModel && this._catModel !== catModel) this.detachFromCatModel();
    this._catModel = catModel;
    catModel.continuousSkin = this;
    catModel.root.add(this.mesh);
    if (hideLegacySkin) this.setLegacySkinHidden(true, catModel);
    if (registerPettable && Array.isArray(catModel.pettable) && !catModel.pettable.includes(this.mesh)) catModel.pettable.push(this.mesh);
    this.updateFromCatModel(catModel);
    return this;
  }

  /** Reapply after a CatModel diagnostic/fur toggle, which may change visibility. */
  setLegacySkinHidden(hidden = true, catModel = this._catModel) {
    if (!catModel) return false;
    if (!hidden) {
      for (const [object, visible] of this._hiddenLegacy) object.visible = visible;
      this._hiddenLegacy.clear();
      return true;
    }
    const retained = /pinna|eyelid|orbital/i;
    for (const part of catModel.partRecords ?? []) {
      if (retained.test(part.name ?? '')) continue;
      for (const object of [part.base, ...(part.shellMeshes ?? [])]) {
        if (!object) continue;
        if (!this._hiddenLegacy.has(object)) this._hiddenLegacy.set(object, object.visible);
        object.visible = false;
      }
    }
    if (catModel.guardHairs) {
      if (!this._hiddenLegacy.has(catModel.guardHairs)) this._hiddenLegacy.set(catModel.guardHairs, catModel.guardHairs.visible);
      catModel.guardHairs.visible = false;
    }
    for(const limb of Object.values(catModel.limbs ?? {})) {
      const pads=limb.paw?.pads;
      if(!pads) continue;
      if(!this._hiddenLegacy.has(pads)) this._hiddenLegacy.set(pads,pads.visible);
      pads.visible=false;
    }
    return true;
  }

  detachFromCatModel() {
    const catModel = this._catModel;
    if (catModel?.pettable) {
      const index = catModel.pettable.indexOf(this.mesh);
      if (index >= 0) catModel.pettable.splice(index, 1);
    }
    this.setLegacySkinHidden(false, catModel);
    this.mesh.removeFromParent();
    if (catModel?.continuousSkin === this) delete catModel.continuousSkin;
    this._catModel = null;
  }

  setVisible(visible) {
    this.mesh.visible = Boolean(visible);
  }

  dispose() {
    this.detachFromCatModel();
    this.geometry.dispose();
    this.skeleton.dispose();
    if (this.ownsMaterial) this.material.dispose?.();
    this.bones.clear();
    this.restMatrices.clear();
  }
}

export function createContinuousCatSkin(options = {}) {
  return new ContinuousCatSkin(options);
}

export const CAT_SKIN_LANDMARKS = Object.freeze({
  torsoRings: TORSO_RINGS,
  skullRings: SKULL_RINGS,
  forelimbs: FORE_LANDMARKS,
  hindlimbs: HIND_LANDMARKS,
  tail: TAIL_LANDMARKS,
});

export default createContinuousCatSkin;
