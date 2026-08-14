import * as THREE from 'three';
import { clamp, lerp, saturate } from '../core/math.js';

const UP = new THREE.Vector3(0, 1, 0);
const EPSILON = 1e-5;

function vector3(value, fallback = null) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) {
    return new THREE.Vector3(
      Number(value[0]) || 0,
      Number(value[1]) || 0,
      Number(value[2]) || 0,
    );
  }
  if (value && Number.isFinite(value.x) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, Number.isFinite(value.y) ? value.y : 0, value.z);
  }
  return fallback?.isVector3 ? fallback.clone() : new THREE.Vector3();
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function obstaclePosition(obstacle) {
  return vector3(
    obstacle?.position ?? obstacle?.center ?? obstacle?.object?.position,
    new THREE.Vector3(),
  );
}

function readBox(value) {
  if (!value) return null;
  if (value.isBox3 && !value.isEmpty()) return value.clone();
  const min = value.min && vector3(value.min);
  const max = value.max && vector3(value.max);
  return min && max ? new THREE.Box3(min, max) : null;
}

function obstacleBox(obstacle) {
  if (!obstacle) return null;
  const supplied = readBox(obstacle) ?? readBox(obstacle.bounds) ??
    readBox(obstacle.boundingBox) ?? readBox(obstacle.box);
  if (supplied) return supplied;

  const object = obstacle.object3D ?? obstacle.mesh ??
    (obstacle.isObject3D ? obstacle : null);
  if (object) {
    try {
      const box = new THREE.Box3().setFromObject(object);
      if (!box.isEmpty()) return box;
    } catch {
      // A sparse environment can expose placeholder objects without geometry.
    }
  }

  const position = obstaclePosition(obstacle);
  const dimensions = obstacle.halfExtents ?? obstacle.extents ??
    obstacle.size ?? obstacle.dimensions;
  if (Number.isFinite(dimensions)) {
    const half = dimensions * (obstacle.halfExtents || obstacle.extents ? 1 : .5);
    return new THREE.Box3(
      new THREE.Vector3(position.x - half, position.y - half, position.z - half),
      new THREE.Vector3(position.x + half, position.y + half, position.z + half),
    );
  }
  if (dimensions && (Number.isFinite(dimensions.x) || Number.isFinite(dimensions.z))) {
    const isHalf = dimensions === obstacle.halfExtents || dimensions === obstacle.extents;
    const hx = finite(dimensions.x, finite(dimensions.width, .2)) * (isHalf ? 1 : .5);
    const hy = finite(dimensions.y, finite(dimensions.height, .4)) * (isHalf ? 1 : .5);
    const hz = finite(dimensions.z, finite(dimensions.depth, .2)) * (isHalf ? 1 : .5);
    return new THREE.Box3(
      new THREE.Vector3(position.x - hx, position.y - hy, position.z - hz),
      new THREE.Vector3(position.x + hx, position.y + hy, position.z + hz),
    );
  }
  if (Number.isFinite(obstacle.width) || Number.isFinite(obstacle.depth)) {
    const hx = finite(obstacle.width, .4) * .5;
    const hy = finite(obstacle.height, .8) * .5;
    const hz = finite(obstacle.depth, finite(obstacle.width, .4)) * .5;
    return new THREE.Box3(
      new THREE.Vector3(position.x - hx, position.y - hy, position.z - hz),
      new THREE.Vector3(position.x + hx, position.y + hy, position.z + hz),
    );
  }
  return null;
}

class MinHeap {
  constructor() { this.items = []; }

  get size() { return this.items.length; }

  push(item) {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].priority <= item.priority) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = item;
  }

  pop() {
    const items = this.items;
    if (!items.length) return null;
    const root = items[0];
    const tail = items.pop();
    if (!items.length) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= items.length) break;
      let child = left;
      if (right < items.length && items[right].priority < items[left].priority) child = right;
      if (items[child].priority >= tail.priority) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = tail;
    return root;
  }
}

/**
 * Terrain-aware grid navigation with conservative fallbacks for incomplete worlds.
 * Paths and debug paths are arrays of independent THREE.Vector3 instances.
 */
export class NavigationSystem {
  constructor(environment = {}) {
    this.environment = environment ?? {};
    this.debugPath = [];
    this.debug = {
      rawPath: [],
      path: this.debugPath,
      visited: [],
      reached: false,
      reason: 'not-searched',
    };
  }

