import { getDefaultConfig } from './config';

describe('getDefaultConfig', () => {
  test('enables every runtime-eligible source', () => {
    expect(getDefaultConfig()).toEqual({});
  });
});
