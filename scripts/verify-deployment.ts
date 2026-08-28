import { spawn } from 'node:child_process';

async function verifyDeploymentContract(): Promise<void> {
  const port = Number(process.env['VERIFY_DEPLOYMENT_PORT'] ?? 55146);
  const server = spawn(process.execPath, ['dist/index.js'], { env: { ...process.env, NODE_ENV: 'development', PORT: String(port), EXTRACTABILITY_RELOAD_INTERVAL_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const manifest = await manifestResponse.json() as { id?: string; version?: string; name?: string; description?: string; resources?: unknown[] };
    if (!manifestResponse.ok || manifest.id !== 'fmhy-webstream' || manifest.version !== '1.0.0' || manifest.name !== 'FMHY\'s Website Streamer' || !manifest.description?.startsWith('Provides video HTTP URLs from streaming websites listed by FMHY.') || !manifest.resources?.length) throw new Error('Manifest contract is invalid');
    const configure = await fetch(`http://127.0.0.1:${port}/configure`);
    const configureBody = await configure.text();
    if (!configure.ok || !configure.headers.get('content-type')?.includes('text/html') || !configureBody.includes('FMHY\'s Website Streamer') || !configureBody.includes('Provides video HTTP URLs from streaming websites listed by FMHY.') || /torbox|debrid|debris/i.test(configureBody)) throw new Error('Configuration endpoint contract is invalid');
    const stream = await fetch(`http://127.0.0.1:${port}/%7B%7D/stream/movie/tmdb%3A27205.json`);
    const streamBody = await stream.json() as { streams?: unknown[] };
    if (!stream.ok || !Array.isArray(streamBody.streams)) throw new Error('Stream route did not reach the Stremio adapter');
    process.stdout.write(`Deployment contract verified at http://127.0.0.1:${port}\n`);
  } finally {
    server.kill('SIGTERM');
  }
}

void verifyDeploymentContract().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
