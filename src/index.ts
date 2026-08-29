import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import express, { NextFunction, Request, Response } from 'express';
// eslint-disable-next-line import/no-named-as-default
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import { RuntimeStremioAdapter } from './addon/stremio-adapter';
import { ConfigureController, ManifestController, StreamController } from './controller';
import { RuntimeStreamEngine, StremioMediaResolver } from './engine/core';
import { defaultFamilyHealthCorpora, DependencyGraph, FamilyHealthRunner, JsonDependencyStore, type SourceFamily } from './engine/health';
import { StreamSelector } from './engine/protocols';
import { deploymentSourceRegistry, JsonSourceRegistryStore, MatcherRegistry, RegistryExtractorLookup, SourceRegistry, type SourceRegistryState } from './engine/registry';
import { ExtractionResolver } from './engine/resolver';
import { TransportDirector } from './engine/transport';
import { extractorRegistry as runtimeExtractorRegistry } from './extractors/registry.generated';
import { CinegoFamily } from './extractors/sources/cinego-family';
import { CinriftFamily } from './extractors/sources/cinrift-family';
import { DooplayFamily } from './extractors/sources/dooplay-family';
import { PStreamFamily } from './extractors/sources/pstream-family';
import { envGet, envIsProd } from './utils';

if (envIsProd()) {
  console.log = console.warn = console.error = console.info = console.debug = () => { /* disable in favor of logger */ };
}

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.cli(),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, id }) => `${timestamp} ${level} ${id}: ${message}`)),
    }),
  ],
});

