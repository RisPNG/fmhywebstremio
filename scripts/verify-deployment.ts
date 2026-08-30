import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function verifyDeploymentContract(): Promise<void> {
  const port = Number(process.env['VERIFY_DEPLOYMENT_PORT'] ?? 55146);
  const dataDirectory = await mkdtemp(join(tmpdir(), 'fmhy-webstream-deployment-'));
  await writeFile(join(dataDirectory, 'sources.json'), '{"records":[],"health":[]}');
  const server = spawn(process.execPath, ['dist/index.js'], { env: { ...process.env, NODE_ENV: 'development', PORT: String(port), RENDER_GIT_COMMIT: 'deployment-contract', EXTRACTABILITY_DATA_DIR: dataDirectory, EXTRACTABILITY_RELOAD_INTERVAL_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  server.stdout.on('data', (chunk) => {
    logs += String(chunk);
  });
  server.stderr.on('data', (chunk) => {
    logs += String(chunk);
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/startup`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    if (!ready) throw new Error(`Addon did not start\n${logs}`);
    for (const path of ['/startup', '/ready']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (!response.ok || (await response.json() as { status?: string }).status !== 'ok') throw new Error(`${path} did not return the expected health response`);
    }
    const manifestResponse = await fetch(`http://127.0.0.1:${port}/manifest.json`);
    const manifest = await manifestResponse.json() as { id?: string; version?: string; name?: string; description?: string; resources?: unknown[]; config?: { key: string }[] };
    if (!manifestResponse.ok || manifest.id !== 'fmhy-webstream' || manifest.version !== '1.3.0' || manifest.name !== 'FMHY\'s Website Streamer' || !manifest.description?.startsWith('Provides video HTTP URLs from streaming websites listed by FMHY.') || !manifest.resources?.length || !manifest.config?.some(field => field.key === 'disableFmhySource_67movies:67movies.net') || !manifest.config?.some(field => field.key === 'disableFmhySource_cinego:cinego.co') || manifest.config.some(field => field.key === 'disableFmhySource_cineby:cineby.at') || manifest.config.some(field => field.key === 'disableFmhySource_7movies:7movies.in') || manifest.config.some(field => /mediaFlow|disableExtractor/i.test(field.key))) throw new Error('Manifest contract is invalid');
    const configuredManifestResponse = await fetch(`http://127.0.0.1:${port}/disabled=67movies:67movies.net/manifest.json`);
    const configuredManifest = await configuredManifestResponse.json() as { config?: { key: string; default?: string }[] };
    if (!configuredManifestResponse.ok || configuredManifest.config?.find(field => field.key === 'disableFmhySource_67movies:67movies.net')?.default !== 'checked') throw new Error('Clean configuration path contract is invalid');
    const configure = await fetch(`http://127.0.0.1:${port}/configure`);
    const configureBody = await configure.text();
    if (!configure.ok || !configure.headers.get('content-type')?.includes('text/html') || !configureBody.includes('FMHY\'s Website Streamer') || !configureBody.includes('Provides video HTTP URLs from streaming websites listed by FMHY.') || !configureBody.includes('>67movies.nl</div>') || !configureBody.includes('>cinego.co</div>') || configureBody.includes('cineby.at') || configureBody.includes('7movies.in') || /torbox|debrid|debris|MediaFlow|WebStreamrMBG/i.test(configureBody)) throw new Error('Configuration endpoint contract is invalid');
    const live = await fetch(`http://127.0.0.1:${port}/live`);
    const liveBody = await live.json() as { status?: string; details?: Record<string, string> };
    if (!live.ok || liveBody.status !== 'ok' || liveBody.details?.['67movies.nl'] !== 'healthy' || liveBody.details?.['cinego.co'] !== 'healthy' || 'cineby.at' in (liveBody.details ?? {}) || '7movies.in' in (liveBody.details ?? {})) throw new Error('Runtime source registry was not loaded');
    const stats = await fetch(`http://127.0.0.1:${port}/stats`);
    if (!stats.ok || (await stats.json() as { revision?: string }).revision !== 'deployment-contract') throw new Error('Deployment revision contract is invalid');
    const stream = await fetch(`http://127.0.0.1:${port}/stream/movie/tmdb%3A27205.json`);
    const streamBody = await stream.json() as { streams?: unknown[] };
    if (!stream.ok || !Array.isArray(streamBody.streams) || JSON.stringify(streamBody).includes('WebStreamrMBG')) throw new Error('Stream route did not reach the Stremio adapter');
    process.stdout.write(`Deployment contract verified at http://127.0.0.1:${port}\n`);
  } finally {
    server.kill('SIGTERM');
  }
}

void verifyDeploymentContract().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