  _obstacles() {
    const source = typeof this.environment?.obstacles === 'function'
      ? this.environment.obstacles()
      : this.environment?.obstacles;
    if (Array.isArray(source)) return source;
    if (source?.isObject3D) return source.children ?? [];
    if (source && typeof source[Symbol.iterator] === 'function') return [...source];
    return [];
  }

  sampleSurface(positionOrX, z, fallbackY = 0) {
    const point = positionOrX?.isVector3 || (positionOrX && typeof positionOrX === 'object')
      ? vector3(positionOrX)
      : new THREE.Vector3(finite(positionOrX, 0), finite(fallbackY, 0), finite(z, 0));
    if (point?.isVector3 && Number.isFinite(z) && !Number.isFinite(point.z)) point.z = z;

    let raw = null;
    const sampler = this.environment?.sampleSurface;
    if (typeof sampler === 'function') {
      try {
        raw = sampler.length <= 1
          ? sampler.call(this.environment, point.clone())
          : sampler.call(this.environment, point.x, point.z);
      } catch {
        try {
          raw = sampler.length <= 1
            ? sampler.call(this.environment, point.x, point.z)
            : sampler.call(this.environment, point.clone());
        } catch {
          raw = null;
        }
      }
    }

    if (raw == null) {
      const heightSampler = this.environment?.heightAt ?? this.environment?.sampleHeight ??
        this.environment?.terrainHeightAt;
      if (typeof heightSampler === 'function') {
        try { raw = heightSampler.call(this.environment, point.x, point.z); } catch { raw = null; }
      }
    }

    if (Number.isFinite(raw)) {
      return {
        position: new THREE.Vector3(point.x, raw, point.z),
        height: raw,
        normal: UP.clone(),
        walkable: true,
        width: Infinity,
        narrowness: 0,
      };
    }

    const rawPosition = raw?.position ?? raw?.point;
    const height = finite(
      raw?.height,
      finite(raw?.y, finite(rawPosition?.y, finite(point.y, fallbackY))),
    );
    const normal = vector3(raw?.normal ?? raw?.surfaceNormal, UP);
    if (normal.lengthSq() < EPSILON) normal.copy(UP);
    else normal.normalize();
    const width = finite(raw?.width, finite(raw?.pathWidth, Infinity));
    const explicitNarrowness = finite(raw?.narrowness, finite(raw?.balance, NaN));
    const narrowness = Number.isFinite(explicitNarrowness)
      ? saturate(explicitNarrowness)
      : Number.isFinite(width) ? 1 - saturate((width - .08) / .52) : 0;

    return {
      ...(raw && typeof raw === 'object' ? raw : null),
      position: new THREE.Vector3(point.x, height, point.z),
      height,
      normal,
      walkable: raw?.walkable !== false && raw?.blocked !== true && raw?.void !== true,
      width,
      narrowness,
    };
  }

  _externalBlockQuery(point, radius, options) {
    const query = this.environment?.isBlocked;
    if (typeof query !== 'function') return false;
    try {
      return Boolean(query.length <= 1
        ? query.call(this.environment, point.clone())
        : query.call(this.environment, point.clone(), radius, options));
    } catch {
      try { return Boolean(query.call(this.environment, point.x, point.z, radius)); }
      catch { return false; }
    }
  }

  _obstacleBlocks(obstacle, point, radius, options) {
    if (!obstacle || obstacle.disabled || obstacle.passable || obstacle.walkable ||
        obstacle.collision === false || obstacle.solid === false) return false;
    if (options.ignore && (options.ignore === obstacle || options.ignore === obstacle.id ||
        options.ignore.has?.(obstacle) || options.ignore.has?.(obstacle.id))) return false;

    const center = obstaclePosition(obstacle);
    const obstacleRadius = finite(obstacle.radius, finite(obstacle.collisionRadius, NaN));
    if (Number.isFinite(obstacleRadius)) {
      const dx = point.x - center.x;
      const dz = point.z - center.z;
      const height = finite(obstacle.height, Infinity);
      const baseY = finite(obstacle.baseY, center.y - (Number.isFinite(height) ? height * .5 : 0));
      const topY = Number.isFinite(height) ? baseY + height : Infinity;
      const verticallyRelevant = point.y < topY - finite(options.stepTolerance, .025);
      return verticallyRelevant && dx * dx + dz * dz < Math.pow(obstacleRadius + radius, 2);
    }

    const box = obstacleBox(obstacle);
    if (!box) return false;
    const insideXZ = point.x >= box.min.x - radius && point.x <= box.max.x + radius &&
      point.z >= box.min.z - radius && point.z <= box.max.z + radius;
    if (!insideXZ) return false;
    const top = box.max.y;
    const maxStep = finite(options.maxStep, .22);
    if ((obstacle.step || obstacle.walkableTop) && top - point.y <= maxStep) return false;
    return point.y < top - finite(options.stepTolerance, .025);
  }

