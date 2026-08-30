import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import express, { NextFunction, Request, Response } from 'express';
// eslint-disable-next-line import/no-named-as-default
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import { RuntimeStremioAdapter } from './addon/stremio-adapter';
import { HlsRelay } from './addon/stremio-adapter/hls-relay';
import { ConfigureController, HlsRelayController, ManifestController, StreamController } from './controller';
import { RuntimeStreamEngine, StremioMediaResolver } from './engine/core';
import { defaultFamilyHealthCorpora, DependencyGraph, FamilyHealthRunner, JsonDependencyStore, type SourceFamily } from './engine/health';
import { StreamSelector } from './engine/protocols';
import { deploymentSourceRegistry, MatcherRegistry, RegistryExtractorLookup, SourceRegistry } from './engine/registry';
import { ExtractionResolver } from './engine/resolver';
import { TransportDirector } from './engine/transport';
import { extractorRegistry as runtimeExtractorRegistry } from './extractors/registry.generated';
import { CinebyFamily } from './extractors/sources/cineby-family';
import { CinegoFamily } from './extractors/sources/cinego-family';
import { CinetaroFamily } from './extractors/sources/cinetaro-family';
import { DooplayFamily } from './extractors/sources/dooplay-family';
import { PStreamFamily } from './extractors/sources/pstream-family';
import { SixtySevenMoviesFamily } from './extractors/sources/sixty-seven-movies-family';
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
  addon.use(rateLimit({ windowMs: 60 * 1000, limit: 30, skip: req => req.path.startsWith('/hls-relay/') }));
  addon.use('/hls-relay', rateLimit({ windowMs: 60 * 1000, limit: 300 }));
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
const runtimeRelay = new HlsRelay();
const runtimeSourceRegistry = new SourceRegistry();
const runtimeDependencies = new DependencyGraph();
const runtimeDependencyStore = new JsonDependencyStore(`${envGet('EXTRACTABILITY_DATA_DIR') ?? '.data/extractability'}/dependencies.json`);
const runtimeFamilies = new Map<string, SourceFamily>([['cineby', new CinebyFamily()], ['cinego', new CinegoFamily()], ['cinetaro', new CinetaroFamily()], ['dooplay', new DooplayFamily()], ['pstream', new PStreamFamily()], ['sixty-seven-movies', new SixtySevenMoviesFamily()]]);

addon.use('/', (new ConfigureController(runtimeSourceRegistry)).router);
addon.use('/', (new ManifestController(runtimeSourceRegistry)).router);

const runtimeResolver = new ExtractionResolver(new RegistryExtractorLookup(new MatcherRegistry(runtimeExtractorRegistry)), runtimeTransport, { onDelegation: (_parent, child) => {
  const sourceId = child.hints?.['sourceId'];
  const familyId = child.hints?.['sourceExtractor'];
  if (typeof sourceId === 'string' && typeof familyId === 'string') runtimeDependencies.record({ sourceId, familyId, provider: child.url.hostname, observedAt: new Date() });
} });
const runtimeHealth = new FamilyHealthRunner(runtimeResolver, new StreamSelector(runtimeTransport), runtimeTransport, runtimeSourceRegistry, 0.5, runtimeDependencies);
const runtimeEngine = new RuntimeStreamEngine(new StremioMediaResolver(runtimeTransport, envGet('TMDB_ACCESS_TOKEN') ?? ''), runtimeSourceRegistry, runtimeFamilies, runtimeResolver, runtimeTransport, runtimeDependencies, runtimeDependencyStore);
addon.use('/', (new HlsRelayController(runtimeRelay)).router);
addon.use('/', (new StreamController(logger, new RuntimeStremioAdapter(runtimeEngine, runtimeRelay))).router);

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
  runtimeSourceRegistry.restore(deploymentSourceRegistry);
  runtimeDependencies.restore(await runtimeDependencyStore.load());
  if (envIsProd()) {
    for (const source of runtimeSourceRegistry.runtimeEligible()) {
      const family = source.family && runtimeFamilies.get(source.family.id);
      const corpus = source.family && defaultFamilyHealthCorpora.get(source.family.id);
      if (family && corpus) await runtimeHealth.run(source, family, corpus, new AbortController().signal);
    }
  }
  const dependencyReloadIntervalMs = Number(envGet('EXTRACTABILITY_RELOAD_INTERVAL_MS') ?? 60000);
  if (dependencyReloadIntervalMs > 0) setInterval(() => {
    void runtimeDependencyStore.load().then(edges => edges.forEach(edge => runtimeDependencies.record(edge))).catch((error: unknown) => logger.error(`Could not reload extraction dependencies: ${error instanceof Error ? error.message : String(error)}`));
  }, dependencyReloadIntervalMs).unref();
  addon.listen(port, () => {
    logger.info(`Add-on Repository URL: http://127.0.0.1:${port}/manifest.json`);
  });
})();
