export function normalizeDirectoryUrl(value: string): URL | null {
  try {
    const url = new URL(value.replace(/&amp;/g, '&'));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return url;
  } catch { return null; }
}

export function canonicalEntryId(name: string, urls: readonly URL[]): string {
  return `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${[...urls].map(url => url.hostname).sort()[0] ?? 'unknown'}`;
}
