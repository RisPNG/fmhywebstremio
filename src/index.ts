import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import axios from 'axios';
import { buildMemoryStorage, setupCache } from 'axios-cache-interceptor';
import axiosRetry from 'axios-retry';
import express, { NextFunction, Request, Response } from 'express';
// eslint-disable-next-line import/no-named-as-default
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import { CombinedStremioAdapter, LegacyStremioAdapter, RuntimeStremioAdapter } from './addon/stremio-adapter';
import { ConfigureController, ExtractController, ManifestController, StreamController } from './controller';
import { RuntimeStreamEngine, TmdbMediaResolver } from './engine/core';
import { DependencyGraph, JsonDependencyStore, type SourceFamily } from './engine/health';
import { JsonSourceRegistryStore, MatcherRegistry, RegistryExtractorLookup, SourceRegistry } from './engine/registry';
import { ExtractionResolver } from './engine/resolver';
import { TransportDirector } from './engine/transport';
import { BlockedError, logErrorAndReturnNiceString } from './error';
import { createExtractors, ExtractorRegistry } from './extractor';
import { extractorRegistry as runtimeExtractorRegistry } from './extractors/registry.generated';
import { CinriftFamily } from './extractors/sources/cinrift-family';
import { DooplayFamily } from './extractors/sources/dooplay-family';
import { PStreamFamily } from './extractors/sources/pstream-family';
import { createSources, Source } from './source';
import { clearCache, contextFromRequestAndResponse, envGet, envIsProd, Fetcher, StreamResolver } from './utils';

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
  appendFileSync('/tmp/wsmbg_crash.log', `${new Date().toISOString()} ${msg}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (error: Error) => {
  const msg = `Unhandled rejection: ${error}, cause: ${error.cause}, stack: ${error.stack}`;
  console.error(msg);
  logger.error(msg);
  appendFileSync('/tmp/wsmbg_crash.log', `${new Date().toISOString()} ${msg}\n`);
});

process.on('SIGTERM', () => {
  const msg = 'SIGTERM received';
  console.error(msg);
  appendFileSync('/tmp/wsmbg_crash.log', `${new Date().toISOString()} ${msg}\n`);
  process.exit(0);
});

process.on('SIGINT', () => {
  const msg = 'SIGINT received';
  console.error(msg);
  appendFileSync('/tmp/wsmbg_crash.log', `${new Date().toISOString()} ${msg}\n`);
  process.exit(0);
});

const cachedAxios = setupCache(axios, {
  interpretHeader: true,
  storage: buildMemoryStorage(true, 3 * 60 * 60 * 1000, 4096, 12 * 60 * 60 * 1000),
  ttl: 15 * 60 * 1000, // 15m
});
axiosRetry(cachedAxios, { retries: 3, retryDelay: () => 333 });

const fetcher = new Fetcher(cachedAxios, logger);

const sources = createSources(fetcher);
const extractors = createExtractors(fetcher, logger);

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

const extractorRegistry = new ExtractorRegistry(logger, extractors);
const runtimeTransport = new TransportDirector();
const runtimeSourceRegistry = new SourceRegistry();
const runtimeSourceRegistryStore = new JsonSourceRegistryStore(`${envGet('EXTRACTABILITY_DATA_DIR') ?? '.data/extractability'}/sources.json`);
const runtimeDependencies = new DependencyGraph();
const runtimeDependencyStore = new JsonDependencyStore(`${envGet('EXTRACTABILITY_DATA_DIR') ?? '.data/extractability'}/dependencies.json`);
const runtimeFamilies = new Map<string, SourceFamily>([['cinrift', new CinriftFamily()], ['dooplay', new DooplayFamily()], ['pstream', new PStreamFamily()]]);

addon.use('/', (new ExtractController(logger, fetcher, extractorRegistry)).router);
addon.use('/', (new ConfigureController(sources, extractors, runtimeSourceRegistry)).router);
addon.use('/', (new ManifestController(sources, extractors, runtimeSourceRegistry)).router);

const streamResolver = new StreamResolver(logger, extractorRegistry);
const runtimeResolver = new ExtractionResolver(new RegistryExtractorLookup(new MatcherRegistry(runtimeExtractorRegistry)), runtimeTransport, { onDelegation: (_parent, child) => {
  const sourceId = child.hints?.['sourceId'];
  const familyId = child.hints?.['sourceExtractor'];
  if (typeof sourceId === 'string' && typeof familyId === 'string') runtimeDependencies.record({ sourceId, familyId, provider: child.url.hostname, observedAt: new Date() });
} });
const runtimeEngine = new RuntimeStreamEngine(new TmdbMediaResolver(runtimeTransport, envGet('TMDB_ACCESS_TOKEN') ?? ''), runtimeSourceRegistry, runtimeFamilies, runtimeResolver, runtimeTransport, runtimeDependencies, runtimeDependencyStore);
addon.use('/', (new StreamController(logger, new CombinedStremioAdapter([new LegacyStremioAdapter(streamResolver, sources), new RuntimeStremioAdapter(runtimeEngine)]))).router);

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

let lastLiveProbeRequestsTimestamp = 0;
addon.get('/live', async (req: Request, res: Response) => {
  const ctx = contextFromRequestAndResponse(req, res);

  const hrefs = [
    'https://cloudnestra.com',
  ];

  const results = new Map<string, string>();

  let blockedCount = 0;
  let errorCount = 0;

  const fetchFactories = hrefs.map(href => async () => {
    const url = new URL(href);

    try {
      await fetcher.head(ctx, url);
      results.set(url.host, 'ok');
    } catch (error) {
      if (error instanceof BlockedError) {
        results.set(url.host, 'blocked');
        blockedCount++;
      } else {
        results.set(url.host, 'error');
        errorCount++;
      }

      logErrorAndReturnNiceString(ctx, logger, href, error);
    }
  });

  if (Date.now() - lastLiveProbeRequestsTimestamp > 60000 || 'force' in req.query) { // every minute
    await Promise.all(fetchFactories.map(fn => fn()));
    lastLiveProbeRequestsTimestamp = Date.now();
  }

  const details = Object.fromEntries(results);

  if (blockedCount > 0) {
    // TODO: fail health check and try to get a clean IP if infra is ready
    logger.warn('IP might be not clean and leading to blocking.', ctx);
    res.json({ status: 'ok', details });
  } else if (errorCount === hrefs.length) {
    res.status(503).json({ status: 'error', details });
  } else {
    res.json({ status: 'ok', ipStatus: 'ok', details });
  }
});

addon.get('/stats', async (_req: Request, res: Response) => {
  res.json({
    extractorRegistry: extractorRegistry.stats(),
    fetcher: fetcher.stats(),
    sources: Source.stats(),
  });
});

const port = parseInt(envGet('PORT') || '51546');
(async () => {
  if (envGet('CACHE_FILES_DELETE_ON_START')) {
    await clearCache(logger);
  }
  const runtimeSources = await runtimeSourceRegistryStore.load();
  if (runtimeSources) runtimeSourceRegistry.restore(runtimeSources);
  runtimeDependencies.restore(await runtimeDependencyStore.load());
  const registryReloadIntervalMs = Number(envGet('EXTRACTABILITY_RELOAD_INTERVAL_MS') ?? 60000);
  if (registryReloadIntervalMs > 0) setInterval(() => {
    void runtimeSourceRegistryStore.load().then((state) => {
      if (state) runtimeSourceRegistry.restore(state);
    }).catch((error: unknown) => logger.error(`Could not reload extractability registry: ${error instanceof Error ? error.message : String(error)}`));
    void runtimeDependencyStore.load().then(edges => edges.forEach(edge => runtimeDependencies.record(edge))).catch((error: unknown) => logger.error(`Could not reload extraction dependencies: ${error instanceof Error ? error.message : String(error)}`));
  }, registryReloadIntervalMs).unref();
  addon.listen(port, () => {
    logger.info(`Add-on Repository URL: http://127.0.0.1:${port}/manifest.json`);
  });
})();
