precision highp float;

uniform float uTime;
uniform float uFurLength;
uniform float uLayer;
uniform float uMotionEnergy;
uniform mat4 uCatWorldMatrix;
uniform mat4 uCatWorldInverse;

attribute float aCatRegion;
attribute float aFurSeed;

varying vec3 vCatPosition;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vFurFlow;
varying vec2 vUv;
varying float vRegion;
varying float vSeed;
varying float vShellNoise;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float regionLength(float region) {
  if (region > 4.5) return 0.58; // muzzle and eyelids
  if (region > 3.5) return 0.48; // thin ear edges
  if (region > 2.5) return 1.16; // tail guard hairs
  if (region > 1.5) return 0.54; // close limb coat
  if (region > 0.5) return 0.70; // face
  return 1.0;                    // torso
}

void main() {
  vec4 worldBase = modelMatrix * vec4(position, 1.0);
  vec3 catBase = (uCatWorldInverse * worldBase).xyz;

  // The model only uses rigid part transforms plus uniform root scaling. This
  // keeps a stable normal without requiring an inverse-matrix vertex uniform.
  vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
  vec3 catRear = normalize(mat3(uCatWorldMatrix) * vec3(0.0, -0.08, -1.0));
  vec3 partDistal = normalize(mat3(modelMatrix) * vec3(0.0, -1.0, 0.0));
  vec3 flow = catRear;
  if (aCatRegion > 1.5 && aCatRegion < 4.5) flow = partDistal;

  // Project guide direction onto the skin. Body hairs lie caudally, limb hair
  // points distally, and tail hair follows each articulated segment.
  flow -= worldNormal * dot(flow, worldNormal);
  if (dot(flow, flow) < 0.0001) flow = normalize(cross(worldNormal, vec3(1.0, 0.0, 0.0)));
  flow = normalize(flow);

  float coarse = hash13(catBase * 91.7 + aFurSeed);
  float fine = hash13(catBase * 347.0 + aFurSeed * 2.31);
  float shell = uFurLength * regionLength(aCatRegion) * uLayer;
  float breakup = mix(0.82, 1.18, coarse) * mix(0.93, 1.07, fine);
  float guardLift = pow(uLayer, 1.75);
  float sway = sin(uTime * (1.15 + uMotionEnergy * 3.2) + aFurSeed * 7.0 + catBase.z * 19.0);
  sway *= shell * (0.025 + 0.075 * uMotionEnergy) * guardLift;

  vec3 worldDisplaced = worldBase.xyz;
  worldDisplaced += worldNormal * shell * breakup;
  worldDisplaced += flow * shell * (0.16 + 0.19 * guardLift);
  worldDisplaced += flow * sway;

  vCatPosition = (uCatWorldInverse * vec4(worldDisplaced, 1.0)).xyz;
  vWorldPosition = worldDisplaced;
  vWorldNormal = worldNormal;
  vFurFlow = flow;
  vUv = uv;
  vRegion = aCatRegion;
  vSeed = aFurSeed;
  vShellNoise = coarse * 0.63 + fine * 0.37;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldDisplaced, 1.0);
}
