export const envGet = (name: string): string | undefined => process.env[name];

export const envGetAppId = (): string => process.env['MANIFEST_ID'] || 'fmhy-webstream';

export const envGetAppName = (): string => process.env['MANIFEST_NAME'] || 'FMHY\'s Website Streamer';

export const envIsProd = (): boolean => process.env['NODE_ENV'] === 'production';
