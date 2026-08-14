import * as THREE from 'three';

export class HabitatRenderer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb7c6c7);
    this.scene.fog = new THREE.FogExp2(0xb7c6c7, .012);
    this.camera = new THREE.PerspectiveCamera(48, 1, .04, 120);
    this.camera.position.set(7.2, 3.6, 8.4);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;
    container.appendChild(this.renderer.domElement);

    this.ambient = new THREE.HemisphereLight(0xdce9ee, 0x48513e, 1.6);
    this.ambient.position.set(0, 12, 0);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffe0ad, 3.15);
    this.sun.position.set(-8, 14, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -22;
    this.sun.shadow.camera.right = 22;
    this.sun.shadow.camera.top = 18;
    this.sun.shadow.camera.bottom = -18;
    this.sun.shadow.camera.near = .5;
    this.sun.shadow.camera.far = 48;
    this.sun.shadow.bias = -.00012;
    this.sun.shadow.normalBias = .022;
    this.scene.add(this.sun);

    this.fill = new THREE.DirectionalLight(0x9fc0e0, .52);
    this.fill.position.set(12, 8, -11);
    this.scene.add(this.fill);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  updateDaylight(hour) {
    const angle = ((hour - 6) / 24) * Math.PI * 2;
    const daylight = Math.max(.025, Math.sin(angle));
    const twilight = Math.max(0, 1 - Math.abs(hour - 6) / 2.5, 1 - Math.abs(hour - 18) / 2.5);
    this.sun.position.set(Math.cos(angle) * 16, Math.max(1.5, Math.sin(angle) * 18), Math.sin(angle * .83) * 10);
    this.sun.intensity = .08 + daylight * 3.0;
    this.sun.color.set(daylight > .15 ? 0xffdfaa : 0xff9b72);
    this.ambient.intensity = .32 + daylight * 1.28;
    this.fill.intensity = .28 + twilight * .35;
    const day = new THREE.Color(0xb5c9cc);
    const night = new THREE.Color(0x111c29);
    const sky = night.clone().lerp(day, Math.pow(daylight, .48));
    if (twilight > .15) sky.lerp(new THREE.Color(0x8f6e72), twilight * .18);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.renderer.toneMappingExposure = .78 + daylight * .34;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
