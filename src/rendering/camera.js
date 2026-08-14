import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { damp } from '../core/math.js';

export class CameraRig {
  constructor(camera, domElement, environment) {
    this.camera = camera;
    this.domElement = domElement;
    this.environment = environment;
    this.mode = 'follow';
    this.target = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.freeVelocity = new THREE.Vector3();
    this.keys = new Set();
    this.userOrbiting = false;

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .07;
    this.controls.enablePan = false;
    this.controls.minDistance = .75;
    this.controls.maxDistance = 15;
    this.controls.maxPolarAngle = Math.PI * .485;
    this.controls.minPolarAngle = .16;
    this.controls.target.set(0, .5, 0);
    this.controls.addEventListener('start', () => { this.userOrbiting = true; });
    this.controls.addEventListener('end', () => { this.userOrbiting = false; });

    this.onKeyDown = event => this.keys.add(event.code);
    this.onKeyUp = event => this.keys.delete(event.code);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  setMode(mode) {
    if (!['follow', 'close', 'free'].includes(mode)) return;
    this.mode = mode;
    this.controls.enablePan = mode === 'free';
    this.controls.maxDistance = mode === 'close' ? 2.4 : 15;
    this.controls.minDistance = mode === 'close' ? .36 : .75;
    if (mode === 'close') {
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(direction, 1.18).add(new THREE.Vector3(0, .08, 0));
    }
  }

  update(dt, catMotion) {
    const catPosition = catMotion?.position ?? this.target;
    const catHeight = catMotion?.bodyHeight ?? .5;
    if (this.mode === 'follow' || this.mode === 'close') {
      this.target.set(catPosition.x, catPosition.y + catHeight * .78, catPosition.z);
      const rate = this.mode === 'close' ? 8 : 3.4;
      this.controls.target.x = damp(this.controls.target.x, this.target.x, rate, dt);
      this.controls.target.y = damp(this.controls.target.y, this.target.y, rate, dt);
      this.controls.target.z = damp(this.controls.target.z, this.target.z, rate, dt);
    } else {
      this.updateFreeCamera(dt);
    }
    this.preventFloorClipping();
    this.controls.update();
  }

  updateFreeCamera(dt) {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const desired = new THREE.Vector3();
    if (this.keys.has('KeyW')) desired.add(forward);
    if (this.keys.has('KeyS')) desired.sub(forward);
    if (this.keys.has('KeyA')) desired.add(right);
    if (this.keys.has('KeyD')) desired.sub(right);
    if (this.keys.has('Space')) desired.y += 1;
    if (this.keys.has('ShiftLeft')) desired.y -= 1;
    if (desired.lengthSq()) desired.normalize().multiplyScalar(4.2);
    this.freeVelocity.lerp(desired, 1 - Math.exp(-7 * dt));
    const movement = this.freeVelocity.clone().multiplyScalar(dt);
    this.camera.position.add(movement);
    this.controls.target.add(movement);
  }

  preventFloorClipping() {
    const surface = this.environment?.sampleSurface?.(this.camera.position.x, this.camera.position.z);
    const floorY = typeof surface === 'number' ? surface : surface?.height ?? surface?.y ?? 0;
    if (this.camera.position.y < floorY + .16) this.camera.position.y = floorY + .16;
    this.camera.position.x = Math.max(-12, Math.min(26, this.camera.position.x));
    this.camera.position.z = Math.max(-14, Math.min(17, this.camera.position.z));
  }

  setEnabled(enabled) { this.controls.enabled = enabled; }

  dispose() {
    this.controls.dispose();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
