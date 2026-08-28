import { Request, Response } from 'express';
import { Context } from '../types';
import { getDefaultConfig } from './config';

function resolveHostUrl(req: Request): URL {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = typeof forwardedProto === 'string'
    ? (forwardedProto.split(',')[0]?.trim() || req.protocol)
    : req.protocol;
  return new URL(`${protocol}://${req.host}`);
}

export const contextFromRequestAndResponse = (req: Request, res: Response): Context => {
  return {
    hostUrl: resolveHostUrl(req),
    id: res.getHeader('X-Request-ID') as string,
    ...(req.ip && { ip: req.ip }),
    config: (() => {
      if (!req.params['config']) return getDefaultConfig();
      try {
        return JSON.parse(req.params['config'] as string);
      } catch {
        throw new Error('Invalid config: malformed JSON');
      }
    })(),
  };
};
