import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, dampAngle } from '../core/math.js';

const MODEL_URL = './models/realistic-cat-demo.glb';
// The exported conversion nodes already normalize the source centimetres to
// metres. Keeping their hierarchy intact yields a 0.487 m nose-to-tail-base
// cat without an additional scale correction.
const SOURCE_SCALE = 1;
const PELVIS_ROOT_Z = -.13;
const DEFAULT_IDLE = 'Cat|Idle_00-IP';

const CLIPS = Object.freeze({
  idle: ['Cat|Idle_00-IP', 'Cat|A_Idle_00'],
  idleAlternate: ['Cat|Idle_01-IP', 'Cat|A_Idle_01', 'Cat|Idle_00-IP'],
  slowWalk: ['Cat|WalkSlow-IP', 'Cat|Walk-IP'],
  walk: ['Cat|Walk-IP', 'Cat|WalkSlow-IP'],
  trot: ['Cat|Trot-IP', 'Cat|Walk-IP'],
  run: ['Cat|Run-IP', 'Cat|Trot-IP'],
  sprint: ['Cat|Sprint-IP', 'Cat|Run-IP'],
  sneak: ['Cat|Sneak-IP', 'Cat|WalkSlow-IP'],
  jumpIdle: ['Cat|Jump_Idle-IP', 'Cat|Jump_Up-IP'],
  jumpRun: ['Cat|Jump_Run-IP', 'Cat|Jump_Trot-IP', 'Cat|Jump_Idle-IP'],
  eat: ['Cat|Eating_01-IP', 'Cat|Idle_Eating_01-IP', DEFAULT_IDLE],
  drink: ['Cat|Drinking_01-IP', 'Cat|Idle_Drinking_01-IP', DEFAULT_IDLE],
  litter: ['Cat|Action_Urinating-IP', DEFAULT_IDLE],
  scratch: ['Cat|Action_Scratching-IP', DEFAULT_IDLE],
  rest: ['Cat|Sitting_00-IP', DEFAULT_IDLE],
  groom: ['Cat|Idle_02-IP', 'Cat|Idle_01-IP', DEFAULT_IDLE],
});

const LOCOMOTION_CLIPS = /(?:Walk|Trot|Run|Sprint|Sneak)(?:[_|-]|$)/i;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * The supplied GLB predates core metallic/roughness materials and declares
 * KHR_materials_pbrSpecularGlossiness. Three.js r180 no longer ships that
 * extension, so adapt the declaration at load time while leaving the user's
 * model file byte-for-byte untouched.
 */
class LegacySpecularGlossinessExtension {
  constructor(parser) {
    this.parser = parser;
    this.name = 'KHR_materials_pbrSpecularGlossiness';
  }

  extensionFor(materialIndex) {
    return this.parser.json.materials?.[materialIndex]?.extensions?.[this.name] ?? null;
  }

  getMaterialType(materialIndex) {
    return this.extensionFor(materialIndex) ? THREE.MeshPhysicalMaterial : null;
  }

  extendMaterialParams(materialIndex, materialParams) {
    const extension = this.extensionFor(materialIndex);
    if (!extension) return Promise.resolve();
    const diffuse = extension.diffuseFactor ?? [1, 1, 1, 1];
    materialParams.color = new THREE.Color().setRGB(
      diffuse[0] ?? 1,
      diffuse[1] ?? 1,
      diffuse[2] ?? 1,
      THREE.LinearSRGBColorSpace,
    );
    materialParams.opacity = diffuse[3] ?? 1;
    materialParams.metalness = 0;
    materialParams.roughness = clamp(1 - finite(extension.glossinessFactor), 0, 1);
    materialParams.specularIntensity = 0;
    const pending = [];
    if (extension.diffuseTexture) {
      pending.push(this.parser.assignTexture(
        materialParams,
        'map',
        extension.diffuseTexture,
        THREE.SRGBColorSpace,
      ));
    }
    return Promise.all(pending);
  }
}

function disposeMaterial(material, disposedTextures) {
  if (Array.isArray(material)) {
    for (const item of material) disposeMaterial(item, disposedTextures);
    return;
  }
  if (!material) return;
  for (const value of Object.values(material)) {
    if (value?.isTexture && !disposedTextures.has(value)) {
      disposedTextures.add(value);
      value.dispose();
    }
  }
  material.dispose?.();
}

