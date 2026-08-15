import * as THREE from 'three';
import {
  TAU, clamp, damp, dampAngle, lerp, saturate, shortestAngle,
  smoothstep, smootherstep,
} from '../core/math.js';
import { NavigationSystem } from './navigation.js';

const UP = new THREE.Vector3(0, 1, 0);
const EPSILON = 1e-5;
const FOOT_ORDER = ['frontLeft', 'frontRight', 'hindLeft', 'hindRight'];
const FOOT_LAYOUT = {
  frontLeft: { side: -1, end: 'front', longitudinal: .175, walkOffset: .75 },
  frontRight: { side: 1, end: 'front', longitudinal: .175, walkOffset: .25 },
  hindLeft: { side: -1, end: 'hind', longitudinal: -.108, walkOffset: .5 },
  hindRight: { side: 1, end: 'hind', longitudinal: -.108, walkOffset: 0 },
};

const GAIT_SPEED = {
  idle: 0,
  slowWalk: .23,
  walk: .62,
  fastWalk: .94,
  trot: 1.48,
  run: 2.55,
  sprint: 4.15,
  stalk: .28,
  crouch: .52,
};

const GAIT_FREQUENCY = {
  idle: 0,
  slowWalk: .78,
  walk: 1.16,
  fastWalk: 1.52,
  trot: 1.95,
  run: 2.42,
  sprint: 2.95,
  stalk: .68,
  crouch: .9,
};

const GAIT_DUTY = {
  idle: .82,
  slowWalk: .76,
  walk: .7,
  fastWalk: .63,
  trot: .52,
  run: .42,
  sprint: .35,
  stalk: .79,
  crouch: .76,
};

const TROT_OFFSETS = {
  hindRight: 0,
  frontLeft: 0,
  frontRight: .5,
  hindLeft: .5,
};

const RUN_OFFSETS = {
  hindRight: 0,
  hindLeft: .14,
  frontRight: .52,
  frontLeft: .66,
};

const SPRINT_OFFSETS = {
  hindRight: 0,
  hindLeft: .06,
  frontRight: .5,
  frontLeft: .56,
};

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function vector3(value, fallback = null) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) {
    return new THREE.Vector3(
      finite(Number(value[0]), 0),
      finite(Number(value[1]), 0),
      finite(Number(value[2]), 0),
    );
  }
  if (value && Number.isFinite(value.x) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, finite(value.y, 0), value.z);
  }
  return fallback?.isVector3 ? fallback.clone() : new THREE.Vector3();
}

function wrap01(value) {
  value %= 1;
  return value < 0 ? value + 1 : value;
}

function cyclicDelta(from, to) {
  let delta = wrap01(to) - wrap01(from);
  if (delta > .5) delta -= 1;
  if (delta < -.5) delta += 1;
  return delta;
}

