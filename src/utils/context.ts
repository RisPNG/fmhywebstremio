import { Request, Response } from 'express';
import { Context } from '../types';
import { parseConfigPath } from './config';

export function resolveHostUrl(req: Request): URL {
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
    config: parseConfigPath(req.params['config'] as string | undefined),
  };
};