process.on('uncaughtException', (error: Error) => {
  const msg = `Uncaught exception caught: ${error}, cause: ${error.cause}, stack: ${error.stack}`;
  console.error(msg);
  logger.error(msg);
  appendFileSync('/tmp/fmhy-webstream-crash.log', `${new Date().toISOString()} ${msg}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (error: Error) => {
  const msg = `Unhandled rejection: ${error}, cause: ${error.cause}, stack: ${error.stack}`;
  console.error(msg);
  logger.error(msg);
  appendFileSync('/tmp/fmhy-webstream-crash.log', `${new Date().toISOString()} ${msg}\n`);
});

process.on('SIGTERM', () => {
  const msg = 'SIGTERM received';
  console.error(msg);
  appendFileSync('/tmp/fmhy-webstream-crash.log', `${new Date().toISOString()} ${msg}\n`);
  process.exit(0);
});

process.on('SIGINT', () => {
  const msg = 'SIGINT received';
  console.error(msg);
  appendFileSync('/tmp/fmhy-webstream-crash.log', `${new Date().toISOString()} ${msg}\n`);
  process.exit(0);
});

const addon = express();
addon.set('trust proxy', true);
addon.get('/', (_req, res) => {
  res.redirect('/configure');
});

if (envIsProd()) {
  addon.use(rateLimit({ windowMs: 60 * 1000, limit: 30 }));
}

addon.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Request-ID', randomUUID());

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (envIsProd()) {
    res.setHeader('Cache-Control', 'public, max-age=10');
  }

  next();
});

const runtimeTransport = new TransportDirector();
const runtimeSourceRegistry = new SourceRegistry();
const runtimeSourceRegistryStore = new JsonSourceRegistryStore(`${envGet('EXTRACTABILITY_DATA_DIR') ?? '.data/extractability'}/sources.json`);
const runtimeDependencies = new DependencyGraph();
const runtimeDependencyStore = new JsonDependencyStore(`${envGet('EXTRACTABILITY_DATA_DIR') ?? '.data/extractability'}/dependencies.json`);
const runtimeFamilies = new Map<string, SourceFamily>([['cinego', new CinegoFamily()], ['cinrift', new CinriftFamily()], ['dooplay', new DooplayFamily()], ['pstream', new PStreamFamily()]]);
const restoreRuntimeSources = (state: SourceRegistryState | undefined) => {
  const deploymentIds = new Set(deploymentSourceRegistry.records.map(source => source.id));
  runtimeSourceRegistry.restore(state && [...deploymentIds].every(id => state.records.some(source => source.id === id)) ? state : deploymentSourceRegistry);
  if (!runtimeSourceRegistry.runtimeEligible().length) runtimeSourceRegistry.restore(deploymentSourceRegistry);
};

addon.use('/', (new ConfigureController(runtimeSourceRegistry)).router);
addon.use('/', (new ManifestController(runtimeSourceRegistry)).router);

const runtimeResolver = new ExtractionResolver(new RegistryExtractorLookup(new MatcherRegistry(runtimeExtractorRegistry)), runtimeTransport, { onDelegation: (_parent, child) => {
  const sourceId = child.hints?.['sourceId'];
  const familyId = child.hints?.['sourceExtractor'];
  if (typeof sourceId === 'string' && typeof familyId === 'string') runtimeDependencies.record({ sourceId, familyId, provider: child.url.hostname, observedAt: new Date() });
} });
const runtimeHealth = new FamilyHealthRunner(runtimeResolver, new StreamSelector(runtimeTransport), runtimeTransport, runtimeSourceRegistry, 0.5, runtimeDependencies);
const runtimeEngine = new RuntimeStreamEngine(new StremioMediaResolver(runtimeTransport, envGet('TMDB_ACCESS_TOKEN') ?? ''), runtimeSourceRegistry, runtimeFamilies, runtimeResolver, runtimeTransport, runtimeDependencies, runtimeDependencyStore);
addon.use('/', (new StreamController(logger, new RuntimeStremioAdapter(runtimeEngine))).router);

// error handler needs to stay at the end of the stack
addon.use((err: Error, _req: Request, _res: Response, next: NextFunction) => {
  logger.error(`Error: ${err}, cause: ${err.cause}, stack: ${err.stack}`);

  return next(err);
});

addon.get('/startup', async (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

addon.get('/ready', async (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

addon.get('/live', async (_req: Request, res: Response) => {
  const sources = runtimeSourceRegistry.runtimeEligible();
  const details = Object.fromEntries(sources.map(source => [source.canonicalDomain, runtimeSourceRegistry.health().get(source.id)?.lastOutcome]));
  res.status(sources.length > 0 ? 200 : 503).json({ status: sources.length > 0 ? 'ok' : 'error', details });
});

addon.get('/stats', async (_req: Request, res: Response) => {
  res.json({
    revision: envGet('RENDER_GIT_COMMIT') ?? 'development',
    sources: runtimeSourceRegistry.list().length,
    runtimeEligible: runtimeSourceRegistry.runtimeEligible().length,
    dependencies: runtimeDependencies.list().length,
  });
});

const port = parseInt(envGet('PORT') || '51546');
(async () => {
  const runtimeSources = await runtimeSourceRegistryStore.load();
  restoreRuntimeSources(runtimeSources);
  runtimeDependencies.restore(await runtimeDependencyStore.load());
  if (envIsProd()) {
    for (const source of runtimeSourceRegistry.runtimeEligible()) {
      const family = source.family && runtimeFamilies.get(source.family.id);
      const corpus = source.family && defaultFamilyHealthCorpora.get(source.family.id);
      if (family && corpus) await runtimeHealth.run(source, family, corpus, new AbortController().signal);
    }
  }
  const registryReloadIntervalMs = Number(envGet('EXTRACTABILITY_RELOAD_INTERVAL_MS') ?? 60000);
  if (registryReloadIntervalMs > 0) setInterval(() => {
    void runtimeSourceRegistryStore.load().then((state) => {
      if (state) restoreRuntimeSources(state);
    }).catch((error: unknown) => logger.error(`Could not reload extractability registry: ${error instanceof Error ? error.message : String(error)}`));
    void runtimeDependencyStore.load().then(edges => edges.forEach(edge => runtimeDependencies.record(edge))).catch((error: unknown) => logger.error(`Could not reload extraction dependencies: ${error instanceof Error ? error.message : String(error)}`));
  }, registryReloadIntervalMs).unref();
  addon.listen(port, () => {
    logger.info(`Add-on Repository URL: http://127.0.0.1:${port}/manifest.json`);
  });
})();