function partFromBoneName(name = '') {
  const value = name.toLowerCase();
  if (value.includes('tail')) return 'tail';
  if (value.includes('ear')) return 'ear';
  if (value.includes('whisker') || value.includes('jaw') || value.includes('tongue')) return 'muzzle';
  if (value.includes('eye') || value.includes('head')) return 'head';
  if (value.includes('neck')) return 'neck';
  if (value.includes('shoulderblade')) return 'back';
  if (value.includes('flegdigit') || value.includes('blegdigit') || value.includes('ankle')) return 'paw';
  if (value.includes('fleg')) return 'frontLeg';
  if (value.includes('bleg')) return 'hindLeg';
  if (value.includes('chest')) return 'chest';
  if (value.includes('spine')) return 'back';
  if (value.includes('pelvis')) return 'rump';
  return 'torso';
}

function animationDefinition(motion = {}, cognition = {}) {
  const speed = Math.max(0, finite(motion.speed));
  const jumpPhase = String(motion.jumpPhase ?? 'none');
  if (jumpPhase !== 'none') {
    return { key: speed > 1.1 ? 'jumpRun' : 'jumpIdle', loop: false, phaseDriven: false };
  }
  if (motion.gait === 'stalk' || motion.gait === 'crouch' || finite(motion.crouch) > .42) {
    return { key: 'sneak', loop: true, phaseDriven: true };
  }
  if (speed > 3.25 || motion.gait === 'sprint') return { key: 'sprint', loop: true, phaseDriven: true };
  if (speed > 1.95 || motion.gait === 'run') return { key: 'run', loop: true, phaseDriven: true };
  if (speed > 1.08 || motion.gait === 'trot') return { key: 'trot', loop: true, phaseDriven: true };
  if (speed > .42 || motion.gait === 'walk' || motion.gait === 'fastWalk') {
    return { key: 'walk', loop: true, phaseDriven: true };
  }
  if (speed > .075 || motion.gait === 'slowWalk') {
    return { key: 'slowWalk', loop: true, phaseDriven: true };
  }

  const goal = String(cognition?.intention?.goal ?? 'observe');
  if (goal === 'eat') return { key: 'eat', loop: true, phaseDriven: false };
  if (goal === 'drink') return { key: 'drink', loop: true, phaseDriven: false };
  if (goal === 'litter') return { key: 'litter', loop: true, phaseDriven: false };
  if (goal === 'scratch') return { key: 'scratch', loop: true, phaseDriven: false };
  if (goal === 'rest') return { key: 'rest', loop: true, phaseDriven: false };
  if (goal === 'groom') return { key: 'groom', loop: true, phaseDriven: false };
  return { key: 'idle', loop: true, phaseDriven: false };
}

export class ImportedCatModel {
  static async load(profile = {}, {
    url = MODEL_URL,
    anisotropy = 1,
    onProgress = null,
  } = {}) {
    const loader = new GLTFLoader();
    loader.register(parser => new LegacySpecularGlossinessExtension(parser));
    let gltf;
    try {
      gltf = await loader.loadAsync(url, event => {
        const ratio = event.total > 0 ? event.loaded / event.total : 0;
        onProgress?.(ratio, event);
      });
    } catch (error) {
      throw new Error('Unable to load the supplied realistic cat model: ' + error.message, { cause: error });
    }
    return new ImportedCatModel(gltf, profile, { url, anisotropy });
  }

