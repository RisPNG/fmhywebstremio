import { getDefaultConfig, parseConfigPath } from './config';

describe('getDefaultConfig', () => {
  test('enables every runtime-eligible source', () => {
    expect(getDefaultConfig()).toEqual({});
  });

  test('parses clean source selections and rejects other path formats', () => {
    expect(parseConfigPath('disabled=cinego:cinego.co,cinetaro:cinetaro.to')).toEqual({
      'disableFmhySource_cinego:cinego.co': 'on',
      'disableFmhySource_cinetaro:cinetaro.to': 'on',
    });
    expect(() => parseConfigPath('{"disableFmhySource_cinego:cinego.co":"on"}')).toThrow('Invalid config path');
  });
});
