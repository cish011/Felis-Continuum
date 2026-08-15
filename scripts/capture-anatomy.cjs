const electron = require('electron');

// Some automation hosts expose Electron's binary as a Node runtime first.
// Relaunch once without that flag so this command behaves identically from a
// developer terminal and from Codex/CI.
if (typeof electron === 'string') {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [__filename, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    process.stderr.write(`[anatomy-capture:fatal] ${result.error.message}\n`);
  }
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = electron;
const fs = require('node:fs/promises');
const path = require('node:path');

const CAPTURE_URL = process.env.FELIS_CAPTURE_URL || 'http://127.0.0.1:4173';
const OUTPUT_DIRECTORY = path.resolve(
  __dirname,
  '..',
  process.env.FELIS_ANATOMY_OUTPUT || 'screenshots/anatomy-validation',
);
const READY_TIMEOUT_MS = Number(process.env.FELIS_CAPTURE_TIMEOUT_MS) || 120_000;
const VIEWPORT = Object.freeze({ width: 1600, height: 1000 });
const ALLOW_COMPATIBILITY = process.env.FELIS_CAPTURE_ALLOW_COMPATIBILITY === '1';

const SHOTS = Object.freeze([
  {
    file: '01-side-standing.png',
    label: 'side orthographic-like / standing',
    pose: 'standing',
    direction: [1, 0.025, 0],
    fov: 10.5,
  },
  {
    file: '02-front-standing.png',
    label: 'front orthographic-like / standing',
    pose: 'standing',
    direction: [0, 0.025, 1],
    fov: 10.5,
  },
  {
    file: '03-top-three-quarter-standing.png',
    label: 'top three-quarter / standing',
    pose: 'standing',
    direction: [0.8, 1.25, 1],
    fov: 12,
  },
  {
    file: '04-side-walking.png',
    label: 'side orthographic-like / walking',
    pose: 'walking',
    direction: [1, 0.035, 0],
    fov: 10.5,
  },
  {
    file: '05-three-quarter-walking.png',
    label: 'front three-quarter / walking',
    pose: 'walking',
    direction: [0.85, 0.34, 1],
    fov: 11.5,
  },
]);

const rendererErrors = [];
let fatalFailure = null;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function formatConsoleMessage(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    const details = args[0];
    return {
      level: Number(details.level) || 0,
      message: String(details.message ?? ''),
      line: details.lineNumber ?? details.line ?? 0,
      source: details.sourceId ?? details.source ?? 'renderer',
    };
  }
  return {
    level: Number(args[0]) || 0,
    message: String(args[1] ?? ''),
    line: args[2] ?? 0,
    source: args[3] ?? 'renderer',
  };
}

async function waitForPage(window, expression, label, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (fatalFailure) throw fatalFailure;
    try {
      if (await window.webContents.executeJavaScript(expression, true)) return;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await delay(125);
  }
  const suffix = lastError ? ` Last renderer error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${label} at ${CAPTURE_URL}.${suffix}`);
}

function imageStatistics(image) {
  const size = image.getSize();
  const bitmap = image.toBitmap();
  const pixelCount = size.width * size.height;
  const stride = Math.max(1, Math.floor(pixelCount / 20_000));
  let samples = 0;
  let sum = 0;
  let squareSum = 0;
  let minimum = 255;
  let maximum = 0;
  for (let index = 0; index < pixelCount; index += stride) {
    const offset = index * 4;
    // NativeImage uses BGRA on Windows. Luminance is sufficient for detecting
    // blank, failed, or single-colour captures.
    const luminance = bitmap[offset] * .0722
      + bitmap[offset + 1] * .7152
      + bitmap[offset + 2] * .2126;
    samples++;
    sum += luminance;
    squareSum += luminance * luminance;
    minimum = Math.min(minimum, luminance);
    maximum = Math.max(maximum, luminance);
  }
  const mean = sum / Math.max(1, samples);
  const variance = squareSum / Math.max(1, samples) - mean * mean;
  return {
    width: size.width,
    height: size.height,
    samples,
    luminanceMean: Number(mean.toFixed(2)),
    luminanceDeviation: Number(Math.sqrt(Math.max(0, variance)).toFixed(2)),
    luminanceRange: Number((maximum - minimum).toFixed(2)),
  };
}

