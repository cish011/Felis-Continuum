const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const isDev = !app.isPackaged && process.env.FELIS_DEV_URL;
const smokeReportPath = process.env.FELIS_SMOKE_REPORT;
const smokeTimeoutMs = Number(process.env.FELIS_SMOKE_TIMEOUT_MS) || 85_000;

function writeSmokeReport(report, exitCode) {
  if (!smokeReportPath) return;
  try {
    fs.mkdirSync(path.dirname(smokeReportPath), { recursive: true });
    fs.writeFileSync(smokeReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } finally {
    app.exit(exitCode);
  }
}

async function runSmokeCheck(win, diagnostics) {
  const deadline = Date.now() + smokeTimeoutMs;
  while (!win.isDestroyed() && Date.now() < deadline) {
    try {
      const renderer = await win.webContents.executeJavaScript(`(() => {
        const sim = window.__FELIS__;
        const renderer = sim?.view?.renderer;
        const canvas = renderer?.domElement;
        const gl = renderer?.getContext?.();
        if (!sim || !renderer || !canvas || !gl) return null;
        return {
          width: canvas.width,
          height: canvas.height,
          webgl: gl.getParameter(gl.VERSION),
          uptimeMs: performance.now(),
          renderCalls: renderer.info?.render?.calls ?? 0,
          geometries: renderer.info?.memory?.geometries ?? 0,
          loadingClosed: document.querySelector('#loading-screen')?.classList.contains('closed') ?? false,
          desktopBridge: window.felisDesktop?.isDesktop === true,
          cognitionReady: Boolean(sim.cognitionSnapshot),
          physicsBackend: sim.toyPhysics?.backend ?? 'missing',
        };
      })()`, true);
      if (
        renderer?.width > 0
        && renderer?.height > 0
        && renderer.uptimeMs >= 2_000
        && renderer.renderCalls > 0
        && renderer.geometries > 20
        && renderer.loadingClosed
        && renderer.desktopBridge
        && renderer.cognitionReady
        && renderer.physicsBackend === 'rapier-wasm'
      ) {
        const fatalConsoleMessages = diagnostics.console.filter(entry => entry.severity >= 3);
        const failures = [...diagnostics.failures];
        const report = {
          status: fatalConsoleMessages.length || failures.length ? 'failed' : 'passed',
          packaged: app.isPackaged,
          runtime: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
          },
          renderer,
          diagnostics: { failures, fatalConsoleMessages },
        };
        writeSmokeReport(report, report.status === 'passed' ? 0 : 1);
        return;
      }
    } catch (error) {
      diagnostics.failures.push(`Renderer inspection failed: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  writeSmokeReport({
    status: 'failed',
    packaged: app.isPackaged,
    runtime: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    diagnostics: {
      failures: [...diagnostics.failures, 'Timed out waiting for WebGL, cognition, and Rapier runtime readiness.'],
      console: diagnostics.console,
    },
  }, 1);
}

function createWindow() {
  const smokeMode = Boolean(smokeReportPath);
  const diagnostics = { failures: [], console: [] };
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0b0f13',
    title: 'Felis Continuum',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: true,
      backgroundThrottling: !smokeMode,
    },
  });

  win.once('ready-to-show', () => {
    if (!smokeMode) win.show();
  });
  win.webContents.on('console-message', details => {
    if (!smokeMode) return;
    const severity = { debug: 0, info: 1, warning: 2, error: 3 }[details.level] ?? 1;
    diagnostics.console.push({
      severity,
      level: details.level,
      message: details.message,
      lineNumber: details.lineNumber,
      sourceId: details.sourceId,
    });
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (smokeMode && isMainFrame) {
      diagnostics.failures.push(`Load failed (${errorCode}): ${errorDescription} at ${validatedURL}`);
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    if (smokeMode) diagnostics.failures.push(`Renderer exited: ${details.reason} (${details.exitCode}).`);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  let loadPromise;
  if (isDev) {
    loadPromise = win.loadURL(process.env.FELIS_DEV_URL);
  } else {
    loadPromise = win.loadFile(path.join(__dirname, '..', 'dist-web', 'index.html'));
  }
  if (smokeMode) {
    loadPromise
      .then(() => runSmokeCheck(win, diagnostics))
      .catch(error => writeSmokeReport({
        status: 'failed',
        packaged: app.isPackaged,
        runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
        diagnostics: { failures: [...diagnostics.failures, `Window load rejected: ${error.message}`] },
      }, 1));
  }
  return win;
}

app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
if (process.platform === 'win32') app.setAppUserModelId('com.feliscontinuum.desktop');
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