  isBlocked(position, radius = .18, options = {}) {
    if (radius && typeof radius === 'object') {
      options = radius;
      radius = finite(options.radius, .18);
    }
    radius = Math.max(0, finite(radius, .18));
    const point = vector3(position);
    const surface = this.sampleSurface(point, undefined, point.y);
    point.y = surface.height;
    if (!surface.walkable) return true;
    const maxSlope = finite(options.maxSlope, Math.PI * .235);
    if (surface.normal.y < Math.cos(maxSlope)) return true;

    const from = options.from ? this.sampleSurface(options.from) : null;
    if (from && Math.abs(surface.height - from.height) > finite(options.maxStep, .22)) return true;
    if (this._externalBlockQuery(point, radius, options)) return true;
    return this._obstacles().some(obstacle => this._obstacleBlocks(obstacle, point, radius, options));
  }

  obstacleTopAt(positionOrX, z, radius = 0) {
    const point = positionOrX?.isVector3 || (positionOrX && typeof positionOrX === 'object')
      ? vector3(positionOrX)
      : new THREE.Vector3(finite(positionOrX, 0), -Infinity, finite(z, 0));
    let top = -Infinity;
    for (const obstacle of this._obstacles()) {
      if (!obstacle || obstacle.disabled || obstacle.passable || obstacle.collision === false) continue;
      const center = obstaclePosition(obstacle);
      const obstacleRadius = finite(obstacle.radius, finite(obstacle.collisionRadius, NaN));
      if (Number.isFinite(obstacleRadius)) {
        if (Math.hypot(point.x - center.x, point.z - center.z) <= obstacleRadius + radius) {
          top = Math.max(top, finite(obstacle.top, center.y + finite(obstacle.height, 0) * .5));
        }
        continue;
      }
      const box = obstacleBox(obstacle);
      if (box && point.x >= box.min.x - radius && point.x <= box.max.x + radius &&
          point.z >= box.min.z - radius && point.z <= box.max.z + radius) {
        top = Math.max(top, box.max.y);
      }
    }
    return top;
  }

