import { Request } from 'express';
import { envGet, envGetAppId, envGetAppName, envGetRequired, envIsProd, isElfHostedInstance } from './env';

describe('env', () => {
  test('envGet', () => {
    expect(envGet('NODE_ENV')).toBe('test');
  });

  test('envGetRequired set', () => {
    expect(envGetRequired('NODE_ENV')).toBe('test');
  });

  test('envGetRequired not set', () => {
    expect(() => envGetRequired('NOT_SET')).toThrow('Environment variable "NOT_SET" is not configured.');
  });

  test('envGetAppId', () => {
    expect(envGetAppId()).toBe('fmhy-webstream');

    process.env['MANIFEST_ID'] = 'webstreamr-mbg.dev';
    expect(envGetAppId()).toBe('webstreamr-mbg.dev');
    delete process.env['MANIFEST_ID'];
  });

  test('envGetAppName', () => {
    expect(envGetAppName()).toBe('FMHY\'s Website Streamer');

    process.env['MANIFEST_NAME'] = 'WebStreamrMBG | dev';
    expect(envGetAppName()).toBe('WebStreamrMBG | dev');
    delete process.env['MANIFEST_NAME'];
  });

  test('envIsProd', () => {
    expect(envIsProd()).toBeFalsy();

    const previousNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    expect(envIsProd()).toBeTruthy();
    process.env['NODE_ENV'] = previousNodeEnv;
  });

  test('isElfHostedInstancce', () => {
    expect(isElfHostedInstance({ host: 'someuser.elfhosted.com' } as Request)).toBeTruthy();
    expect(isElfHostedInstance({ host: 'webstreamr.hayd.uk' } as Request)).toBeFalsy();
  });
});
