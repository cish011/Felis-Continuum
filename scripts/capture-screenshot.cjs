const electron = require('electron');
// Codex and a few CI runners set ELECTRON_RUN_AS_NODE globally. In that mode,
// Electron deliberately behaves like plain Node and the desktop APIs are not
// exposed. Relaunch the same script once with that flag removed so `npm run
// screenshot` remains reliable in both a developer terminal and automation.
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
    process.stderr.write(`[capture:fatal] Could not launch Electron: ${result.error.message}\n`);
  }
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = electron;
const fs = require('node:fs/promises');
const path = require('node:path');

const CAPTURE_URL = process.env.FELIS_CAPTURE_URL || 'http://127.0.0.1:4173';
const OUTPUT_PATH = path.resolve(__dirname, '..', 'screenshots', 'cat-closeup.png');
const READY_TIMEOUT_MS = Number(process.env.FELIS_CAPTURE_TIMEOUT_MS) || 120_000;

const rendererErrors = [];
let fatalFailure = null;

function recordFailure(kind, message) {
  const detail = `${kind}: ${message}`;
  fatalFailure ||= new Error(detail);
  process.stderr.write(`[capture:error] ${detail}\n`);
}

function formatConsoleMessage(args) {
  // Electron 37 emits one details object. Older Electron versions emitted
  // positional level/message/line/sourceId arguments; accepting both keeps the
  // capture utility useful after dependency upgrades or downgrades.
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
  let lastEvaluationError = null;
  while (Date.now() < deadline) {
    if (fatalFailure) throw fatalFailure;
    try {
      if (await window.webContents.executeJavaScript(expression, true)) return;
      lastEvaluationError = null;
    } catch (error) {
      lastEvaluationError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  const suffix = lastEvaluationError ? ` Last evaluation error: ${lastEvaluationError.message}` : '';
  throw new Error(`Timed out waiting for ${label} at ${CAPTURE_URL}.${suffix}`);
}

async function capture() {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });

  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    backgroundColor: '#101419',
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
    const warningOnly = /Electron Security Warning/i.test(details.message)
      || (/THREE\.WebGLProgram: Program Info Log:/i.test(details.message)
        && /\bwarning\b/i.test(details.message)
        && !/\berror\b/i.test(details.message));
    const isError = details.level >= 2 && !warningOnly;
    const prefix = isError ? 'error' : details.level >= 1 ? 'warn' : 'log';
    process[isError ? 'stderr' : 'stdout'].write(
      `[renderer:${prefix}] ${details.message}${location}\n`,
    );
    if (isError) rendererErrors.push(`${details.message}${location}`);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    recordFailure('renderer process terminated', `${details.reason} (exit ${details.exitCode})`);
  });
  window.webContents.on('unresponsive', () => recordFailure('renderer', 'window became unresponsive'));

  const failedLoad = new Promise((_, reject) => {
    window.webContents.once('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      reject(new Error(`Could not load ${validatedURL || CAPTURE_URL}: ${description} (${code})`));
    });
  });

  process.stdout.write(`[capture] Loading ${CAPTURE_URL}\n`);
  await Promise.race([window.loadURL(CAPTURE_URL), failedLoad]);

  await waitForPage(
    window,
    `Boolean(
      window.__FELIS__?.view?.renderer?.domElement &&
      window.__FELIS__?.cat?.root &&
      window.__FELIS__?.locomotion?.getMotionState &&
      document.querySelector('#loading-screen')?.classList.contains('closed')
    )`,
    'the simulation scene',
  );

  // Enter through the real UI so the capture exercises the same initialization
  // path as a player. Clicking is idempotent because the welcome card closes.
  await window.webContents.executeJavaScript(`(() => {
    const welcome = document.querySelector('#welcome');
    if (welcome && !welcome.classList.contains('closed')) {
      document.querySelector('#enter-world')?.click();
    }
    return true;
  })()`, true);
  await waitForPage(
    window,
    `document.querySelector('#welcome')?.classList.contains('closed') === true`,
    'the habitat entrance transition',
    15_000,
  );

  // Give procedural pose, coat shells, shadows, and post-load physics enough
  // rendered frames to settle before choosing the camera.
  await new Promise(resolve => setTimeout(resolve, 1_800));

  const framing = await window.webContents.executeJavaScript(`(() => {
    const sim = window.__FELIS__;
    const motion = sim.locomotion.getMotionState();
    const camera = sim.view.camera;
    const rig = sim.cameraRig;
    const p = motion.position;
    const heading = Number(motion.heading) || 0;
    const bodyHeight = Number(motion.bodyHeight) || 0.46;

    // A low three-quarter view looks slightly back along the animal's forward
    // axis. It keeps the eyes, shoulder structure, coat silhouette, and paws in
    // view while leaving enough habitat context to read as an in-game image.
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);
    const targetY = p.y + bodyHeight * 0.72;
    const target = p.clone();
    target.y = targetY;

    const candidates = [
      [1.38, 0.62], [1.38, -0.62],
      [0.42, 1.48], [0.42, -1.48],
      [-1.25, 0.68], [-1.25, -0.68],
    ].map(([forward, right]) => {
      const point = p.clone();
      point.x += forwardX * forward + rightX * right;
      point.z += forwardZ * forward + rightZ * right;
      point.y = targetY + 0.29;
      return point;
    });

    const belongsToCat = object => {
      for (let current = object; current; current = current.parent) {
        if (current === sim.cat.root) return true;
      }
      return false;
    };
    const raycaster = sim.interaction.raycaster;
    const previousFar = raycaster.far;
    let selected = candidates[0];
    let selectedVisible = false;
    let bestScore = -Infinity;
    for (let index = 0; index < candidates.length; index++) {
      const point = candidates[index];
      const direction = target.clone().sub(point);
      const distance = direction.length();
      raycaster.set(point, direction.normalize());
      raycaster.near = 0.015;
      raycaster.far = distance + 0.16;
      const first = raycaster.intersectObjects(sim.view.scene.children, true)
        .find(hit => hit.object.visible && hit.distance > 0.015);
      const seesCat = Boolean(first && belongsToCat(first.object));
      // Prefer an unobstructed cat hit, then the conventional front-right view.
      // A ray with no hit is a safer fallback than one known to cross a wall.
      const score = seesCat ? 100 - index : first ? -first.distance - index : 20 - index;
      if (score > bestScore) {
        bestScore = score;
        selected = point;
        selectedVisible = seesCat;
      }
    }
    raycaster.near = 0;
    raycaster.far = previousFar;

    rig.setMode('free');
    rig.controls.enabled = false;
    rig.controls.target.set(p.x, targetY, p.z);
    camera.position.copy(selected);
    camera.fov = 44;
    camera.near = 0.025;
    camera.updateProjectionMatrix();
    camera.lookAt(p.x, targetY, p.z);
    camera.updateMatrixWorld(true);

    document.body.classList.add('hud-hidden');
    document.body.classList.remove('hud-idle');
    document.querySelectorAll('.hud-element,#context-prompt,#held-item,#reticle,.debug-panel,.settings-panel')
      .forEach(element => element.style.setProperty('display', 'none', 'important'));

    return {
      position: [p.x, p.y, p.z],
      heading,
      camera: [camera.position.x, camera.position.y, camera.position.z],
      unobstructed: selectedVisible,
    };
  })()`, true);
  process.stdout.write(`[capture] Framed cat at ${JSON.stringify(framing)}\n`);
  if (!framing.unobstructed) {
    throw new Error(`No unobstructed camera-to-cat angle was available: ${JSON.stringify(framing)}`);
  }

  await window.webContents.executeJavaScript(`new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 350)));
  })`, true);

  const health = await window.webContents.executeJavaScript(`(() => {
    const sim = window.__FELIS__;
    const canvas = sim?.view?.renderer?.domElement;
    const renderInfo = sim?.view?.renderer?.info?.render;
    return {
      hasSimulation: Boolean(sim),
      catVisible: Boolean(sim?.cat?.root?.visible && sim.cat.root.parent),
      canvasWidth: canvas?.width || 0,
      canvasHeight: canvas?.height || 0,
      frame: renderInfo?.frame || 0,
      loadingClosed: document.querySelector('#loading-screen')?.classList.contains('closed') === true,
    };
  })()`, true);

  if (!health.hasSimulation || !health.catVisible || health.canvasWidth < 100 || health.canvasHeight < 100 || !health.loadingClosed) {
    throw new Error(`Scene health check failed: ${JSON.stringify(health)}`);
  }

  const image = await window.webContents.capturePage();
  if (image.isEmpty()) throw new Error('Electron returned an empty capture image.');
  await fs.writeFile(OUTPUT_PATH, image.toPNG());
  process.stdout.write(`[capture] Saved ${OUTPUT_PATH} (${image.getSize().width}x${image.getSize().height})\n`);

  // A console error means the image may conceal a shader, worker, or runtime
  // failure. Save the diagnostic image, but return a failure status for CI/use.
  if (rendererErrors.length) {
    throw new Error(`Renderer reported ${rendererErrors.length} error(s):\n${rendererErrors.join('\n')}`);
  }

  window.destroy();
}

app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

app.whenReady()
  .then(capture)
  .then(() => app.exit(0))
  .catch(error => {
    process.stderr.write(`[capture:fatal] ${error?.stack || error}\n`);
    // app.quit() may normalize process.exitCode on some Electron builds. Using
    // app.exit(1) guarantees that CI and npm receive the diagnostic failure.
    app.exit(1);
  });
