import { Mutex } from 'async-mutex';
import { Request, Response, Router } from 'express';
import winston from 'winston';
import type { StremioStreamProvider } from '../addon/stremio-adapter';
import { contextFromRequestAndResponse, envIsProd } from '../utils';

export class StreamController {
  public readonly router: Router;

  private readonly logger: winston.Logger;
  private readonly streams: StremioStreamProvider;

  private readonly locks = new Map<string, Mutex>();

  public constructor(logger: winston.Logger, streams: StremioStreamProvider) {
    this.router = Router();

    this.logger = logger;
    this.streams = streams;

    this.router.get('/stream/:type/:id.json', this.getStream.bind(this));
    this.router.get('/:config/stream/:type/:id.json', this.getStream.bind(this));
  }

  private async getStream(req: Request, res: Response) {
    const type = String(req.params['type'] || '');
    const rawId: string = req.params['id'] as string || '';

    let ctx;
    try {
      ctx = contextFromRequestAndResponse(req, res);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }

    this.logger.info(`Search stream for type "${type}" and id "${rawId}" for ip ${ctx.ip}`, ctx);

    let mutex = this.locks.get(rawId);
    if (!mutex) {
      mutex = new Mutex();
      this.locks.set(rawId, mutex);
    }

    await mutex.runExclusive(async () => {
      let result;
      try {
        result = await this.streams.findStreams(ctx, type, rawId);
      } catch (error) {
        res.status(400).send((error as Error).message);
        return;
      }
      const { streams, ttl } = result;

      if (ttl && envIsProd()) {
        res.setHeader('Cache-Control', `public, max-age=${Math.floor(ttl / 1000)}`);
      }

      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify({ streams }));
    });

    if (!mutex.isLocked()) {
      this.locks.delete(rawId);
    }
  };
}
