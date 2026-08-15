const { spawn } = require('node:child_process');
const { mkdir, readFile, rm } = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const executable = path.resolve(
  projectRoot,
  process.argv[2] || path.join('release', 'Felis Continuum-win32-x64', 'Felis Continuum.exe'),
);
const reportPath = path.resolve(projectRoot, 'release', 'package-smoke-report.json');
const timeoutMs = Number(process.env.FELIS_SMOKE_TIMEOUT_MS) || 90_000;

async function run() {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await rm(reportPath, { force: true });

  const environment = {
    ...process.env,
    FELIS_SMOKE_REPORT: reportPath,
    FELIS_SMOKE_TIMEOUT_MS: String(Math.max(10_000, timeoutMs - 5_000)),
  };
  // Capture and CI sessions sometimes set this globally. It would turn the
  // Electron executable into a plain Node process and invalidate this test.
  delete environment.ELECTRON_RUN_AS_NODE;

  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Packaged application did not finish its smoke check within ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });

  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Packaged application exited without a readable smoke report `
      + `(code ${result.code}, signal ${result.signal ?? 'none'}). ${stderr.trim()} ${error.message}`,
    );
  }

  if (result.code !== 0 || report.status !== 'passed' || report.packaged !== true) {
    if (report.packaged !== true) report.packagingError = 'The tested runtime was not app.isPackaged.';
    throw new Error(`Packaged runtime smoke check failed:\n${JSON.stringify(report, null, 2)}\n${stderr.trim()}`);
  }

  console.log(
    `Packaged runtime verified: Electron ${report.runtime.electron}, ${report.renderer.webgl}, `
    + `${report.renderer.width}x${report.renderer.height}, ${report.renderer.geometries} GPU geometries, `
    + 'cognition worker active, Rapier WASM active, clean renderer console.',
  );
  console.log(`Smoke report: ${reportPath}`);
}

run().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
