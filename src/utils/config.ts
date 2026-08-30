import { Config } from '../types';

export const getDefaultConfig = (): Config => ({});

export const disableFmhySourceConfigKey = (sourceId: string): `disableFmhySource_${string}` => `disableFmhySource_${sourceId}`;

export const parseConfigPath = (value?: string): Config => {
  if (!value) return getDefaultConfig();
  if (value.startsWith('disabled=')) return Object.fromEntries(value.slice('disabled='.length).split(',').filter(Boolean).map(sourceId => [disableFmhySourceConfigKey(sourceId), 'on'])) as Config;
  throw new Error('Invalid config path');
};