function moveToward(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function forwardAt(heading, target = new THREE.Vector3()) {
  return target.set(Math.sin(heading), 0, Math.cos(heading));
}

function rightAt(heading, target = new THREE.Vector3()) {
  return target.set(Math.cos(heading), 0, -Math.sin(heading));
}

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function horizontalDirection(from, to, target = new THREE.Vector3()) {
  target.set(to.x - from.x, 0, to.z - from.z);
  const length = target.length();
  return length > EPSILON ? target.multiplyScalar(1 / length) : target.set(0, 0, 0);
}

function dampVector(current, target, lambda, dt) {
  return current.lerp(target, 1 - Math.exp(-lambda * dt));
}

function gaitForSpeed(speed, style) {
  if (speed < .035) return 'idle';
  if (style === 'stalk') return 'stalk';
  if (style === 'crouch') return 'crouch';
  if (speed < .36) return 'slowWalk';
  if (speed < .78) return 'walk';
  if (speed < 1.08) return 'fastWalk';
  if (speed < 1.9) return 'trot';
  if (speed < 3.25) return 'run';
  return 'sprint';
}

/**
 * Phase-continuous, terrain-aware domestic-cat locomotion controller.
 * Position is the ground/root projection; paw positions are world-space.
 */
export class ProceduralLocomotion {
  constructor(environment = {}, start = {}) {
    this.environment = environment ?? {};
    this.navigation = new NavigationSystem(this.environment);

    const startPosition = start?.isVector3 || Array.isArray(start)
      ? vector3(start)
      : vector3(start?.position ?? start);
    const surface = this.navigation.sampleSurface(startPosition);
    this.position = surface.position.clone();
    this.heading = finite(start?.heading, 0);
    this.velocity = vector3(start?.velocity);
    this.velocity.y = 0;
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    this._groundSpeed = this.speed;
    this._yawRate = 0;

    this.bodyScale = clamp(finite(start?.bodyScale, 1), .65, 1.5);
    this.neutralBodyHeight = finite(start?.bodyHeight, .19 * this.bodyScale);
    this.bodyHeight = this.neutralBodyHeight;
    this.shoulderHeight = this.bodyHeight;
    this.pelvisHeight = this.bodyHeight;
    this.bodyPitch = 0;
    this.crouch = 0;
    this.spineBend = 0;
    this.spineFlex = 0;
    this.bank = 0;
    this.headPitch = 0;
    this.tailBalance = 0;
    this.narrowness = 0;

    this.gait = 'idle';
    this.gaitPhase = wrap01(finite(start?.gaitPhase, 0));
    this._dutyFactor = GAIT_DUTY.idle;
    this._cycleFrequency = 0;

    this.target = null;
    this.targetOptions = {};
    this.path = [];
    this._pathIndex = 0;
    this._repathTimer = 0;
    this._arrived = false;

    this.jumpPhase = 'none';
    this._jump = null;
    this._landingHold = 0;

    this.feet = {};
    for (const key of FOOT_ORDER) {
      const layout = FOOT_LAYOUT[key];
      this.feet[key] = {
        key,
        layout,
        position: new THREE.Vector3(),
        normal: UP.clone(),
        plantWeight: 1,
        swing: 0,
        phaseOffset: layout.walkOffset,
        phase: 0,
        wasSwing: false,
        lockedPosition: new THREE.Vector3(),
        lockedNormal: UP.clone(),
        swingStart: new THREE.Vector3(),
        swingStartNormal: UP.clone(),
        landingTarget: new THREE.Vector3(),
        landingNormal: UP.clone(),
        liftHeight: .03,
        transitionStart: new THREE.Vector3(),
      };
    }
    this._placeInitialFeet();
  }

  _placeInitialFeet() {
    for (const key of FOOT_ORDER) {
      const foot = this.feet[key];
      const position = this._nominalFootPosition(foot.layout, this.position, this.heading, 0);
      const surface = this.navigation.sampleSurface(position);
      foot.position.copy(surface.position);
      foot.normal.copy(surface.normal);
      foot.lockedPosition.copy(surface.position);
      foot.lockedNormal.copy(surface.normal);
      foot.swingStart.copy(surface.position);
      foot.landingTarget.copy(surface.position);
      foot.landingNormal.copy(surface.normal);
    }
  }

  setTarget(position, options = {}) {
    const requested = vector3(position?.position ?? position);
    const surface = this.navigation.sampleSurface(requested);
    this.target = options.preserveTargetHeight ? requested : surface.position;
    this.targetOptions = { ...options };
    this._arrived = false;
    this._repath(true);
    return this.getPath();
  }

  clearTarget() {
    this.target = null;
    this.targetOptions = {};
    this.path = [];
    this._pathIndex = 0;
    this._arrived = false;
  }

  _repath(immediate = false) {
    if (!this.target || this.jumpPhase !== 'none') return;
    if (!immediate && this._repathTimer > 0) return;
    const navigationOptions = {
      radius: finite(this.targetOptions.radius, .17 * this.bodyScale),
      cellSize: finite(this.targetOptions.cellSize, .3 * this.bodyScale),
      maxStep: finite(this.targetOptions.maxStep, .24 * this.bodyScale),
      maxSlope: finite(this.targetOptions.maxSlope, Math.PI * .235),
      ...(this.targetOptions.navigation ?? {}),
    };
    this.path = this.navigation.findPath(this.position, this.target, navigationOptions);
    this._pathIndex = this.path.length > 1 ? 1 : 0;
    this._repathTimer = finite(this.targetOptions.repathInterval, .68);
  }

  launchJump(target) {
    if (!target || this.jumpPhase !== 'none') return false;
    const options = target?.position ? target : {};
    const requested = vector3(target?.position ?? target);
    const landing = options.preserveTargetHeight
      ? requested
      : this.navigation.sampleSurface(requested).position;
    const distance = horizontalDistance(this.position, landing);
    if (distance < .06 || distance > finite(options.maxDistance, 5.2 * this.bodyScale)) return false;

    this.clearTarget();
    const direction = horizontalDirection(this.position, landing);
    const heading = direction.lengthSq() > EPSILON ? Math.atan2(direction.x, direction.z) : this.heading;
    this._jump = {
      target: landing.clone(),
      requestedTarget: requested.clone(),
      heading,
      options: { ...options },
      phaseTime: 0,
      airborneTime: 0,
      duration: 0,
      gravity: finite(options.gravity, 9.81),
      start: this.position.clone(),
      launchVelocity: new THREE.Vector3(),
      impactVelocity: new THREE.Vector3(),
    };
    this.jumpPhase = 'anticipation';
    this._groundSpeed = Math.min(this._groundSpeed, 1.1);
    return true;
  }

  update(dt, context = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return this.getMotionState();
    const total = Math.min(dt, .2);
    const steps = Math.max(1, Math.ceil(total / .025));
    const step = total / steps;
    for (let i = 0; i < steps; i++) this._step(step, context ?? {});
    return this.getMotionState();
  }

  _step(dt, context) {
    if (this.jumpPhase === 'none') this._updateGroundMotion(dt, context);
    else this._updateJump(dt, context);

    this._updateGaitOscillator(dt, context);
    this._updateNarrowness(dt, context);
    if (this.jumpPhase === 'none') this._updateFeet(dt, context);
    else this._updateJumpFeet(dt);
    this._updateBody(dt, context);
  }

  _updateGroundMotion(dt, context) {
    this._repathTimer -= dt;
    if (this.target && this._repathTimer <= 0) this._repath();

    let desiredDirection = forwardAt(this.heading);
    let requestedSpeed = 0;
    let distanceToTarget = Infinity;
    let curvature = 0;

    if (this.target) {
      this._advancePathCursor();
      distanceToTarget = this._remainingPathDistance();
      const lookAheadDistance = clamp(.32 + this._groundSpeed * .42, .32, 1.45);
      const aim = this._pathLookAhead(lookAheadDistance);
      desiredDirection = horizontalDirection(this.position, aim);
      if (desiredDirection.lengthSq() < EPSILON) desiredDirection = forwardAt(this.heading);
      curvature = this._pathCurvature(lookAheadDistance);

      const gaitRequest = this.targetOptions.gait;
      const urgency = saturate(finite(this.targetOptions.urgency, .42));
      requestedSpeed = finite(
        this.targetOptions.speed,
        finite(this.targetOptions.targetSpeed,
          gaitRequest && GAIT_SPEED[gaitRequest] != null
            ? GAIT_SPEED[gaitRequest]
            : lerp(.68, 3.2, urgency)),
      );
      requestedSpeed = Math.min(requestedSpeed, finite(this.targetOptions.maxSpeed, 4.8));
      const stopDistance = Math.max(.03, finite(this.targetOptions.stoppingDistance, .18));
      const brakingDistance = Math.max(0, distanceToTarget - stopDistance);
      const deceleration = finite(this.targetOptions.deceleration, 3.4);
      requestedSpeed = Math.min(requestedSpeed, Math.sqrt(2 * deceleration * brakingDistance));
      requestedSpeed *= lerp(1, .42, curvature);
    } else if (context.desiredVelocity) {
      const desiredVelocity = vector3(context.desiredVelocity);
      requestedSpeed = Math.hypot(desiredVelocity.x, desiredVelocity.z);
      desiredDirection = horizontalDirection(new THREE.Vector3(), desiredVelocity);
    } else if (context.desiredDirection || Number.isFinite(context.desiredHeading)) {
      desiredDirection = context.desiredDirection
        ? horizontalDirection(new THREE.Vector3(), vector3(context.desiredDirection))
        : forwardAt(context.desiredHeading);
      requestedSpeed = finite(context.desiredSpeed, GAIT_SPEED.walk);
    }

    const style = this._movementStyle(context);
    if (style === 'stalk') requestedSpeed = Math.min(requestedSpeed, finite(context.stalkSpeed, .48));
    if (style === 'crouch') requestedSpeed = Math.min(requestedSpeed, finite(context.crouchSpeed, .82));
    requestedSpeed *= lerp(1, .56, this.narrowness);

    const avoidance = this._localAvoidance(desiredDirection, requestedSpeed);
    desiredDirection = avoidance.direction;
    if (avoidance.blocked) requestedSpeed *= avoidance.allBlocked ? 0 : .48;

    if (desiredDirection.lengthSq() > EPSILON) {
      const desiredHeading = Math.atan2(desiredDirection.x, desiredDirection.z);
      const headingError = shortestAngle(this.heading, desiredHeading);
      const maxTurnRate = lerp(3.5, 1.15, saturate(this._groundSpeed / 4.2));
      const anticipatedRate = clamp(headingError / Math.max(dt, .08), -maxTurnRate, maxTurnRate);
      this._yawRate = damp(this._yawRate, anticipatedRate, 8.5, dt);
      this.heading = dampAngle(this.heading, this.heading + this._yawRate * dt, 30, dt);
      const turnSeverity = saturate(Math.abs(this._yawRate) * Math.max(.15, this._groundSpeed) / 4.2);
      requestedSpeed *= lerp(1, .56, turnSeverity);
    } else {
      this._yawRate = damp(this._yawRate, 0, 7, dt);
    }

    const acceleration = finite(this.targetOptions.acceleration,
      this._groundSpeed > 1.2 ? 3.5 : 2.25);
    const deceleration = finite(this.targetOptions.deceleration, 3.8);
    this._groundSpeed = moveToward(
      this._groundSpeed,
      Math.max(0, requestedSpeed),
      (requestedSpeed >= this._groundSpeed ? acceleration : deceleration) * dt,
    );

    const forward = forwardAt(this.heading);
    const desiredVelocity = forward.multiplyScalar(this._groundSpeed);
    this.velocity.x = desiredVelocity.x;
    this.velocity.y = 0;
    this.velocity.z = desiredVelocity.z;

    const proposed = this.position.clone().addScaledVector(this.velocity, dt);
    const moveOptions = {
      radius: .16 * this.bodyScale,
      maxStep: .25 * this.bodyScale,
      maxSlope: Math.PI * .25,
      from: this.position,
    };
    if (!this.navigation.isBlocked(proposed, moveOptions.radius, moveOptions)) {
      const sampled = this.navigation.sampleSurface(proposed);
      this.position.set(proposed.x, sampled.height, proposed.z);
    } else {
      const slideX = new THREE.Vector3(proposed.x, this.position.y, this.position.z);
      const slideZ = new THREE.Vector3(this.position.x, this.position.y, proposed.z);
      if (!this.navigation.isBlocked(slideX, moveOptions.radius, moveOptions)) {
        const sampled = this.navigation.sampleSurface(slideX);
        this.position.set(slideX.x, sampled.height, slideX.z);
        this.velocity.z = 0;
      } else if (!this.navigation.isBlocked(slideZ, moveOptions.radius, moveOptions)) {
        const sampled = this.navigation.sampleSurface(slideZ);
        this.position.set(slideZ.x, sampled.height, slideZ.z);
        this.velocity.x = 0;
      } else {
        this._groundSpeed *= .25;
        this.velocity.multiplyScalar(.25);
      }
      this._repathTimer = 0;
    }

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.target) {
      const stoppingDistance = Math.max(.03, finite(this.targetOptions.stoppingDistance, .18));
      if (distanceToTarget <= stoppingDistance && this.speed < .09) {
        this._arrived = true;
        if (this.targetOptions.clearOnArrival !== false) this.clearTarget();
      }
    }
  }

  _movementStyle(context) {
    if (context.stalk || this.targetOptions.stalk || context.gait === 'stalk' ||
        this.targetOptions.gait === 'stalk') return 'stalk';
    if (context.crouch === true || this.targetOptions.crouch === true ||
        context.gait === 'crouch' || this.targetOptions.gait === 'crouch') return 'crouch';
    return null;
  }

  _advancePathCursor() {
    if (!this.path.length) return;
    while (this._pathIndex < this.path.length - 1 &&
        horizontalDistance(this.position, this.path[this._pathIndex]) < .2 + this._groundSpeed * .08) {
      this._pathIndex++;
    }
  }

  _pathLookAhead(distance) {
    if (!this.path.length) return this.target?.clone() ?? this.position.clone();
    let cursor = this.position.clone();
    let remaining = Math.max(0, distance);
    for (let i = this._pathIndex; i < this.path.length; i++) {
      const point = this.path[i];
      const segment = horizontalDistance(cursor, point);
      if (segment >= remaining && segment > EPSILON) {
        const t = remaining / segment;
        return cursor.clone().lerp(point, t);
      }
      remaining -= segment;
      cursor = point;
    }
    return this.path.at(-1).clone();
  }

  _remainingPathDistance() {
    if (!this.path.length) return this.target ? horizontalDistance(this.position, this.target) : 0;
    let distance = horizontalDistance(this.position, this.path[this._pathIndex]);
    for (let i = this._pathIndex; i < this.path.length - 1; i++) {
      distance += horizontalDistance(this.path[i], this.path[i + 1]);
    }
    return distance;
  }

  _pathCurvature(lookAheadDistance) {
    if (!this.path.length || this._pathIndex >= this.path.length) return 0;
    const near = this.path[this._pathIndex];
    const far = this._pathLookAhead(lookAheadDistance * 1.75);
    const nearDirection = horizontalDirection(this.position, near);
    const farDirection = horizontalDirection(this.position, far);
    if (nearDirection.lengthSq() < EPSILON || farDirection.lengthSq() < EPSILON) return 0;
    const angle = Math.acos(clamp(nearDirection.dot(farDirection), -1, 1));
    return saturate(angle / (Math.PI * .62));
  }

  _localAvoidance(desiredDirection, requestedSpeed) {
    const base = desiredDirection.lengthSq() > EPSILON
      ? desiredDirection.clone().normalize()
      : forwardAt(this.heading);
    const baseHeading = Math.atan2(base.x, base.z);
    const probeDistance = clamp(.32 + requestedSpeed * .22, .32, 1.15);
    const angles = [0, .32, -.32, .65, -.65, 1.02, -1.02];
    let best = null;
    let frontBlocked = false;
    let openCount = 0;
    for (const angle of angles) {
      const direction = forwardAt(baseHeading + angle);
      const probe = this.position.clone().addScaledVector(direction, probeDistance);
      const blocked = this.navigation.isBlocked(probe, .17 * this.bodyScale, {
        maxStep: .25 * this.bodyScale,
        maxSlope: Math.PI * .25,
        from: this.position,
      });
      if (angle === 0) frontBlocked = blocked;
      if (!blocked) openCount++;
      const alignment = direction.dot(base);
      const targetBias = angle === 0 ? .08 : 0;
      const score = alignment + targetBias - (blocked ? 4 : 0) - Math.abs(angle) * .08;
      if (!best || score > best.score) best = { direction, score, blocked };
    }
    return {
      direction: best?.direction ?? base,
      blocked: frontBlocked,
      allBlocked: openCount === 0,
    };
  }

  _updateGaitOscillator(dt, context) {
    const style = this._movementStyle(context);
    this.gait = gaitForSpeed(this.speed, style);
    const targetFrequency = GAIT_FREQUENCY[this.gait];
    this._cycleFrequency = damp(this._cycleFrequency, targetFrequency, 5.5, dt);
    if (this.jumpPhase !== 'none') this._cycleFrequency = Math.max(this._cycleFrequency, .55);
    this.gaitPhase = wrap01(this.gaitPhase + this._cycleFrequency * dt);

    const dutyTarget = clamp(GAIT_DUTY[this.gait] + this.narrowness * .075, .34, .84);
    this._dutyFactor = damp(this._dutyFactor, dutyTarget, 5.2, dt);
    const offsets = this.gait === 'trot' ? TROT_OFFSETS
      : this.gait === 'run' ? RUN_OFFSETS
        : this.gait === 'sprint' ? SPRINT_OFFSETS : null;
    const offsetRate = 1 - Math.exp(-2.2 * dt);
    for (const key of FOOT_ORDER) {
      const foot = this.feet[key];
      const target = offsets?.[key] ?? foot.layout.walkOffset;
      foot.phaseOffset = wrap01(foot.phaseOffset + cyclicDelta(foot.phaseOffset, target) * offsetRate);
    }
  }

  _updateNarrowness(dt, context) {
    const surface = this.navigation.sampleSurface(this.position);
    let target = saturate(finite(context.narrowness, finite(surface.narrowness, 0)));
    if (context.narrowSurface === true) target = Math.max(target, .85);
    if (Number.isFinite(context.surfaceWidth)) {
      target = Math.max(target, 1 - saturate((context.surfaceWidth - .08) / .52));
    }

    const right = rightAt(this.heading);
    const probeDistance = .24 * this.bodyScale;
    let blockedSides = 0;
    for (const sign of [-1, 1]) {
      const probe = this.position.clone().addScaledVector(right, probeDistance * sign);
      if (this.navigation.isBlocked(probe, .035, {
        maxStep: .2 * this.bodyScale,
        maxSlope: Math.PI * .26,
        from: this.position,
      })) blockedSides++;
    }
    if (blockedSides === 1) target = Math.max(target, .38);
    if (blockedSides === 2) target = Math.max(target, .82);
    this.narrowness = damp(this.narrowness, target, target > this.narrowness ? 7 : 2.4, dt);
  }

  _nominalFootPosition(layout, bodyPosition, heading, narrowness = this.narrowness) {
    const forward = forwardAt(heading);
    const right = rightAt(heading);
    const normalHalfWidth = (layout.end === 'front' ? .045 : .043) * this.bodyScale;
    const halfWidth = lerp(normalHalfWidth, .017 * this.bodyScale, saturate(narrowness));
    return bodyPosition.clone()
      .addScaledVector(forward, layout.longitudinal * this.bodyScale)
      .addScaledVector(right, layout.side * halfWidth);
  }

  _targetOffsetsForFoot(foot, swingProgress) {
    const remainingSwing = (1 - swingProgress) * (1 - this._dutyFactor) /
      Math.max(this._cycleFrequency, .2);
    const stanceLead = this._dutyFactor / Math.max(this._cycleFrequency, .2) * .42;
    const predictionTime = remainingSwing + stanceLead;
    const predictedBody = this.position.clone().addScaledVector(this.velocity, predictionTime);
    const predictedHeading = this.heading + this._yawRate * predictionTime * .72;
    const target = this._nominalFootPosition(foot.layout, predictedBody, predictedHeading);

    const forward = forwardAt(predictedHeading);
    const right = rightAt(predictedHeading);
    const candidates = [
      [0, 0], [0, -.055], [0, .055], [-.065, 0], [.065, 0],
      [-.06, -.055], [-.06, .055],
    ];
    let best = null;
    for (const [fore, side] of candidates) {
      const candidate = target.clone().addScaledVector(forward, fore * this.bodyScale)
        .addScaledVector(right, side * this.bodyScale);
      const sampled = this.navigation.sampleSurface(candidate);
      const blocked = this.navigation.isBlocked(sampled.position, .025 * this.bodyScale, {
        maxStep: .32 * this.bodyScale,
        maxSlope: Math.PI * .3,
        from: this.position,
      });
      if (blocked) continue;
      const score = Math.abs(fore) + Math.abs(side) * .75 + Math.abs(sampled.height - this.position.y) * .35;
      if (!best || score < best.score) best = { position: sampled.position, normal: sampled.normal, score };
    }
    const fallback = this.navigation.sampleSurface(target);
    return best ?? { position: fallback.position, normal: fallback.normal, score: Infinity };
  }

  _swingLift(start, target, context) {
    let required = 0;
    const samples = 7;
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const point = start.clone().lerp(target, t);
      const baseline = lerp(start.y, target.y, t);
      const surface = this.navigation.sampleSurface(point);
      required = Math.max(required, surface.height - baseline);
      const top = this.navigation.obstacleTopAt(point, undefined, .025 * this.bodyScale);
      if (Number.isFinite(top) && top - baseline < .34 * this.bodyScale) {
        required = Math.max(required, top - baseline);
      }
    }
    const speedLift = lerp(.028, .046, saturate(this.speed / 3.2));
    const narrowLift = this.narrowness * .025;
    const explicit = finite(context.footClearance, 0);
    return clamp((speedLift + narrowLift + Math.max(0, required) + explicit) * this.bodyScale, .024, .18);
  }

  _updateFeet(dt, context) {
    if (this._landingHold > 0) this._landingHold = Math.max(0, this._landingHold - dt);
    const forcePlant = this.gait === 'idle' || this._landingHold > 0;
    for (const key of FOOT_ORDER) {
      const foot = this.feet[key];
      const phase = wrap01(this.gaitPhase - foot.phaseOffset);
      foot.phase = phase;
      const isSwing = !forcePlant && phase >= this._dutyFactor;

      if (isSwing) {
        const swingProgress = saturate((phase - this._dutyFactor) / Math.max(EPSILON, 1 - this._dutyFactor));
        if (!foot.wasSwing) {
          foot.swingStart.copy(foot.position);
          foot.swingStartNormal.copy(foot.normal);
          const landing = this._targetOffsetsForFoot(foot, swingProgress);
          foot.landingTarget.copy(landing.position);
          foot.landingNormal.copy(landing.normal);
          foot.liftHeight = this._swingLift(foot.swingStart, foot.landingTarget, context);
        } else if (swingProgress < .62) {
          const landing = this._targetOffsetsForFoot(foot, swingProgress);
          dampVector(foot.landingTarget, landing.position, 10, dt);
          dampVector(foot.landingNormal, landing.normal, 10, dt).normalize();
          foot.liftHeight = Math.max(
            foot.liftHeight,
            this._swingLift(foot.swingStart, foot.landingTarget, context),
          );
        }
        const travel = smootherstep(0, 1, swingProgress);
        foot.position.lerpVectors(foot.swingStart, foot.landingTarget, travel);
        foot.position.y += Math.sin(Math.PI * swingProgress) * foot.liftHeight;
        foot.normal.lerpVectors(foot.swingStartNormal, foot.landingNormal, smoothstep(.25, .92, swingProgress));
        if (foot.normal.lengthSq() < EPSILON) foot.normal.copy(UP);
        else foot.normal.normalize();
        foot.plantWeight = 0;
        foot.swing = swingProgress;
      } else {
        if (foot.wasSwing) {
          const sampled = this.navigation.sampleSurface(foot.landingTarget);
          foot.lockedPosition.copy(sampled.position);
          foot.lockedNormal.copy(sampled.normal);
        }
        // distanceToSquared is in m^2. The previous .2 threshold allowed an
        // adult cat's planted foot to remain almost 45 cm from neutral.
        if (forcePlant && foot.lockedPosition.distanceToSquared(foot.position) > .0064 * this.bodyScale * this.bodyScale) {
          const nominal = this._nominalFootPosition(foot.layout, this.position, this.heading);
          const sampled = this.navigation.sampleSurface(nominal);
          foot.lockedPosition.copy(sampled.position);
          foot.lockedNormal.copy(sampled.normal);
        }
        foot.position.copy(foot.lockedPosition);
        foot.normal.copy(foot.lockedNormal);
        const stanceProgress = phase / Math.max(this._dutyFactor, EPSILON);
        const load = smoothstep(0, .09, stanceProgress) *
          (1 - smoothstep(.84, 1, stanceProgress));
        foot.plantWeight = forcePlant ? 1 : saturate(load);
        foot.swing = 0;
      }
      foot.wasSwing = isSwing;
    }
  }

  _computeBallisticLaunch() {
    const jump = this._jump;
    jump.start.copy(this.position);
    const delta = jump.target.clone().sub(jump.start);
    const horizontal = Math.hypot(delta.x, delta.z);
    const heightDifference = delta.y;
    const requestedApex = finite(jump.options.apexHeight,
      .3 * this.bodyScale + horizontal * .115 + Math.max(0, heightDifference));
    const apex = Math.max(heightDifference + .12 * this.bodyScale, requestedApex);
    const verticalSpeed = Math.sqrt(Math.max(.01, 2 * jump.gravity * apex));
    const discriminant = Math.max(0, verticalSpeed * verticalSpeed - 2 * jump.gravity * heightDifference);
    jump.duration = clamp(
      (verticalSpeed + Math.sqrt(discriminant)) / jump.gravity,
      .28,
      finite(jump.options.maxFlightTime, 1.15),
    );
    jump.launchVelocity.set(
      delta.x / jump.duration,
      verticalSpeed,
      delta.z / jump.duration,
    );
    jump.airborneTime = 0;
  }

  _enterJumpPhase(phase) {
    this.jumpPhase = phase;
    if (!this._jump) return;
    this._jump.phaseTime = 0;
    for (const key of FOOT_ORDER) this.feet[key].transitionStart.copy(this.feet[key].position);
  }

  _updateJump(dt) {
    const jump = this._jump;
    if (!jump) {
      this.jumpPhase = 'none';
      return;
    }
    jump.phaseTime += dt;
    const anticipationDuration = finite(jump.options.anticipationDuration, .19);
    const driveDuration = finite(jump.options.driveDuration, .15);

    if (this.jumpPhase === 'anticipation') {
      this.heading = dampAngle(this.heading, jump.heading, 10, dt);
      this._groundSpeed = damp(this._groundSpeed, 0, 12, dt);
      this.velocity.multiplyScalar(Math.exp(-12 * dt));
      this.speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (jump.phaseTime >= anticipationDuration) this._enterJumpPhase('drive');
      return;
    }

    if (this.jumpPhase === 'drive') {
      this.heading = dampAngle(this.heading, jump.heading, 14, dt);
      this.velocity.set(0, 0, 0);
      this.speed = 0;
      if (jump.phaseTime >= driveDuration) {
        this._computeBallisticLaunch();
        this._enterJumpPhase('airborne');
      }
      return;
    }

    if (this.jumpPhase === 'airborne') {
      jump.airborneTime = Math.min(jump.duration, jump.airborneTime + dt);
      const t = jump.airborneTime;
      this.position.copy(jump.start).addScaledVector(jump.launchVelocity, t);
      this.position.y -= .5 * jump.gravity * t * t;
      this.velocity.copy(jump.launchVelocity);
      this.velocity.y -= jump.gravity * t;
      this.speed = Math.hypot(this.velocity.x, this.velocity.z);
      this.heading = dampAngle(this.heading, jump.heading, 5, dt);
      if (t >= jump.duration - EPSILON) {
        jump.impactVelocity.copy(this.velocity);
        this.position.copy(jump.target);
        this._groundSpeed = Math.hypot(this.velocity.x, this.velocity.z) * .34;
        this._enterJumpPhase('front-contact');
      }
      return;
    }

    if (this.jumpPhase === 'front-contact') {
      this.position.copy(jump.target);
      this.velocity.multiplyScalar(Math.exp(-8 * dt));
      this.speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (jump.phaseTime >= finite(jump.options.frontContactDuration, .085)) {
        this._enterJumpPhase('compression');
      }
      return;
    }

    if (this.jumpPhase === 'compression') {
      this.position.copy(jump.target);
      this.velocity.multiplyScalar(Math.exp(-10 * dt));
      this.speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (jump.phaseTime >= finite(jump.options.compressionDuration, .19)) {
        this._enterJumpPhase('recovery');
      }
      return;
    }

    if (this.jumpPhase === 'recovery') {
      this.position.copy(jump.target);
      const recoveryDuration = finite(jump.options.recoveryDuration, .3);
      this.velocity.x = forwardAt(this.heading).x * this._groundSpeed;
      this.velocity.y = 0;
      this.velocity.z = forwardAt(this.heading).z * this._groundSpeed;
      this.speed = this._groundSpeed;
      if (jump.phaseTime >= recoveryDuration) {
        for (const key of FOOT_ORDER) {
          const foot = this.feet[key];
          foot.lockedPosition.copy(foot.position);
          foot.lockedNormal.copy(foot.normal);
          foot.wasSwing = false;
        }
        this.jumpPhase = 'none';
        this._jump = null;
        this._landingHold = .16;
      }
    }
  }

  _jumpLandingFoot(foot) {
    const jump = this._jump;
    const position = this._nominalFootPosition(foot.layout, jump.target, jump.heading, this.narrowness);
    return this.navigation.sampleSurface(position);
  }

  _updateJumpFeet() {
    const jump = this._jump;
    if (!jump) return;
    const phaseTime = jump.phaseTime;

    if (this.jumpPhase === 'anticipation' || this.jumpPhase === 'drive') {
      for (const key of FOOT_ORDER) {
        const foot = this.feet[key];
        foot.position.copy(foot.lockedPosition);
        foot.normal.copy(foot.lockedNormal);
        foot.swing = 0;
        foot.plantWeight = this.jumpPhase === 'drive' && foot.layout.end === 'front' ? .35 : 1;
      }
      return;
    }

    if (this.jumpPhase === 'airborne') {
      const progress = saturate(jump.airborneTime / Math.max(jump.duration, EPSILON));
      const forward = forwardAt(this.heading);
      const right = rightAt(this.heading);
      for (const key of FOOT_ORDER) {
        const foot = this.feet[key];
        const front = foot.layout.end === 'front';
        const folded = this.position.clone()
          .addScaledVector(forward, foot.layout.longitudinal * .62 * this.bodyScale)
          .addScaledVector(right, foot.layout.side * .07 * this.bodyScale);
        folded.y += (front ? .19 : .15) * this.bodyScale;
        const landing = this._jumpLandingFoot(foot);
        const extension = front ? smoothstep(.62, .94, progress) : 0;
        foot.position.lerpVectors(folded, landing.position, extension);
        foot.normal.lerpVectors(UP, landing.normal, extension).normalize();
        foot.plantWeight = 0;
        foot.swing = progress;
      }
      return;
    }

    if (this.jumpPhase === 'front-contact') {
      const duration = finite(jump.options.frontContactDuration, .085);
      const progress = saturate(phaseTime / duration);
      for (const key of FOOT_ORDER) {
        const foot = this.feet[key];
        const landing = this._jumpLandingFoot(foot);
        if (foot.layout.end === 'front') {
          foot.position.lerpVectors(foot.transitionStart, landing.position, smootherstep(0, 1, progress));
          foot.normal.lerpVectors(UP, landing.normal, progress).normalize();
          foot.plantWeight = smoothstep(0, .45, progress);
          foot.swing = 0;
        } else {
          foot.position.copy(foot.transitionStart);
          foot.plantWeight = 0;
          foot.swing = 1;
        }
      }
      return;
    }

    if (this.jumpPhase === 'compression') {
      const duration = finite(jump.options.compressionDuration, .19);
      const progress = saturate(phaseTime / duration);
      for (const key of FOOT_ORDER) {
        const foot = this.feet[key];
        const landing = this._jumpLandingFoot(foot);
        if (foot.layout.end === 'hind') {
          const contact = smoothstep(.08, .68, progress);
          foot.position.lerpVectors(foot.transitionStart, landing.position, smootherstep(.05, .72, progress));
          foot.normal.lerpVectors(UP, landing.normal, contact).normalize();
          foot.plantWeight = contact;
          foot.swing = 1 - contact;
        } else {
          foot.position.copy(landing.position);
          foot.normal.copy(landing.normal);
          foot.plantWeight = 1;
          foot.swing = 0;
        }
      }
      return;
    }

    if (this.jumpPhase === 'recovery') {
      for (const key of FOOT_ORDER) {
        const foot = this.feet[key];
        const landing = this._jumpLandingFoot(foot);
        foot.position.copy(landing.position);
        foot.normal.copy(landing.normal);
        foot.plantWeight = 1;
        foot.swing = 0;
      }
    }
  }

  _supportHeight(keys) {
    let height = 0;
    let weight = 0;
    for (const key of keys) {
      const foot = this.feet[key];
      const influence = Math.max(0, foot.plantWeight);
      height += foot.position.y * influence;
      weight += influence;
    }
    return weight > EPSILON ? height / weight : this.position.y;
  }

  _updateBody(dt, context) {
    const style = this._movementStyle(context);
    let crouchTarget = style === 'stalk' ? .52 : style === 'crouch' ? .72 : 0;
    if (Number.isFinite(context.crouch)) crouchTarget = Math.max(crouchTarget, saturate(context.crouch));
    if (Number.isFinite(this.targetOptions.crouch)) {
      crouchTarget = Math.max(crouchTarget, saturate(this.targetOptions.crouch));
    }
    crouchTarget = Math.max(crouchTarget, this.narrowness * .14);

    let jumpFlex = 0;
    if (this._jump) {
      const jump = this._jump;
      if (this.jumpPhase === 'anticipation') {
        crouchTarget = Math.max(crouchTarget,
          .9 * smootherstep(0, finite(jump.options.anticipationDuration, .19), jump.phaseTime));
      } else if (this.jumpPhase === 'drive') {
        const progress = saturate(jump.phaseTime / finite(jump.options.driveDuration, .15));
        crouchTarget = lerp(.9, .04, smootherstep(0, 1, progress));
        jumpFlex = lerp(.12, -.12, progress);
      } else if (this.jumpPhase === 'airborne') {
        crouchTarget = .2;
        jumpFlex = -.08 + Math.sin(saturate(jump.airborneTime / jump.duration) * Math.PI) * .1;
      } else if (this.jumpPhase === 'front-contact') {
        crouchTarget = .42;
        jumpFlex = .1;
      } else if (this.jumpPhase === 'compression') {
        const progress = saturate(jump.phaseTime / finite(jump.options.compressionDuration, .19));
        crouchTarget = .58 + Math.sin(progress * Math.PI) * .28;
        jumpFlex = .15 * Math.sin(progress * Math.PI);
      } else if (this.jumpPhase === 'recovery') {
        const progress = saturate(jump.phaseTime / finite(jump.options.recoveryDuration, .3));
        crouchTarget = lerp(.5, 0, smootherstep(0, 1, progress));
      }
    }
    this.crouch = damp(this.crouch, saturate(crouchTarget), 9, dt);

    const surface = this.navigation.sampleSurface(this.position);
    const frontHeight = this._supportHeight(['frontLeft', 'frontRight']);
    const hindHeight = this._supportHeight(['hindLeft', 'hindRight']);
    const supportHeight = (frontHeight + hindHeight) * .5;
    const supportCompensation = this.jumpPhase === 'airborne'
      ? 0
      : clamp(supportHeight - surface.height, -.07, .1);
    const heightTarget = Math.max(
      .135 * this.bodyScale,
      this.neutralBodyHeight * (1 - this.crouch * .27) + supportCompensation,
    );
    this.bodyHeight = damp(this.bodyHeight, heightTarget, 11, dt);
    this.shoulderHeight = this.bodyHeight + clamp(frontHeight - supportHeight, -.1, .1);
    this.pelvisHeight = this.bodyHeight + clamp(hindHeight - supportHeight, -.1, .1);

    // With +Z forward, positive X rotation lowers the nose. Higher forefeet
    // therefore require a negative pitch to align the trunk uphill.
    const terrainPitch = -Math.atan2(frontHeight - hindHeight, .283 * this.bodyScale);
    this.bodyPitch = damp(this.bodyPitch, clamp(terrainPitch, -.38, .38), 7.5, dt);
    const gallopAmount = smoothstep(1.55, 3.6, this.speed);
    const gaitFlex = Math.sin(this.gaitPhase * TAU) * gallopAmount * .085;
    this.spineFlex = damp(this.spineFlex, gaitFlex + jumpFlex, 10, dt);
    const bendTarget = clamp(-this._yawRate * (.055 + this.speed * .018), -.32, .32);
    this.spineBend = damp(this.spineBend, bendTarget, 8, dt);

    const right = rightAt(this.heading);
    const lateralSlope = Math.atan2(surface.normal.dot(right), Math.max(.1, surface.normal.y));
    const centripetal = clamp(this.speed * this._yawRate / 9.81, -.55, .55);
    const bankTarget = clamp(lateralSlope - centripetal * .32, -.32, .32);
    const previousBank = this.bank;
    this.bank = damp(this.bank, bankTarget, this.narrowness > .5 ? 10 : 6.5, dt);
    const rollVelocity = (this.bank - previousBank) / Math.max(dt, EPSILON);

    const lookDown = this.narrowness * .14 + this.crouch * .035;
    const headTarget = clamp(-this.bodyPitch + lookDown, -.3, .36);
    this.headPitch = damp(this.headPitch, headTarget, 8, dt);
    const balanceDemand = -(this.bank * 2.4 + centripetal * .75 + rollVelocity * .055);
    this.tailBalance = damp(this.tailBalance, clamp(balanceDemand, -1, 1), 10, dt);
  }

  getMotionState() {
    const feet = {};
    for (const key of FOOT_ORDER) {
      const foot = this.feet[key];
      feet[key] = {
        position: foot.position.clone(),
        normal: foot.normal.clone(),
        plantWeight: foot.plantWeight,
        swing: foot.swing,
        phase: foot.phase,
      };
    }
    return {
      position: this.position.clone(),
      heading: this.heading,
      velocity: this.velocity.clone(),
      speed: this.speed,
      gait: this.gait,
      gaitPhase: this.gaitPhase,
      bodyHeight: this.bodyHeight,
      crouch: this.crouch,
      spineBend: this.spineBend,
      bank: this.bank,
      headPitch: this.headPitch,
      tailBalance: this.tailBalance,
      jumpPhase: this.jumpPhase,
      feet,
      shoulderHeight: this.shoulderHeight,
      pelvisHeight: this.pelvisHeight,
      bodyPitch: this.bodyPitch,
      spineFlex: this.spineFlex,
      narrowness: this.narrowness,
    };
  }

  getPath() {
    return this.path.map(point => point.clone());
  }
}

export default ProceduralLocomotion;