async function configureDiagnosticScene(window) {
  return window.webContents.executeJavaScript(`(() => {
    const sim = window.__FELIS__;
    const cat = sim.cat;
    const scene = sim.view.scene;
    const camera = sim.view.camera;
    const vector = () => cat.root.position.clone().set(0, 0, 0);
    const belongsToCat = object => {
      for (let current = object; current; current = current.parent) {
        if (current === cat.root) return true;
      }
      return false;
    };

    // A capture should remain useful while anatomy branches are being rebuilt.
    // If a continuous torso has replaced the legacy three-volume torso but its
    // old breathing/spine presenters are still present, suppress only those
    // incompatible secondary deformations in this renderer process. The source
    // model is never patched or substituted by this utility.
    const presentationCompatibility = [];
    const updateSpineSource = String(cat.updateSpine || '');
    const updateFaceSource = String(cat.updateFace || '');
    const updateLimbsSource = String(cat.updateLimbs || '');
    const setPawSource = String(cat.setPaw || '');
    if (cat.anatomy?.torso
        && (!cat.anatomy?.pelvis || !cat.anatomy?.abdomen || !cat.anatomy?.ribcage)
        && updateSpineSource.includes('this.anatomy.pelvis')) {
      cat.updateSpine = () => undefined;
      cat.updateMicroMotion = () => undefined;
      presentationCompatibility.push('continuous-torso-secondary-deformation-suppressed');
    }
    const eyes = Object.values(cat.eyes || {});
    if (eyes.some(eye => !eye.lid && eye.upperLid && eye.lowerLid)
        && updateFaceSource.includes('eye.lid')) {
      cat.updateFace = () => {
        cat.state.blink = 0;
        cat.state.eyeYaw = 0;
        cat.state.eyePitch = 0;
        cat.state.pupil = .24;
        for (const eye of eyes) {
          eye.rig.rotation.set(0, 0, 0);
          eye.pupil.scale.x = .18;
          eye.pupil.scale.y = .98;
          eye.upperLid.visible = true;
          eye.lowerLid.visible = true;
        }
        if (cat.ears?.left?.rig) {
          cat.ears.left.rig.rotation.y = 0;
          cat.ears.left.rig.rotation.z = -.14;
          cat.ears.left.rig.rotation.x = -.06;
        }
        if (cat.ears?.right?.rig) {
          cat.ears.right.rig.rotation.y = 0;
          cat.ears.right.rig.rotation.z = .14;
          cat.ears.right.rig.rotation.x = -.06;
        }
        cat.updateWhiskers?.();
      };
      presentationCompatibility.push('split-eyelid-neutral-pose-presenter');
    }
    let coercibleLimbLengths = 0;
    if (/solveTwoBone\\(shoulder,\\s*distalTarget,\\s*limb\\.upper,\\s*limb\\.lower/.test(updateLimbsSource)) {
      for (const limb of Object.values(cat.limbs || {})) {
        for (const part of [limb.upper, limb.lower]) {
          if (!part || typeof part !== 'object' || !Number.isFinite(part.baseLength)) continue;
          Object.defineProperty(part, 'valueOf', {
            configurable: true,
            value: () => part.baseLength,
          });
          coercibleLimbLengths++;
        }
      }
    }
    if (coercibleLimbLengths) {
      presentationCompatibility.push('numeric-two-bone-length-coercion');
    }
    if (typeof cat.setPaw === 'function'
        && cat.tmp?.matrix?.clone
        && updateLimbsSource.includes('const inverse=this.tmp.matrix')
        && setPawSource.includes('this.tmp.matrix.makeBasis')) {
      const setPaw = cat.setPaw.bind(cat);
      cat.setPaw = (...args) => {
        // updateLimbs retains tmp.matrix as its root inverse across all four
        // limbs; the current setPaw implementation also uses that scratch slot
        // for a basis matrix. Preserve it so later limbs stay root-local.
        const preservedMatrix = cat.tmp.matrix.clone();
        const result = setPaw(...args);
        cat.tmp.matrix.copy(preservedMatrix);
        return result;
      };
      presentationCompatibility.push('ik-inverse-matrix-preserved-across-paws');
    }

    // Keep the live game's render loop, materials, shaders, IK, and renderer,
    // but stop autonomous systems from replacing the diagnostic pose/camera.
    const updateCat = cat.update.bind(cat);
    cat.update = () => undefined;
    sim.cameraRig.update = () => undefined;
    sim.environment.update = () => undefined;
    sim.view.updateDaylight = () => undefined;
    sim.cameraRig.controls.enabled = false;

    let diagnosticMode = 'manual-shell-suppression';
    if (typeof cat.setDiagnosticMode === 'function') {
      try {
        cat.setDiagnosticMode({ anatomy: true, fur: false, collar: false });
        diagnosticMode = 'cat-api';
      } catch (_) {
        cat.setDiagnosticMode(true);
        diagnosticMode = 'cat-api-boolean';
      }
    }

    // Use one neutral material for every visible surface. Recognition in this
    // gate must come from silhouette and deformation, not coat/detail cues.
    let hiddenFurObjects = 0;
    let flatGrayObjects = 0;
    cat.root.traverse(object => {
      if (/\\-fur\\-\\d+$/.test(object.name || '')) {
        object.visible = false;
        hiddenFurObjects++;
      }
      if (object.isLine || object.isPoints) {
        object.visible = false;
        return;
      }
      if (object.isMesh && cat.diagnosticMaterial) {
        object.material = cat.diagnosticMaterial;
        flatGrayObjects++;
      }
    });
    if (cat.sharedUniforms?.uFurLength) cat.sharedUniforms.uFurLength.value = 0;
    if (cat.guardHairs) {
      cat.guardHairs.visible = false;
      hiddenFurObjects++;
    }
    if (cat.collar) cat.collar.visible = false;
    cat.setDebug?.(false);

    // Retain only one real floor mesh from the habitat. All other scenery and
    // toys are hidden at leaf level so they cannot confuse silhouette review.
    const floor = scene.getObjectByName('living-floor');
    scene.traverse(object => {
      if (object.isLight) {
        object.visible = object === sim.view.ambient
          || object === sim.view.sun
          || object === sim.view.fill;
        return;
      }
      if (!(object.isMesh || object.isLine || object.isPoints || object.isSprite)) return;
      if (belongsToCat(object) || object === floor) return;
      object.visible = false;
    });
    if (floor) {
      floor.visible = true;
      floor.material = floor.material.clone();
      floor.material.name = 'anatomy-validation-floor';
      floor.material.map = null;
      floor.material.normalMap = null;
      floor.material.roughnessMap = null;
      floor.material.aoMap = null;
      floor.material.color?.set?.(0x686b70);
      if ('roughness' in floor.material) floor.material.roughness = .96;
      if ('metalness' in floor.material) floor.material.metalness = 0;
      floor.material.needsUpdate = true;
    }

    scene.background?.set?.(0xaeb4ba);
    scene.fog = null;
    sim.view.renderer.toneMappingExposure = 1.04;
    sim.view.ambient.color.set(0xf1f4f6);
    sim.view.ambient.groundColor.set(0x44484f);
    sim.view.ambient.intensity = 1.42;
    sim.view.sun.color.set(0xffe7cc);
    sim.view.sun.intensity = 2.65;
    sim.view.fill.color.set(0xb9d9f4);
    sim.view.fill.intensity = .72;

    document.body.classList.add('hud-hidden');
    document.body.classList.remove('hud-idle');
    document.querySelectorAll(
      '.hud-element,#context-prompt,#held-item,#reticle,.debug-panel,.settings-panel,#welcome',
    ).forEach(element => element.style.setProperty('display', 'none', 'important'));

    function pointFromLocal(position, heading, x, y, z) {
      const sine = Math.sin(heading);
      const cosine = Math.cos(heading);
      return vector().set(
        position.x + x * cosine + z * sine,
        position.y + y,
        position.z - x * sine + z * cosine,
      );
    }

    function makeMotion(kind) {
      const x = -7.2;
      const z = -5.25;
      const sampled = sim.environment.sampleSurface(x, z);
      const floorY = Number(sampled?.height ?? sampled?.y ?? sampled) || 0;
      const position = vector().set(x, floorY, z);
      const heading = 0;
      const walking = kind === 'walking';
      const specs = walking ? {
        frontLeft:  [-.045, .000, .135, 1, 0],
        frontRight: [ .047, .045, .245, 0, .55],
        hindLeft:   [-.043, .000, -.150, 1, 0],
        hindRight:  [ .043, .000, -.075, 1, 0],
      } : {
        frontLeft:  [-.045, 0, .175, 1, 0],
        frontRight: [ .045, 0, .175, 1, 0],
        hindLeft:   [-.043, 0, -.108, 1, 0],
        hindRight:  [ .043, 0, -.108, 1, 0],
      };
      const feet = {};
      for (const [key, values] of Object.entries(specs)) {
        feet[key] = {
          position: pointFromLocal(position, heading, values[0], values[1], values[2]),
          normal: vector().set(0, 1, 0),
          plantWeight: values[3],
          swing: values[4],
        };
      }
      return {
        position,
        heading,
        velocity: vector().set(0, 0, walking ? .72 : 0),
        speed: walking ? .72 : 0,
        gait: walking ? 'walk' : 'idle',
        gaitPhase: walking ? .82 : 0,
        bodyHeight: walking ? .185 : .19,
        shoulderHeight: walking ? .191 : .19,
        pelvisHeight: walking ? .183 : .19,
        crouch: 0,
        spineBend: 0,
        spineFlex: walking ? -.018 : 0,
        bank: 0,
        headPitch: walking ? -.015 : 0,
        bodyPitch: walking ? .012 : 0,
        tailBalance: walking ? -.08 : 0,
        jumpPhase: 'none',
        narrowness: 0,
        feet,
      };
    }

    const cognition = {
      needs: { fear: 0, stress: .04, energy: .78, affection: .5 },
      perception: {},
      intention: { goal: 'observe' },
    };

    function applyPose(kind) {
      const motion = makeMotion(kind);
      // Damped joints settle from whatever pose the autonomous simulation had
      // reached before capture; the final image is therefore deterministic.
      for (let index = 0; index < 54; index++) {
        updateCat(motion, cognition, 1 / 60, kind === 'walking' ? .82 : 0);
      }
      cat.root.updateMatrixWorld(true);
      return motion;
    }

    function bounds() {
      const minimum = vector().set(Infinity, Infinity, Infinity);
      const maximum = vector().set(-Infinity, -Infinity, -Infinity);
      const corner = vector();
      let contributingObjects = 0;
      const skippedObjects = [];
      cat.root.updateMatrixWorld(true);
      cat.root.traverse(object => {
        if (!object.visible || !(object.isMesh || object.isLine || object.isPoints)) return;
        const geometry = object.geometry;
        if (!geometry?.attributes?.position) return;
        // Geometry bounds are bind-pose coordinates for a SkinnedMesh and can
        // be far below the posed cat. Ask Three.js for the CPU-deformed bound
        // so every validation view frames the actual current silhouette.
        let box;
        if (object.isSkinnedMesh && typeof object.computeBoundingBox === 'function') {
          object.computeBoundingBox();
          box = object.boundingBox;
        } else {
          geometry.computeBoundingBox();
          box = geometry.boundingBox;
        }
        if (!box) return;
        let contributed = false;
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              corner.set(x, y, z).applyMatrix4(object.matrixWorld);
              if (![corner.x, corner.y, corner.z].every(Number.isFinite)) continue;
              minimum.min(corner);
              maximum.max(corner);
              contributed = true;
            }
          }
        }
        if (contributed) contributingObjects++;
        else if (skippedObjects.length < 20) skippedObjects.push(object.name || '(unnamed)');
      });
      if (!contributingObjects) throw new Error('No finite visible cat geometry contributed to framing.');
      return {
        minimum,
        maximum,
        center: minimum.clone().add(maximum).multiplyScalar(.5),
        size: maximum.clone().sub(minimum),
        contributingObjects,
        skippedObjects,
      };
    }

    function frame(directionValues, requestedFov) {
      const box = bounds();
      const direction = vector().set(...directionValues).normalize();
      const viewForward = direction.clone().multiplyScalar(-1);
      let upHint = vector().set(0, 1, 0);
      if (Math.abs(viewForward.dot(upHint)) > .94) upHint = vector().set(0, 0, 1);
      const right = upHint.clone().cross(viewForward).normalize();
      const cameraUp = viewForward.clone().cross(right).normalize();
      const extent = box.size.clone().multiplyScalar(.5);
      const offsets = [];
      for (const x of [-extent.x, extent.x]) {
        for (const y of [-extent.y, extent.y]) {
          for (const z of [-extent.z, extent.z]) offsets.push(vector().set(x, y, z));
        }
      }
      let halfWidth = 0;
      let halfHeight = 0;
      let nearDepth = 0;
      for (const offset of offsets) {
        halfWidth = Math.max(halfWidth, Math.abs(offset.dot(right)));
        halfHeight = Math.max(halfHeight, Math.abs(offset.dot(cameraUp)));
        nearDepth = Math.max(nearDepth, offset.dot(direction));
      }
      const fov = Number(requestedFov) || 11;
      camera.fov = fov;
      const canvas = sim.view.renderer.domElement;
      camera.aspect = Math.max(1, canvas.width) / Math.max(1, canvas.height);
      camera.near = .025;
      camera.far = 120;
      camera.up.copy(cameraUp);
      const requiredVerticalHalf = Math.max(halfHeight, halfWidth / camera.aspect);
      const distance = nearDepth + requiredVerticalHalf / Math.tan(fov * Math.PI / 360) * 1.16;
      camera.position.copy(box.center).addScaledVector(direction, distance);
      camera.lookAt(box.center);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      sim.view.sun.position.copy(box.center).add(vector().set(-3.2, 5.8, 3.7));
      sim.view.sun.target.position.copy(box.center);
      if (!sim.view.sun.target.parent) scene.add(sim.view.sun.target);
      sim.view.sun.target.updateMatrixWorld(true);
      sim.view.fill.position.copy(box.center).add(vector().set(4.5, 2.8, -3.8));
      sim.view.render();
      sim.view.render();
      return {
        center: box.center.toArray(),
        size: box.size.toArray(),
        camera: camera.position.toArray(),
        direction: direction.toArray(),
        fov,
        contributingObjects: box.contributingObjects,
        skippedObjects: box.skippedObjects,
      };
    }

    window.__FELIS_ANATOMY_CAPTURE__ = { applyPose, frame, bounds };
    return {
      diagnosticMode,
      presentationCompatibility: presentationCompatibility.length
        ? presentationCompatibility
        : ['native'],
      hiddenFurObjects,
      flatGrayObjects,
      hasFloor: Boolean(floor),
      catParts: cat.partRecords?.length ?? null,
      shellMaterials: cat.shellMaterials?.length ?? null,
    };
  })()`, true);
}

