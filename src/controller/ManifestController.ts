import { Request, Response, Router } from 'express';
import type { SourceRegistry } from '../engine/registry';
import { buildManifest, parseConfigPath } from '../utils';

export class ManifestController {
  public readonly router: Router;

  public constructor(private readonly fmhySources: SourceRegistry) {
    this.router = Router();

    this.router.get('/manifest.json', this.getManifest.bind(this));
    this.router.get('/:config/manifest.json', this.getManifest.bind(this));
  }

  private getManifest(req: Request, res: Response) {
    let config;
    try {
      config = parseConfigPath(req.params['config'] as string | undefined);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }

    const manifest = buildManifest(config, this.fmhySources);

    res.setHeader('Content-Type', 'application/json');
    res.send(manifest);
  };
}
