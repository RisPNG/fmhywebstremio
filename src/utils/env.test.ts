import { envGet, envGetAppId, envGetAppName, envIsProd } from './env';

describe('env', () => {
  test('envGet', () => {
    expect(envGet('NODE_ENV')).toBe('test');
  });

  test('envGetAppId', () => {
    expect(envGetAppId()).toBe('fmhy-webstream');

    process.env['MANIFEST_ID'] = 'fmhy-webstream.dev';
    expect(envGetAppId()).toBe('fmhy-webstream.dev');
    delete process.env['MANIFEST_ID'];
  });

  test('envGetAppName', () => {
    expect(envGetAppName()).toBe('FMHY\'s Website Streamer');

    process.env['MANIFEST_NAME'] = 'FMHY Web Stream | dev';
    expect(envGetAppName()).toBe('FMHY Web Stream | dev');
    delete process.env['MANIFEST_NAME'];
  });

  test('envIsProd', () => {
    expect(envIsProd()).toBeFalsy();

    const previousNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    expect(envIsProd()).toBeTruthy();
    process.env['NODE_ENV'] = previousNodeEnv;
  });
});
