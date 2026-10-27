import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, RequestServices } from '../../engine/core/models';
import { SourceRegistry } from '../../engine/registry';
import type { DirectorySnapshot, DirectorySnapshotStore } from './models';
import { FMHY_DIRECTORY_URLS, FmhyDirectoryProvider } from './provider';

const fixture = (name: string) => readFileSync(resolve(__dirname, `__fixtures__/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: { 'content-type': 'text/plain' }, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('FMHY video and non-English directory acquisition', () => {
  test('keeps regional streaming entries in the same registry snapshot as the main video sources', async () => {
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => response(request.url, fixture(request.url.pathname.endsWith('/video.md') ? 'video-current.md' : 'non-english-current.md'))) };
    const provider = new FmhyDirectoryProvider(services);
    const update = await provider.fetchSnapshot(new AbortController().signal);
    expect(update.ok).toBe(true);
    if (!update.ok) throw new Error('Expected complete directory snapshot');
    const registry = new SourceRegistry();
    registry.apply(update.snapshot);
    expect(registry.get('kkphim:kkphim.com')).toMatchObject({ canonicalDomain: 'kkphim.com', fmhy: { name: 'kkphim', section: '▷ Streaming / Phát trực tuyến' } });
    expect(registry.get('z-stream:zstream.mov')).toBeDefined();
    expect(update.snapshot.entries.some(entry => entry.name === 'Thivien')).toBe(false);
    expect((services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request.url)).toEqual(FMHY_DIRECTORY_URLS);
    const removal = await new FmhyDirectoryProvider({ request: async request => response(request.url, fixture(request.url.pathname.endsWith('/video.md') ? 'video-current.md' : 'non-english-current.md').replace('* [kkphim](https://kkphim.com/) - Movies / TV / Anime / Sub / Dub / 1080p\n', '')) }).fetchSnapshot(new AbortController().signal);
    expect(removal.ok).toBe(true);
    if (removal.ok) registry.apply(removal.snapshot);
    expect(registry.get('kkphim:kkphim.com')).toBeUndefined();
    expect(registry.get('z-stream:zstream.mov')).toBeDefined();
  });

  test.each(['network', 'parse'])('preserves the complete persisted snapshot if a required document fails: %s', async (failure) => {
    let saved: DirectorySnapshot | undefined;
    const store: DirectorySnapshotStore = { load: async () => saved, save: jest.fn(async (snapshot) => {
      saved = snapshot;
    }) };
    const services: RequestServices = { request: async request => response(request.url, fixture(request.url.pathname.endsWith('/video.md') ? 'video-current.md' : 'non-english-current.md')) };
    const first = await new FmhyDirectoryProvider(services, undefined, store).fetchSnapshot(new AbortController().signal);
    expect(first.ok).toBe(true);
    let mainSettled = false;
    const failing: RequestServices = { request: async (request) => {
      if (request.url.pathname.endsWith('/video.md')) {
        await new Promise(resolve => setTimeout(resolve, 5));
        mainSettled = true;
        return response(request.url, '# Movies / TV\n## Streaming Sites\n- [Replacement](https://replacement.test/)');
      }
      if (failure === 'network') throw new Error('network');
      return response(request.url, '# Reading\n- [Unrelated](https://reading.test/)');
    } };
    const update = await new FmhyDirectoryProvider(failing, undefined, store).fetchSnapshot(new AbortController().signal);
    expect(mainSettled).toBe(true);
    expect(update).toMatchObject({ ok: false, snapshot: saved, failure: { code: failure === 'network' ? 'DIRECTORY_FETCH_FAILED' : 'DIRECTORY_CATEGORY_MISSING', diagnostic: { finalUrl: FMHY_DIRECTORY_URLS[1]?.href } } });
    expect(update.snapshot?.entries.some(entry => entry.name === 'kkphim')).toBe(true);
    expect(update.snapshot?.entries.some(entry => entry.name === 'Replacement')).toBe(false);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  test('keeps one canonical entry when the same source appears in both directories', async () => {
    const services: RequestServices = { request: async request => response(request.url, request.url.pathname.endsWith('/video.md') ? '# Movies / TV\n## Main Streaming\n- [Shared](https://shared.test/)\n' : '# Other Languages\n## Regional Streaming\n- [Shared](https://shared.test/)\n') };
    const update = await new FmhyDirectoryProvider(services).fetchSnapshot(new AbortController().signal);
    expect(update).toMatchObject({ ok: true, snapshot: { entries: [{ name: 'Shared', section: 'Main Streaming' }] } });
    expect(update.snapshot?.entries).toHaveLength(1);
  });

  test('names an entry without the invisible formatting characters that precede its link text', async () => {
    const services: RequestServices = { request: async request => response(request.url, request.url.pathname.endsWith('/video.md') ? '# Movies / TV\n## Main Streaming\n- [\u2060Invisible](https://invisible.test/)\n' : '# Other Languages\n## Regional Streaming\n- [Visible](https://visible.test/)\n') };
    const update = await new FmhyDirectoryProvider(services).fetchSnapshot(new AbortController().signal);
    expect(update.snapshot?.entries.map(entry => entry.name)).toEqual(['Invisible', 'Visible']);
  });
});
