import { Request, Response, Router } from 'express';
import type { SourceRegistry } from '../engine/registry';
import { landingTemplate } from '../landingTemplate';
import { Config } from '../types';
import { buildManifest, getDefaultConfig } from '../utils';

export class ConfigureController {
  public readonly router: Router;

  public constructor(private readonly fmhySources: SourceRegistry) {
    this.router = Router();

    this.router.get('/configure', this.getConfigure.bind(this));
    this.router.get('/:config/configure', this.getConfigure.bind(this));
  }

  private getConfigure(req: Request, res: Response) {
    let config: Config = getDefaultConfig();
    if (req.params['config']) {
      try {
        config = JSON.parse(req.params['config'] as string);
      } catch {
        res.status(400).json({ error: 'Invalid config: malformed JSON' });
        return;
      }
    }

    const manifest = buildManifest(config, this.fmhySources);

    res.setHeader('content-type', 'text/html');
    res.send(landingTemplate(manifest));
  };
}
