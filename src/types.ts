import { Manifest, ManifestConfig } from 'stremio-addon-sdk';

export interface Context {
  hostUrl: URL;
  id: string;
  ip?: string;
  config: Config;
}

export type CustomManifest = Manifest & {
  config: ManifestConfig[];
  stremioAddonsConfig: { // needed for add-on claiming on https://stremio-addons.net
    issuer: string;
    signature: string;
  };
};

export type Config = Partial<Record<`disableFmhySource_${string}`, string>>;
