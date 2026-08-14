export const TAU = Math.PI * 2;

export const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const saturate = value => clamp(value, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inverseLerp = (a, b, value) => a === b ? 0 : saturate((value - a) / (b - a));
export const remap = (inA, inB, outA, outB, value) => lerp(outA, outB, inverseLerp(inA, inB, value));
export const smoothstep = (edge0, edge1, x) => {
  const t = inverseLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (edge0, edge1, x) => {
  const t = inverseLerp(edge0, edge1, x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const dampAngle = (current, target, lambda, dt) => current + shortestAngle(current, target) * (1 - Math.exp(-lambda * dt));
export const shortestAngle = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export const gaussian = (x, center, width) => Math.exp(-Math.pow(x - center, 2) / (2 * width * width));

export function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, seed = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

export function fbm2(x, y, seed = 0, octaves = 4) {
  let value = 0, amplitude = .5, frequency = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise2(x * frequency, y * frequency, seed + i * 19) * amplitude;
    total += amplitude;
    frequency *= 2.03;
    amplitude *= .5;
  }
  return value / total;
}

export function criticallyDampedSpring(state, target, frequency, dt) {
  const f = 1 + 2 * dt * frequency;
  const ff = frequency * frequency;
  const dtff = dt * ff;
  const detInv = 1 / (f + dt * dtff);
  const value = (f * state.value + dt * state.velocity + dt * dtff * target) * detInv;
  const velocity = (state.velocity + dtff * (target - state.value)) * detInv;
  state.value = value;
  state.velocity = velocity;
  return value;
}

export const meters = value => `${value.toFixed(2)} m`;
export const percent = value => `${Math.round(saturate(value) * 100)}%`;
