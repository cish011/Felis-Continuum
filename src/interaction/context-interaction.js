import * as THREE from 'three';
import { events } from '../core/events.js';

const PART_LABELS = {
  head: 'head', muzzle: 'cheek', cheek: 'cheek', neck: 'neck', chest: 'chest',
  back: 'back', torso: 'side', belly: 'belly', rump: 'lower back',
  tail: 'tail', paw: 'paw', frontLeg: 'front leg', hindLeg: 'hind leg', ear: 'ear',
};

function interactionData(object) {
  let current = object;
  while (current) {
    if (current.userData?.catPart) {
      return {
        type: 'cat', action: 'pet', part: current.userData.catPart,
        label: `Stroke ${PART_LABELS[current.userData.catPart] ?? current.userData.catPart}`,
        object: current,
      };
    }
    if (current.userData?.interaction) {
      const data = current.userData.interaction;
      return { type: data.type ?? 'world', action: data.action ?? data.type, label: data.label ?? 'Interact', object: current, ...data };
    }
    if (current.userData?.toyType || current.userData?.toy) {
      const type = current.userData.toyType ?? current.userData.toy;
      return { type: 'toy', action: 'pickup-toy', toyType: type, label: `Pick up ${current.userData.label ?? type}`, object: current };
    }
    current = current.parent;
  }
  return null;
}

export class ContextInteraction {
  constructor({ camera, domElement, ui, cameraRig }) {
    this.camera = camera;
    this.domElement = domElement;
    this.ui = ui;
    this.cameraRig = cameraRig;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 5.5;
    this.pointer = new THREE.Vector2();
    this.sources = [];
    this.hover = null;
    this.pet = null;
    this.held = null;
    this.lastPetSample = 0;
    this.downAt = null;

    this.onPointerMove = event => this.pointerMove(event);
    this.onPointerDown = event => this.pointerDown(event);
    this.onPointerUp = event => this.pointerUp(event);
    this.onPointerLeave = event => this.pointerUp(event);
    this.onKeyDown = event => this.keyDown(event);
    domElement.addEventListener('pointermove', this.onPointerMove, true);
    domElement.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    domElement.addEventListener('pointerleave', this.onPointerLeave, true);
    window.addEventListener('keydown', this.onKeyDown);
  }

  setSources(...collections) {
    this.sources = collections.flat(Infinity).filter(object => object?.isObject3D);
  }

  addSources(collection) {
    for (const object of collection ?? []) if (object?.isObject3D && !this.sources.includes(object)) this.sources.push(object);
  }

  setHeld(item) {
    this.held = item;
    this.ui.setHeld(item?.label ?? null);
    this.refreshPrompt();
  }

  pointerMove(event) {
    const rect = this.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    this.pointer.set(x / rect.width * 2 - 1, -(y / rect.height) * 2 + 1);
    this.ui.setPointer(x, y);
    this.updateRaycast();
    if (this.pet) this.samplePet(event);
  }

  updateRaycast() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.sources, true).find(item => interactionData(item.object));
    const data = hit ? interactionData(hit.object) : null;
    this.hover = data ? { ...data, hit } : null;
    this.refreshPrompt();
  }

  refreshPrompt() {
    if (this.pet) return;
    if (!this.hover) {
      if (this.held?.type === 'toy') this.ui.showContext(`Throw ${this.held.label}`);
      else this.ui.hideContext();
      return;
    }
    const hover = this.hover;
    if (hover.type === 'cat') {
      if (this.held?.type === 'treat') this.ui.showContext('Offer the held treat');
      else if (this.held?.type === 'toy') this.ui.showContext('Present the toy nearby');
      else this.ui.showContext(`${hover.label} · Shift+E to pick up`);
    } else {
      this.ui.showContext(hover.label);
    }
  }

  pointerDown(event) {
    if (event.button !== 0) return;
    this.updateRaycast();
    this.downAt = { x: event.clientX, y: event.clientY, time: performance.now() };
    if (this.hover?.type === 'cat' && !this.held && !event.shiftKey) {
      event.preventDefault(); event.stopPropagation();
      this.beginPet(event);
      return;
    }
    if (this.hover || this.held) {
      event.preventDefault(); event.stopPropagation();
      this.activate(event);
    }
  }

  pointerUp(event) {
    if (!this.pet) return;
    event.preventDefault(); event.stopPropagation();
    const duration = (performance.now() - this.pet.startedAt) / 1000;
    events.emit('pet-end', { duration, part: this.pet.part });
    this.pet = null;
    this.ui.setPetting(false);
    this.cameraRig?.setEnabled(true);
    this.refreshPrompt();
  }

  beginPet(event) {
    this.pet = {
      part: this.hover.part,
      startedAt: performance.now(),
      lastPoint: this.hover.hit.point.clone(),
      distance: 0,
    };
    this.lastPetSample = performance.now();
    this.ui.setPetting(true);
    this.ui.hideContext();
    this.cameraRig?.setEnabled(false);
    this.domElement.setPointerCapture?.(event.pointerId);
    events.emit('pet-start', { part: this.pet.part, point: this.hover.hit.point });
  }

  samplePet(event) {
    if (!this.hover || this.hover.type !== 'cat') return;
    const now = performance.now();
    const dt = Math.max(.016, (now - this.lastPetSample) / 1000);
    const movement = this.hover.hit.point.distanceTo(this.pet.lastPoint);
    this.pet.distance += movement;
    this.pet.lastPoint.copy(this.hover.hit.point);
    this.pet.part = this.hover.part;
    this.lastPetSample = now;
    const speed = Math.min(1, movement / dt / 1.2);
    events.emit('pet-stroke', { part: this.pet.part, point: this.hover.hit.point, speed, distance: this.pet.distance, dt });
  }

  activate(event = {}) {
    if (this.hover?.type === 'cat' && event.shiftKey) {
      events.emit('world-interaction', { action: 'pickup-cat', target: this.hover, hit: this.hover.hit });
      return;
    }
    if (this.hover?.type === 'cat' && this.held) {
      events.emit('world-interaction', { action: this.held.type === 'treat' ? 'offer-treat' : 'present-held', target: this.hover, held: this.held, hit: this.hover.hit });
      return;
    }
    if (this.hover) {
      events.emit('world-interaction', { action: this.hover.action, target: this.hover, held: this.held, hit: this.hover.hit });
      return;
    }
    if (this.held) {
      events.emit('world-interaction', {
        action: this.held.type === 'toy' ? 'throw-held' : 'use-held',
        held: this.held,
        ray: this.raycaster.ray.clone(),
      });
    }
  }

  keyDown(event) {
    if (event.code === 'KeyE' && (this.hover || this.held)) {
      event.preventDefault();
      this.activate(event);
    } else if (event.code === 'KeyR' && this.held) {
      events.emit('world-interaction', { action: 'drop-held', held: this.held, ray: this.raycaster.ray.clone() });
    } else if (event.code === 'Escape' && this.held) {
      events.emit('world-interaction', { action: 'cancel-held', held: this.held });
    }
  }

  dispose() {
    this.domElement.removeEventListener('pointermove', this.onPointerMove, true);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    this.domElement.removeEventListener('pointerleave', this.onPointerLeave, true);
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
