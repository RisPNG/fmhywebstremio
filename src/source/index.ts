import { Fetcher } from '../utils';
import { Source } from './Source';

export * from './Source';

export const createSources = (fetcher: Fetcher): Source[] => {
  void fetcher;
  return [];
};
