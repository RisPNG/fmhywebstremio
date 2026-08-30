import { Request, Response } from 'express';
import { contextFromRequestAndResponse } from './context';

describe('contextFromRequestAndResponse', () => {
  test('reads source selection and request identity', () => {
    const req = {
      protocol: 'https',
      host: 'addon.example',
      headers: {},
      ip: '127.0.0.1',
      params: { config: 'disabled=cineby:cineby.at' },
    };
    const res = { getHeader: () => 'request-id' };

    expect(contextFromRequestAndResponse(req as unknown as Request, res as unknown as Response)).toEqual({
      hostUrl: new URL('https://addon.example'),
      id: 'request-id',
      ip: '127.0.0.1',
      config: { 'disableFmhySource_cineby:cineby.at': 'on' },
    });
  });

  test('uses the default configuration', () => {
    const req = { protocol: 'https', host: 'addon.example', headers: {}, params: {} };
    const res = { getHeader: () => 'request-id' };

    expect(contextFromRequestAndResponse(req as unknown as Request, res as unknown as Response).config).toEqual({});
  });

  test('reads a clean source-selection path', () => {
    const req = { protocol: 'https', host: 'addon.example', headers: {}, params: { config: 'disabled=cinetaro:cinetaro.to' } };
    const res = { getHeader: () => 'request-id' };

    expect(contextFromRequestAndResponse(req as unknown as Request, res as unknown as Response).config).toEqual({ 'disableFmhySource_cinetaro:cinetaro.to': 'on' });
  });

  test('uses the forwarded protocol', () => {
    const req = { protocol: 'http', host: 'addon.example', headers: { 'x-forwarded-proto': 'https' }, params: {} };
    const res = { getHeader: () => 'request-id' };

    expect(contextFromRequestAndResponse(req as unknown as Request, res as unknown as Response).hostUrl).toEqual(new URL('https://addon.example'));
  });

  test('uses the request protocol when the forwarded protocol is empty', () => {
    const req = { protocol: 'http', host: 'addon.example', headers: { 'x-forwarded-proto': '' }, params: {} };
    const res = { getHeader: () => 'request-id' };

    expect(contextFromRequestAndResponse(req as unknown as Request, res as unknown as Response).hostUrl).toEqual(new URL('http://addon.example'));
  });

  test('rejects an unsupported configuration path', () => {
    const req = { protocol: 'https', host: 'addon.example', headers: {}, params: { config: '{invalid}' } };
    const res = { getHeader: () => 'request-id' };

    expect(() => contextFromRequestAndResponse(req as unknown as Request, res as unknown as Response)).toThrow('Invalid config path');
  });
});
