import { Request, Response, Router } from 'express';
import type { SourceRegistry } from '../engine/registry';
import { Config } from '../types';
import { buildManifest, getDefaultConfig } from '../utils';

export class ManifestController {
  public readonly router: Router;

  public constructor(private readonly fmhySources: SourceRegistry) {
    this.router = Router();

    this.router.get('/manifest.json', this.getManifest.bind(this));
    this.router.get('/:config/manifest.json', this.getManifest.bind(this));
  }

  private getManifest(req: Request, res: Response) {
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

    res.setHeader('Content-Type', 'application/json');
    res.send(manifest);
  };
}
