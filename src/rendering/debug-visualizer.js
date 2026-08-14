import * as THREE from 'three';

const FOOT_NAMES = ['frontLeft', 'frontRight', 'hindLeft', 'hindRight'];

export class DebugVisualizer {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'Simulation diagnostics';
    this.group.visible = false;
    scene.add(this.group);
    this.enabled = false;

    const pathMaterial = new THREE.LineBasicMaterial({ color: 0xd6ff70, transparent: true, opacity: .9, depthTest: false });
    this.path = new THREE.Line(new THREE.BufferGeometry(), pathMaterial);
    this.path.renderOrder = 100;
    this.group.add(this.path);

    this.velocity = new THREE.ArrowHelper(new THREE.Vector3(0,0,1), new THREE.Vector3(), 1, 0x76dfff, .15, .08);
    this.group.add(this.velocity);
    this.attentionLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd876, dashSize:.12, gapSize:.07, depthTest:false }));
    this.attentionLine.renderOrder = 101;
    this.group.add(this.attentionLine);

    this.pawMarkers = FOOT_NAMES.map((name, index) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(.035, 10, 7),
        new THREE.MeshBasicMaterial({ color: index < 2 ? 0x64dbff : 0xff72cb, depthTest:false })
      );
      marker.renderOrder = 102;
      marker.userData.name = name;
      this.group.add(marker);
      return marker;
    });
    this.memoryMarkers = [];
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.group.visible = this.enabled;
  }

  update(motion, cognition, path = []) {
    if (!this.enabled || !motion) return;
    const points = path.map(point => new THREE.Vector3(point.x, (point.y ?? 0) + .035, point.z));
    this.path.geometry.dispose();
    this.path.geometry = new THREE.BufferGeometry().setFromPoints(points.length > 1 ? points : [motion.position, motion.position]);

    const speed = motion.velocity?.length?.() ?? motion.speed ?? 0;
    const direction = motion.velocity?.clone?.().normalize() ?? new THREE.Vector3(Math.sin(motion.heading), 0, Math.cos(motion.heading));
    this.velocity.position.copy(motion.position).add(new THREE.Vector3(0, .55, 0));
    this.velocity.setDirection(direction.lengthSq() ? direction : new THREE.Vector3(0,0,1));
    this.velocity.setLength(Math.max(.05, speed), .14, .07);

    FOOT_NAMES.forEach((name, i) => {
      const foot = motion.feet?.[name];
      if (foot?.position) this.pawMarkers[i].position.copy(foot.position);
      this.pawMarkers[i].visible = Boolean(foot?.position);
      this.pawMarkers[i].material.opacity = .28 + (foot?.plantWeight ?? 0) * .72;
      this.pawMarkers[i].material.transparent = true;
    });

    const attention = cognition?.perception?.attention?.position;
    const head = motion.position.clone().add(new THREE.Vector3(0, .72, 0));
    const target = attention ? new THREE.Vector3(attention.x, attention.y ?? .25, attention.z) : head;
    this.attentionLine.geometry.dispose();
    this.attentionLine.geometry = new THREE.BufferGeometry().setFromPoints([head, target]);
    this.attentionLine.computeLineDistances();
    this.syncMemoryMarkers(cognition?.memories ?? []);
  }

  syncMemoryMarkers(memories) {
    const visible = memories.filter(memory => memory.confidence > .14).slice(0, 22);
    while (this.memoryMarkers.length < visible.length) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(.08, .105, 16),
        new THREE.MeshBasicMaterial({ color:0xba9cff, transparent:true, opacity:.55, side:THREE.DoubleSide, depthTest:false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 99;
      this.group.add(ring);
      this.memoryMarkers.push(ring);
    }
    this.memoryMarkers.forEach((marker, index) => {
      const memory = visible[index];
      marker.visible = Boolean(memory);
      if (!memory) return;
      marker.position.set(memory.position.x, (memory.position.y ?? 0) + .025, memory.position.z);
      marker.scale.setScalar(.7 + memory.confidence * .8);
      marker.material.opacity = .15 + memory.confidence * .5;
    });
  }

  dispose() {
    this.group.traverse(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose?.();
    });
    this.group.removeFromParent();
  }
}