  _segmentClear(start, end, options = {}) {
    const a = vector3(start);
    const b = vector3(end);
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const spacing = Math.max(.06, finite(options.sampleSpacing, finite(options.cellSize, .32) * .42));
    const steps = Math.max(1, Math.ceil(distance / spacing));
    let previous = this.sampleSurface(a);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const point = new THREE.Vector3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
      const surface = this.sampleSurface(point);
      point.y = surface.height;
      if (this.isBlocked(point, finite(options.radius, .18), { ...options, from: previous.position })) {
        return false;
      }
      previous = surface;
    }
    return true;
  }

  _nearestWalkable(point, options) {
    const center = vector3(point);
    if (!this.isBlocked(center, options.radius, options)) return this.sampleSurface(center).position;
    const rings = finite(options.goalSearchRings, 7);
    for (let ring = 1; ring <= rings; ring++) {
      const count = Math.max(8, ring * 8);
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2;
        const candidate = center.clone();
        candidate.x += Math.cos(angle) * options.cellSize * ring;
        candidate.z += Math.sin(angle) * options.cellSize * ring;
        const sampled = this.sampleSurface(candidate).position;
        if (!this.isBlocked(sampled, options.radius, options)) return sampled;
      }
    }
    return null;
  }

  findPath(start, target, options = {}) {
    const settings = {
      cellSize: clamp(finite(options.cellSize, .32), .12, 1),
      radius: Math.max(.02, finite(options.radius, .18)),
      maxStep: Math.max(.03, finite(options.maxStep, .24)),
      maxSlope: finite(options.maxSlope, Math.PI * .235),
      maxNodes: Math.max(64, finite(options.maxNodes, 4500)),
      margin: Math.max(.8, finite(options.margin, 2.2)),
      allowDiagonal: options.allowDiagonal !== false,
      allowPartial: options.allowPartial !== false,
      smooth: options.smooth !== false,
      ...options,
    };
    const startPoint = this.sampleSurface(vector3(start)).position;
    const requestedGoal = this.sampleSurface(vector3(target)).position;
    const goalPoint = this._nearestWalkable(requestedGoal, settings);

    this.debug.visited = [];
    this.debug.rawPath = [];
    this.debug.reached = false;
    this.debug.reason = 'searching';

    if (!goalPoint) {
      this.debug.reason = 'target-blocked';
      this.debugPath = [startPoint.clone()];
      this.debug.path = this.debugPath;
      return this.debugPath.map(point => point.clone());
    }

    if (this._segmentClear(startPoint, goalPoint, settings)) {
      const direct = [startPoint, goalPoint];
      this.debug.rawPath = direct.map(point => point.clone());
      this.debugPath = direct.map(point => point.clone());
      this.debug.path = this.debugPath;
      this.debug.reached = goalPoint.distanceToSquared(requestedGoal) < settings.cellSize ** 2;
      this.debug.reason = this.debug.reached ? 'direct' : 'nearest-reachable';
      return direct.map(point => point.clone());
    }

    const distance = Math.hypot(goalPoint.x - startPoint.x, goalPoint.z - startPoint.z);
    const margin = settings.margin + Math.min(4, distance * .18);
    let minX = Math.min(startPoint.x, goalPoint.x) - margin;
    let maxX = Math.max(startPoint.x, goalPoint.x) + margin;
    let minZ = Math.min(startPoint.z, goalPoint.z) - margin;
    let maxZ = Math.max(startPoint.z, goalPoint.z) + margin;
    const worldBounds = readBox(this.environment?.bounds ?? this.environment?.navigationBounds);
    if (worldBounds) {
      minX = Math.max(minX, worldBounds.min.x);
      maxX = Math.min(maxX, worldBounds.max.x);
      minZ = Math.max(minZ, worldBounds.min.z);
      maxZ = Math.min(maxZ, worldBounds.max.z);
    }

    const toIndex = point => ({
      x: clamp(Math.round((point.x - minX) / settings.cellSize), 0, Math.floor((maxX - minX) / settings.cellSize)),
      z: clamp(Math.round((point.z - minZ) / settings.cellSize), 0, Math.floor((maxZ - minZ) / settings.cellSize)),
    });
    const startIndex = toIndex(startPoint);
    const goalIndex = toIndex(goalPoint);
    const width = Math.max(1, Math.floor((maxX - minX) / settings.cellSize));
    const depth = Math.max(1, Math.floor((maxZ - minZ) / settings.cellSize));
    const keyOf = (x, z) => `${x},${z}`;
    const pointAt = (x, z) => this.sampleSurface(
      new THREE.Vector3(minX + x * settings.cellSize, startPoint.y, minZ + z * settings.cellSize),
    ).position;

    const open = new MinHeap();
    const records = new Map();
    const closed = new Set();
    const surfaceCache = new Map();
    const startKey = keyOf(startIndex.x, startIndex.z);
    const startRecord = {
      x: startIndex.x, z: startIndex.z, key: startKey,
      point: startPoint.clone(), g: 0, parent: null,
    };
    startRecord.h = Math.hypot(startIndex.x - goalIndex.x, startIndex.z - goalIndex.z);
    records.set(startKey, startRecord);
    open.push({ key: startKey, priority: startRecord.h });

    const sampleNode = (x, z) => {
      const key = keyOf(x, z);
      if (surfaceCache.has(key)) return surfaceCache.get(key);
      const point = pointAt(x, z);
      const result = {
        point,
        blocked: this.isBlocked(point, settings.radius, settings),
        surface: this.sampleSurface(point),
      };
      surfaceCache.set(key, result);
      return result;
    };

    const directions = settings.allowDiagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let best = startRecord;
    let found = null;
    let iterations = 0;

    while (open.size && iterations++ < settings.maxNodes) {
      const queued = open.pop();
      if (!queued || closed.has(queued.key)) continue;
      const current = records.get(queued.key);
      if (!current) continue;
      closed.add(current.key);
      if (this.debug.visited.length < 800) this.debug.visited.push(current.point.clone());

      const remaining = Math.hypot(current.x - goalIndex.x, current.z - goalIndex.z);
      if (remaining < best.h) best = current;
      if (current.x === goalIndex.x && current.z === goalIndex.z) {
        found = current;
        break;
      }

      for (const [dx, dz] of directions) {
        const nx = current.x + dx;
        const nz = current.z + dz;
        if (nx < 0 || nz < 0 || nx > width || nz > depth) continue;
        const neighbor = sampleNode(nx, nz);
        if (neighbor.blocked) continue;
        if (dx && dz) {
          if (sampleNode(current.x + dx, current.z).blocked ||
              sampleNode(current.x, current.z + dz).blocked) continue;
        }
        const rise = neighbor.point.y - current.point.y;
        if (Math.abs(rise) > settings.maxStep) continue;
        const planarCost = Math.hypot(dx, dz);
        const slopeCost = Math.abs(rise) / settings.cellSize * 1.8;
        const narrowCost = finite(neighbor.surface.narrowness, 0) * finite(settings.narrowPenalty, .38);
        const tentativeG = current.g + planarCost + slopeCost + narrowCost;
        const key = keyOf(nx, nz);
        const old = records.get(key);
        if (old && tentativeG >= old.g - EPSILON) continue;
        const h = Math.hypot(nx - goalIndex.x, nz - goalIndex.z);
        const record = { x: nx, z: nz, key, point: neighbor.point, g: tentativeG, h, parent: current.key };
        records.set(key, record);
        open.push({ key, priority: tentativeG + h * 1.04 });
      }
    }

    const endpoint = found ?? (settings.allowPartial ? best : null);
    if (!endpoint) {
      this.debug.reason = iterations >= settings.maxNodes ? 'node-limit' : 'no-path';
      this.debugPath = [startPoint.clone()];
      this.debug.path = this.debugPath;
      return this.debugPath.map(point => point.clone());
    }

    const raw = [];
    let cursor = endpoint;
    while (cursor) {
      raw.push(cursor.point.clone());
      cursor = cursor.parent ? records.get(cursor.parent) : null;
    }
    raw.reverse();
    raw[0] = startPoint.clone();
    if (found && this._segmentClear(raw.at(-1), goalPoint, settings)) raw.push(goalPoint.clone());

    this.debug.rawPath = raw.map(point => point.clone());
    const result = settings.smooth ? this.smoothPath(raw, settings) : raw;
    this.debugPath = result.map(point => point.clone());
    this.debug.path = this.debugPath;
    this.debug.reached = Boolean(found);
    this.debug.reason = found ? 'reached' : iterations >= settings.maxNodes ? 'partial-node-limit' : 'partial';
    return result.map(point => point.clone());
  }

  smoothPath(path, options = {}) {
    if (!Array.isArray(path) || path.length < 2) return (path ?? []).map(point => vector3(point));
    const points = path.map(point => this.sampleSurface(vector3(point)).position);
    const pruned = [points[0]];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let next = points.length - 1;
      while (next > anchor + 1 && !this._segmentClear(points[anchor], points[next], options)) next--;
      pruned.push(points[next]);
      anchor = next;
    }
    if (pruned.length < 3 || options.roundCorners === false) return pruned.map(point => point.clone());

    const result = [pruned[0].clone()];
    const radius = Math.max(.02, finite(options.cornerRadius, finite(options.cellSize, .32) * .65));
    const curveSegments = Math.max(1, Math.round(finite(options.curveSegments, 3)));
    for (let i = 1; i < pruned.length - 1; i++) {
      const previous = pruned[i - 1];
      const corner = pruned[i];
      const next = pruned[i + 1];
      const inDistance = Math.hypot(corner.x - previous.x, corner.z - previous.z);
      const outDistance = Math.hypot(next.x - corner.x, next.z - corner.z);
      const cut = Math.min(radius, inDistance * .32, outDistance * .32);
      const entryT = inDistance > EPSILON ? 1 - cut / inDistance : 1;
      const exitT = outDistance > EPSILON ? cut / outDistance : 0;
      const entry = previous.clone().lerp(corner, entryT);
      const exit = corner.clone().lerp(next, exitT);
      if (!this._segmentClear(result.at(-1), entry, options) ||
          !this._segmentClear(entry, exit, options)) {
        result.push(corner.clone());
        continue;
      }
      result.push(this.sampleSurface(entry).position);
      for (let step = 1; step <= curveSegments; step++) {
        const t = step / curveSegments;
        const u = 1 - t;
        const point = new THREE.Vector3(
          u * u * entry.x + 2 * u * t * corner.x + t * t * exit.x,
          u * u * entry.y + 2 * u * t * corner.y + t * t * exit.y,
          u * u * entry.z + 2 * u * t * corner.z + t * t * exit.z,
        );
        result.push(this.sampleSurface(point).position);
      }
    }
    result.push(pruned.at(-1).clone());
    return result;
  }

  getDebugPath() {
    return this.debugPath.map(point => point.clone());
  }
}

export default NavigationSystem;