  constructor(gltf, profile = {}, { url = MODEL_URL, anisotropy = 1 } = {}) {
    this.isImportedCatModel = true;
    this.profile = { ...profile };
    this.sourceUrl = url;
    this.root = new THREE.Group();
    this.root.name = 'Imported realistic domestic cat';
    this.visualAnchor = new THREE.Group();
    this.visualAnchor.name = 'licensed-model-axis-and-ground-correction';
    this.assetRoot = gltf.scene;
    this.assetRoot.name = 'CAT - Realistic 3D Model (DEMO FREE)';
    this.assetRoot.scale.setScalar(SOURCE_SCALE);
    this.visualAnchor.add(this.assetRoot);
    this.root.add(this.visualAnchor);

    this.debug = new THREE.Group();
    this.debug.name = 'Imported cat diagnostics';
    this.debug.visible = false;
    this.root.add(this.debug);

    this.animations = gltf.animations ?? [];
    this.clips = new Map(this.animations.map(clip => [clip.name, clip]));
    this.actions = new Map();
    this.mixer = new THREE.AnimationMixer(this.assetRoot);
    this.currentAction = null;
    this.currentClipName = '';
    this.currentDefinition = null;
    this.pettable = [];
    this.meshes = [];
    this.partRecords = [];
    this.shellMaterials = [];
    this.anatomy = {};
    this.eyes = {};
    this.limbs = {};
    this.state = {};
    this.originalMaterials = new Map();
    this.ownedMaterials = new Set();
    this.diagnosticMaterial = new THREE.MeshStandardMaterial({
      name: 'neutral-imported-cat-validation-surface',
      color: 0x9da29e,
      roughness: .78,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.anatomyDiagnostic = false;
    this.lastMotion = null;
    this.hasWorldPose = false;
    this.ready = false;

    this.configureMeshes(anisotropy);
    this.playDefinition({ key: 'idle', loop: true, phaseDriven: false }, 0);
    this.calibrate();
    this.applyProfile(profile);
    this.ready = true;

    this.modelInfo = Object.freeze({
      title: 'CAT - Realistic 3D Model (DEMO FREE)',
      author: 'WildMesh 3D',
      source: 'https://sketchfab.com/3d-models/cat-realistic-3d-model-demo-free-db26e7ace5264438bbe6a2f070bc7fcf',
      license: 'CC-BY-4.0',
      modelUrl: this.sourceUrl,
      meshCount: this.meshes.length,
      jointCount: this.meshes.find(mesh => mesh.isSkinnedMesh)?.skeleton?.bones?.length ?? 0,
      animationCount: this.animations.length,
      bounds: {
        width: this.bounds.getSize(new THREE.Vector3()).x,
        height: this.bounds.getSize(new THREE.Vector3()).y,
        length: this.bounds.getSize(new THREE.Vector3()).z,
      },
      forwardCorrectionRadians: this.forwardCorrection,
    });
  }

  configureMeshes(anisotropy) {
    this.assetRoot.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
      object.userData.sourceModel = 'WildMesh 3D realistic cat demo';
      object.userData.sourceLicense = 'CC-BY-4.0';
      object.userData.catPart = 'torso';
      object.userData.resolveCatPart = hit => this.resolveCatPart(hit);
      this.pettable.push(object);
      this.meshes.push(object);
      this.partRecords.push({ base: object, source: 'imported-skinned-mesh' });
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        this.ownedMaterials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) value.anisotropy = Math.max(1, anisotropy);
        }
      }
      if (object.isSkinnedMesh) {
        object.computeBoundingBox();
        object.computeBoundingSphere();
      }
    });
  }

  chooseClip(key) {
    const candidates = CLIPS[key] ?? CLIPS.idle;
    return candidates.map(name => this.clips.get(name)).find(Boolean)
      ?? this.clips.get(DEFAULT_IDLE)
      ?? this.animations[0]
      ?? null;
  }

  getAction(clip) {
    if (!clip) return null;
    let action = this.actions.get(clip.name);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }
    return action;
  }

  playDefinition(definition, fade = .22) {
    const clip = this.chooseClip(definition.key);
    if (!clip) return null;
    const action = this.getAction(clip);
    if (this.currentAction === action) {
      this.currentDefinition = definition;
      return action;
    }
    action.reset();
    action.enabled = true;
    action.clampWhenFinished = !definition.loop;
    action.setLoop(definition.loop ? THREE.LoopRepeat : THREE.LoopOnce, definition.loop ? Infinity : 1);
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.play();
    if (this.currentAction) {
      if (fade > 0) this.currentAction.crossFadeTo(action, fade, true);
      else this.currentAction.stop();
    }
    this.currentAction = action;
    this.currentClipName = clip.name;
    this.currentDefinition = definition;
    return action;
  }

  calibrate() {
    this.root.updateMatrixWorld(true);
    const head = this.assetRoot.getObjectByName('RigHead_017');
    const pelvis = this.assetRoot.getObjectByName('RigPelvis_01');
    this.forwardCorrection = 0;
    if (head && pelvis) {
      const headPosition = head.getWorldPosition(new THREE.Vector3());
      const pelvisPosition = pelvis.getWorldPosition(new THREE.Vector3());
      const direction = headPosition.sub(pelvisPosition);
      direction.y = 0;
      if (direction.lengthSq() > 1e-8) {
        this.forwardCorrection = -Math.atan2(direction.x, direction.z);
        this.visualAnchor.rotation.y = this.forwardCorrection;
      }
    }

    this.root.updateMatrixWorld(true);
    if (pelvis) {
      const pelvisPosition = pelvis.getWorldPosition(new THREE.Vector3());
      this.root.worldToLocal(pelvisPosition);
      this.visualAnchor.position.x -= pelvisPosition.x;
      this.visualAnchor.position.z += PELVIS_ROOT_Z - pelvisPosition.z;
    }

    this.root.updateMatrixWorld(true);
    const firstBounds = this.computeLocalBounds();
    if (Number.isFinite(firstBounds.min.y)) this.visualAnchor.position.y -= firstBounds.min.y;
    this.root.updateMatrixWorld(true);
    this.bounds = this.computeLocalBounds();
  }

  computeLocalBounds() {
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    const rootInverse = new THREE.Matrix4();
    this.root.updateMatrixWorld(true);
    rootInverse.copy(this.root.matrixWorld).invert();
    for (const mesh of this.meshes) {
      if (mesh.isSkinnedMesh) mesh.computeBoundingBox();
      else mesh.geometry?.computeBoundingBox?.();
      const box = mesh.isSkinnedMesh ? mesh.boundingBox : mesh.geometry?.boundingBox;
      if (!box) continue;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            point.set(x, y, z).applyMatrix4(mesh.matrixWorld).applyMatrix4(rootInverse);
            if ([point.x, point.y, point.z].every(Number.isFinite)) bounds.expandByPoint(point);
          }
        }
      }
    }
    return bounds;
  }

  resolveCatPart(hit) {
    const mesh = hit?.object;
    const face = hit?.face;
    const skinIndex = mesh?.geometry?.getAttribute?.('skinIndex');
    const skinWeight = mesh?.geometry?.getAttribute?.('skinWeight');
    const bones = mesh?.skeleton?.bones;
    if (!face || !skinIndex || !skinWeight || !bones) return 'torso';
    const totals = new Map();
    for (const vertex of [face.a, face.b, face.c]) {
      const indices = [
        skinIndex.getX(vertex), skinIndex.getY(vertex),
        skinIndex.getZ(vertex), skinIndex.getW(vertex),
      ];
      const weights = [
        skinWeight.getX(vertex), skinWeight.getY(vertex),
        skinWeight.getZ(vertex), skinWeight.getW(vertex),
      ];
      for (let channel = 0; channel < 4; channel++) {
        const part = partFromBoneName(bones[indices[channel]]?.name);
        totals.set(part, (totals.get(part) ?? 0) + Math.max(0, weights[channel]));
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'torso';
  }

  update(motion = {}, cognition = {}, dt = 1 / 60) {
    dt = clamp(finite(dt), 0, .1);
    this.lastMotion = motion;
    const position = motion.position;
    if (position?.isVector3) this.root.position.copy(position);
    else if (position && Number.isFinite(position.x) && Number.isFinite(position.z)) {
      this.root.position.set(position.x, finite(position.y), position.z);
    }
    const heading = finite(motion.heading);
    if (!this.hasWorldPose) {
      this.root.rotation.y = heading;
      this.hasWorldPose = true;
    } else {
      this.root.rotation.y = dampAngle(this.root.rotation.y, heading, 20, dt);
    }

    const definition = animationDefinition(motion, cognition);
    const action = this.playDefinition(definition);
    this.mixer.update(dt);
    if (action && definition.phaseDriven && action.getClip().duration > 0) {
      const phase = ((finite(motion.gaitPhase) % 1) + 1) % 1;
      action.time = phase * action.getClip().duration;
      this.mixer.update(0);
    }
    this.root.updateMatrixWorld(true);
  }

  setValidationPose(kind = 'standing', phase = .32) {
    const walking = kind === 'walking';
    const definition = walking
      ? { key: 'walk', loop: true, phaseDriven: true }
      : { key: 'idle', loop: true, phaseDriven: false };
    const action = this.playDefinition(definition, 0);
    if (action) {
      action.time = walking ? action.getClip().duration * phase : 0;
      this.mixer.update(0);
    }
    this.root.updateMatrixWorld(true);
  }

  applyProfile(profile = {}) {
    this.profile = { ...this.profile, ...profile };
    this.root.scale.setScalar(clamp(finite(this.profile.bodySize, 1), .82, 1.18));
  }

  setAnatomyDiagnostic(enabled = true) {
    this.anatomyDiagnostic = Boolean(enabled);
    for (const mesh of this.meshes) {
      if (this.anatomyDiagnostic) {
        if (!this.originalMaterials.has(mesh)) this.originalMaterials.set(mesh, mesh.material);
        mesh.material = this.diagnosticMaterial;
      } else if (this.originalMaterials.has(mesh)) {
        mesh.material = this.originalMaterials.get(mesh);
      }
    }
  }

  setDiagnosticMode(options = true) {
    const enabled = typeof options === 'object'
      ? options.anatomy !== false || options.fur === false
      : Boolean(options);
    this.setAnatomyDiagnostic(enabled);
  }

  getPettableMeshes() {
    return [...this.pettable];
  }

  setDebug(enabled) {
    this.debug.visible = Boolean(enabled);
  }

  dispose() {
    this.root.removeFromParent();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.assetRoot);
    const disposedGeometries = new Set();
    const disposedTextures = new Set();
    for (const mesh of this.meshes) {
      if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
        disposedGeometries.add(mesh.geometry);
        mesh.geometry.dispose();
      }
    }
    for (const material of this.ownedMaterials) disposeMaterial(material, disposedTextures);
    this.diagnosticMaterial.dispose();
    this.pettable.length = 0;
    this.meshes.length = 0;
    this.actions.clear();
  }
}

export { MODEL_URL, animationDefinition, partFromBoneName };
export default ImportedCatModel;
