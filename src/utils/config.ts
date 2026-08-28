import { Config } from '../types';

export const getDefaultConfig = (): Config => ({});

export const disableFmhySourceConfigKey = (sourceId: string): `disableFmhySource_${string}` => `disableFmhySource_${sourceId}`;
