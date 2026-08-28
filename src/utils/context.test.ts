import { Request, Response } from 'express';
import { contextFromRequestAndResponse } from './context';

describe('contextFromRequestAndResponse', () => {
  test('reads source selection and request identity', () => {
    const req = {
      protocol: 'https',
      host: 'addon.example',
      headers: {},
      ip: '127.0.0.1',
      params: { config: '{"disableFmhySource_7movies:7movies.in":"on"}' },
    };
    const res = { getHeader: () => 'request-id' };

    expect(contextFromRequestAndResponse(req as unknown as Request, res as unknown as Response)).toEqual({
      hostUrl: new URL('https://addon.example'),
      id: 'request-id',
      ip: '127.0.0.1',
      config: { 'disableFmhySource_7movies:7movies.in': 'on' },
    });
  });

  test('uses the default configuration', () => {
    const req = { protocol: 'https', host: 'addon.example', headers: {}, params: {} };
    const res = { getHeader: () => 'request-id' };

    expect(contextFromRequestAndResponse(req as unknown as Request, res as unknown as Response).config).toEqual({});
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

  test('rejects malformed configuration JSON', () => {
    const req = { protocol: 'https', host: 'addon.example', headers: {}, params: { config: '{invalid}' } };
    const res = { getHeader: () => 'request-id' };

    expect(() => contextFromRequestAndResponse(req as unknown as Request, res as unknown as Response)).toThrow('Invalid config: malformed JSON');
  });
});
