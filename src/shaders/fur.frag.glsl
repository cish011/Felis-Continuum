precision highp float;

uniform float uTime;
uniform float uLayer;
uniform float uFurDensity;
uniform float uPattern;
uniform float uMotionEnergy;
uniform vec3 uBaseColor;
uniform vec3 uDarkColor;
uniform vec3 uWarmColor;

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

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z
  );
}

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.54;
  for (int i = 0; i < 4; i++) {
    value += noise3(p) * amplitude;
    p = p * 2.03 + vec3(7.1, 3.7, 5.9);
    amplitude *= 0.48;
  }
  return value;
}

float aaBand(float wave, float width) {
  float edge = max(fwidth(wave) * 1.45, 0.015);
  return 1.0 - smoothstep(width - edge, width + edge, abs(wave));
}

float tabbyMask(vec3 p, bool classicPattern) {
  float region = floor(vRegion + 0.5);
  float warp = fbm(p * 8.5 + vSeed) - 0.5;
  float wave;

  if (region == 2.0) {
    // Rings continue coherently around the distal limbs.
    wave = sin((p.y + warp * 0.024) * (classicPattern ? 44.0 : 69.0));
  } else if (region == 3.0) {
    float tailDistance = length(p - vec3(0.0, 0.38, -0.34));
    wave = sin((tailDistance + warp * 0.018) * (classicPattern ? 44.0 : 71.0));
  } else if (region == 1.0 || region == 4.0 || region == 5.0) {
    // Forehead lines radiate around the eyes instead of being projected body stripes.
    float fan = atan(p.x, max(0.015, p.y - 0.49));
    wave = sin(fan * (classicPattern ? 4.0 : 7.0) + p.z * 23.0 + warp * 2.0);
  } else if (classicPattern) {
    // Broad bullseye domains on the flanks, broken by a dorsal spine stripe.
    float side = abs(p.x);
    float swirl = length(vec2((p.z + 0.03) * 1.25, (p.y - 0.37) * 1.7));
    wave = sin(swirl * 43.0 + warp * 5.2 + side * 10.0);
  } else {
    // Mackerel columns cross the long body axis and curve down the flank.
    float flankCurve = p.z + 0.23 * (p.y - 0.40) + 0.07 * abs(p.x);
    wave = sin(flankCurve * 56.0 + warp * 4.0);
  }

  float stripes = aaBand(wave, classicPattern ? 0.30 : 0.23);
  float dorsal = smoothstep(0.095, 0.02, abs(p.x)) * smoothstep(0.22, 0.52, p.y);
  if (region > 0.5) dorsal *= 0.25;
  return max(stripes, dorsal);
}

