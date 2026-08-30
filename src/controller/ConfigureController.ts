import { Request, Response, Router } from 'express';
import type { SourceRegistry } from '../engine/registry';
import { landingTemplate } from '../landingTemplate';
import { buildManifest, parseConfigPath } from '../utils';

export class ConfigureController {
  public readonly router: Router;

  public constructor(private readonly fmhySources: SourceRegistry) {
    this.router = Router();

    this.router.get('/configure', this.getConfigure.bind(this));
    this.router.get('/:config/configure', this.getConfigure.bind(this));
  }

  private getConfigure(req: Request, res: Response) {
    let config;
    try {
      config = parseConfigPath(req.params['config'] as string | undefined);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }

    const manifest = buildManifest(config, this.fmhySources);

    res.setHeader('content-type', 'text/html');
    res.send(landingTemplate(manifest));
  };
}
