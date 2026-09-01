import type { SourceRegistry } from '../engine/registry';
import { Config, CustomManifest } from '../types';
import { disableFmhySourceConfigKey } from './config';
import { envGetAppId, envGetAppName } from './env';

export const buildManifest = (config: Config, fmhySources: SourceRegistry): CustomManifest => {
  const manifest: CustomManifest = {
    id: envGetAppId(),
    version: '1.5.0', // x-release-please-version
    name: envGetAppName(),
    description: 'Provides video HTTP URLs from streaming websites listed by FMHY.',
    resources: [
      'stream',
    ],
    types: [
      'movie',
      'series',
    ],
    catalogs: [],
    idPrefixes: ['tmdb:', 'tt'],
    logo: 'https://emojiapi.dev/api/v1/spider_web/256.png',
    behaviorHints: {
      p2p: false,
      configurable: true,
      configurationRequired: false,
    },
    config: [],
    stremioAddonsConfig: {
      issuer: 'https://stremio-addons.net',
      signature: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..h1oW2E0XXKLldUqO-ReSUA.fejuyGAvmc_CdT9dnq2srZCgoC42ak-Rqeo7IKsEN3DPRpz8x-hmvbuBI_7BUU2PsFMSni35m_Lv0teUNQDPvlrm7t1FCZINMR4ty_Hee6If5m6J4kSzafD75HhWvxFU.FAcDZ5qZrTPDeRAVOUI2tQ',
    },
  };

  for (const source of fmhySources.runtimeEligible()) {
    const key = disableFmhySourceConfigKey(source.id);
    manifest.config.push({
      key,
      type: 'checkbox',
      title: source.canonicalDomain,
      ...(key in config && { default: 'checked' }),
    });
  }

  return manifest;
};