vec3 biologicalCoat(vec3 p) {
  float micro = fbm(p * 72.0 + vSeed * 4.0);
  vec3 agouti = mix(uBaseColor, uWarmColor, 0.10 + micro * 0.20);
  float pattern = floor(uPattern + 0.5);

  if (pattern == 1.0 || pattern == 2.0) {
    float stripes = tabbyMask(p, pattern == 2.0);
    // Fine root-to-tip pigment interruptions suggest agouti banding without
    // turning the entire coat into a flat decal.
    float hairBand = 0.88 + 0.12 * sin((p.y + p.z * 0.11) * 690.0 + micro * 8.0);
    return mix(agouti * hairBand, uDarkColor, stripes * 0.88);
  }

  if (pattern == 3.0) {
    // KIT-like white spread starts ventrally, climbs the chest and muzzle, and
    // reaches the distal paws with irregular developmental boundaries.
    float boundary = fbm(p * 9.0 + vec3(3.0, 1.0, 7.0)) - 0.5;
    float ventral = smoothstep(0.365 + boundary * 0.055, 0.255, p.y);
    float chest = smoothstep(0.11, 0.31, p.z) * smoothstep(0.12, 0.34, p.y) *
                  smoothstep(0.17, 0.02, abs(p.x));
    float muzzle = step(4.5, vRegion);
    float socks = step(1.5, vRegion) * step(p.y, 0.145 + boundary * 0.025);
    return mix(uBaseColor, uWarmColor, clamp(max(max(ventral, chest), max(muzzle * 0.72, socks)), 0.0, 1.0));
  }

  if (pattern == 4.0) {
    // Large coherent melanocyte fields: white ground, orange and black islands.
    float domains = fbm(p * 7.2 + vec3(9.0, 2.0, 1.0));
    float secondary = fbm(p * 11.0 + vec3(2.0, 8.0, 5.0));
    if (domains > 0.66) return mix(uWarmColor, uBaseColor, micro * 0.12);
    if (domains < 0.47 && secondary > 0.46) return mix(uDarkColor, uBaseColor, micro * 0.08);
    return uBaseColor;
  }

  if (pattern == 5.0) {
    // X-inactivation makes contiguous orange/non-orange clones, with finer intermixing.
    float cloneField = fbm(p * 9.0 + vec3(4.0, 9.0, 2.0));
    float ember = smoothstep(0.50, 0.64, cloneField + (micro - 0.5) * 0.13);
    return mix(mix(uBaseColor, uDarkColor, 0.34), uWarmColor, ember * 0.88);
  }

  if (pattern == 6.0) {
    // Temperature-sensitive TYR expression follows face, ear, tail and distal zones.
    float face = smoothstep(0.43, 0.58, p.z) + step(3.5, vRegion) * 0.30;
    float tail = smoothstep(-0.34, -0.62, p.z) * step(2.5, vRegion);
    float distal = step(1.5, vRegion) * smoothstep(0.20, 0.045, p.y);
    float cool = clamp(max(face, max(tail, distal)), 0.0, 1.0);
    cool = smoothstep(0.16, 0.92, cool + (fbm(p * 8.0) - 0.5) * 0.16);
    return mix(mix(uBaseColor, uWarmColor, 0.12), uDarkColor, cool * 0.92);
  }

  // Solid coats still contain guard/undercoat value shifts.
  return mix(uBaseColor, uWarmColor, 0.055 + micro * 0.105);
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPosition);

  if (uLayer > 0.001) {
    // Compound follicle groups create clustered underfur with sparse awn and
    // guard tips. Screen-space dithering prevents shell ordering bands.
    float tuft = fbm(vCatPosition * mix(255.0, 145.0, uLayer) + vSeed * 11.0);
    float strand = hash13(floor(vCatPosition * mix(520.0, 265.0, uLayer)) + vSeed);
    float coverage = mix(0.80, 0.19, pow(uLayer, 1.22)) * uFurDensity;
    coverage *= mix(0.72, 1.19, tuft);
    float screenDither = hash13(vec3(gl_FragCoord.xy, vSeed + uLayer * 17.0));
    if (strand * 0.72 + screenDither * 0.28 > coverage) discard;

    // Make outer guard fibers fragment toward their tips and at grazing angles.
    float grazing = 1.0 - abs(dot(N, V));
    float tipLoss = pow(uLayer, 2.1) * (0.20 + 0.42 * (1.0 - grazing));
    if (vShellNoise < tipLoss) discard;
  }

  vec3 albedo = biologicalCoat(vCatPosition);

  vec3 keyDir = normalize(vec3(0.42, 0.82, 0.36));
  vec3 fillDir = normalize(vec3(-0.70, 0.32, -0.25));
  float key = max(dot(N, keyDir), 0.0);
  float fill = max(dot(N, fillDir), 0.0);
  float hemi = N.y * 0.5 + 0.5;
  vec3 light = vec3(0.30, 0.31, 0.34) + vec3(0.70, 0.66, 0.59) * key;
  light += vec3(0.16, 0.20, 0.24) * fill + vec3(0.11, 0.14, 0.16) * hemi;

  // Kajiya-Kay-like elongated sheen along the guide direction. Undercoat has
  // broad scatter; the sparse guard layer carries the sharp highlight.
  vec3 H = normalize(V + keyDir);
  float tangentSpec = pow(max(0.0, sqrt(max(0.0, 1.0 - dot(vFurFlow, H) * dot(vFurFlow, H)))),
                          mix(9.0, 34.0, uLayer));
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.5);
  vec3 sheenColor = mix(vec3(0.20, 0.18, 0.15), vec3(0.70, 0.72, 0.68), uLayer);
  vec3 color = albedo * light;
  color += sheenColor * tangentSpec * mix(0.055, 0.16, uLayer);
  color += albedo * fresnel * (0.045 + uLayer * 0.13);

  float alpha = uLayer < 0.001 ? 1.0 : mix(0.68, 0.34, uLayer);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