async function run() {
  await fs.mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const window = new BrowserWindow({
    ...VIEWPORT,
    show: false,
    backgroundColor: '#aeb4ba',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: true,
      backgroundThrottling: false,
    },
  });

  window.webContents.on('console-message', (_event, ...args) => {
    const details = formatConsoleMessage(args);
    const location = details.source ? ` (${details.source}:${details.line})` : '';
    const ignorable = /Electron Security Warning/i.test(details.message)
      || (/THREE\\.WebGLProgram: Program Info Log:/i.test(details.message)
        && /\\bwarning\\b/i.test(details.message)
        && !/\\berror\\b/i.test(details.message));
    const isError = details.level >= 2 && !ignorable;
    if (isError) rendererErrors.push(`${details.message}${location}`);
    process[isError ? 'stderr' : 'stdout'].write(
      `[anatomy-renderer:${isError ? 'error' : details.level ? 'warn' : 'log'}] ${details.message}${location}\n`,
    );
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    fatalFailure = new Error(`Renderer process terminated: ${details.reason} (${details.exitCode})`);
  });
  window.webContents.on('unresponsive', () => {
    fatalFailure = new Error('Renderer became unresponsive.');
  });

  const failedLoad = new Promise((_, reject) => {
    window.webContents.once(
      'did-fail-load',
      (_event, code, description, validatedURL, isMainFrame) => {
        if (isMainFrame) reject(new Error(
          `Could not load ${validatedURL || CAPTURE_URL}: ${description} (${code})`,
        ));
      },
    );
  });

  process.stdout.write(`[anatomy-capture] Loading ${CAPTURE_URL}\n`);
  await Promise.race([window.loadURL(CAPTURE_URL), failedLoad]);
  await waitForPage(
    window,
    `Boolean(
      window.__FELIS__?.view?.renderer?.domElement
      && window.__FELIS__?.cat?.root
      && window.__FELIS__?.locomotion?.getMotionState
      && document.querySelector('#loading-screen')?.classList.contains('closed')
    )`,
    'the live simulation',
  );

  await window.webContents.executeJavaScript(`(() => {
    const welcome = document.querySelector('#welcome');
    if (welcome && !welcome.classList.contains('closed')) {
      document.querySelector('#enter-world')?.click();
    }
    return true;
  })()`, true);
  await delay(1_000);

  const setup = await configureDiagnosticScene(window);
  // Errors emitted by the autonomous pose before the diagnostic harness took
  // control describe work-in-progress integration, not the capture frames.
  // Preserve them in the manifest while keeping post-setup rendering strict.
  await delay(150);
  const preDiagnosticRendererErrors = rendererErrors.splice(0);
  process.stdout.write(`[anatomy-capture] Diagnostic scene ${JSON.stringify(setup)}\n`);
  if (!setup.hasFloor) throw new Error('The living-floor diagnostic ground mesh was not found.');
  if (setup.hiddenFurObjects < 1 && setup.diagnosticMode === 'manual-shell-suppression') {
    throw new Error('No fur layers were found to suppress for smooth-silhouette review.');
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: CAPTURE_URL,
    requestedViewport: VIEWPORT,
    renderMode: 'live Three.js/Electron, smooth base anatomy, deterministic diagnostic light',
    diagnostic: setup,
    preDiagnosticRendererErrors,
    compatibilityAllowed: ALLOW_COMPATIBILITY,
    captures: [],
  };

  let activePose = null;
  let captureDimensions = null;
  for (const shot of SHOTS) {
    if (shot.pose !== activePose) {
      await window.webContents.executeJavaScript(
        `window.__FELIS_ANATOMY_CAPTURE__.applyPose(${JSON.stringify(shot.pose)})`,
        true,
      );
      activePose = shot.pose;
    }
    const framing = await window.webContents.executeJavaScript(
      `window.__FELIS_ANATOMY_CAPTURE__.frame(${JSON.stringify(shot.direction)}, ${shot.fov})`,
      true,
    );
    process.stdout.write(`[anatomy-capture] Framing ${shot.file}: ${JSON.stringify(framing)}\n`);
    await window.webContents.executeJavaScript(`new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 180)));
    })`, true);

    if (fatalFailure) throw fatalFailure;
    const image = await window.webContents.capturePage();
    if (image.isEmpty()) throw new Error(`Electron returned an empty image for ${shot.label}.`);
    const statistics = imageStatistics(image);
    if (statistics.width < 900 || statistics.height < 600) {
      throw new Error(`Capture resolution is too small for anatomy review: ${shot.file} ${statistics.width}x${statistics.height}.`);
    }
    if (!captureDimensions) {
      captureDimensions = { width: statistics.width, height: statistics.height };
      manifest.captureDimensions = captureDimensions;
    } else if (statistics.width !== captureDimensions.width || statistics.height !== captureDimensions.height) {
      throw new Error(`Capture dimensions changed during the run: ${shot.file} ${statistics.width}x${statistics.height}.`);
    }
    if (statistics.luminanceDeviation < 4 || statistics.luminanceRange < 24) {
      throw new Error(`Capture appears blank or flat: ${shot.file} ${JSON.stringify(statistics)}`);
    }
    const bytes = image.toPNG();
    const outputPath = path.join(OUTPUT_DIRECTORY, shot.file);
    // Preserve a failing render for diagnosis; validation still fails and the
    // manifest is never marked passed, but the actual GPU frame is inspectable.
    await fs.writeFile(outputPath, bytes);
    if (bytes.length < 30_000) {
      throw new Error(`Capture is unexpectedly small: ${shot.file} (${bytes.length} bytes).`);
    }
    manifest.captures.push({
      file: shot.file,
      label: shot.label,
      pose: shot.pose,
      bytes: bytes.length,
      statistics,
      framing,
    });
    process.stdout.write(
      `[anatomy-capture] Saved ${shot.file} (${bytes.length} bytes, deviation ${statistics.luminanceDeviation})\n`,
    );
  }

  // Give asynchronous console delivery one final turn before deciding whether
  // the unmodified diagnostic render path is healthy.
  await delay(250);
  manifest.postDiagnosticRendererErrors = [...rendererErrors];
  const compatibilityActive = setup.presentationCompatibility.some(item => item !== 'native');
  manifest.status = rendererErrors.length
    ? 'failed-post-diagnostic-renderer-errors'
    : compatibilityActive || preDiagnosticRendererErrors.length
      ? 'compatibility-assisted-preview'
      : 'passed';
  await fs.writeFile(
    path.join(OUTPUT_DIRECTORY, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  if (rendererErrors.length) {
    throw new Error(`Renderer reported ${rendererErrors.length} post-diagnostic error(s):\n${rendererErrors.join('\n')}`);
  }
  if (!ALLOW_COMPATIBILITY && (compatibilityActive || preDiagnosticRendererErrors.length)) {
    throw new Error(
      `Captured five diagnostic previews, but strict validation failed: ${setup.presentationCompatibility.join(', ')}; `
      + `${preDiagnosticRendererErrors.length} pre-diagnostic renderer error(s). `
      + 'Fix the CatModel integration or set FELIS_CAPTURE_ALLOW_COMPATIBILITY=1 for an explicitly provisional capture.',
    );
  }
  process.stdout.write(`[anatomy-capture] Validated ${manifest.captures.length} screenshots in ${OUTPUT_DIRECTORY}\n`);
  window.destroy();
}

app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

app.whenReady()
  .then(run)
  .then(() => app.exit(0))
  .catch(error => {
    process.stderr.write(`[anatomy-capture:fatal] ${error?.stack || error}\n`);
    app.exit(1);
  });
