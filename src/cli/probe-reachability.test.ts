describe('deployment reachability command', () => {
  const argv = process.argv;
  const exitCode = process.exitCode;

  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    jest.restoreAllMocks();
  });

  it.each([
    { status: 200, html: '<title>Movies</title>', host: 'source.test', outcome: 'reachable' },
    { status: 200, html: '<title>Just a moment...</title>', host: 'source.test', outcome: 'blocked' },
    { status: 200, html: '<title>Movies</title>', host: 'elsewhere.test', outcome: 'redirected' },
    { status: 403, html: '', host: 'source.test', outcome: 'blocked' },
  ])('reports $outcome without granting playback eligibility', async ({ status, html, host, outcome }) => {
    await jest.isolateModulesAsync(async () => {
      const { FmhyDirectoryProvider } = jest.requireActual<typeof import('../discovery/fmhy')>('../discovery/fmhy');
      const { TransportDirector, TransportFailure } = jest.requireActual<typeof import('../engine/transport')>('../engine/transport');
      jest.spyOn(FmhyDirectoryProvider.prototype, 'fetchSnapshot').mockResolvedValue({ ok: true, snapshot: { fetchedAt: new Date(0), entries: [{ name: 'Source', urls: [new URL('https://source.test')], mirrors: [], section: 'Streaming', tags: [], apiHint: false }] }, diff: [] });
      const request = jest.spyOn(TransportDirector.prototype, 'request').mockImplementation(async () => {
        if (status === 403) throw new TransportFailure({ code: 'HTTP_FORBIDDEN', message: 'Forbidden', stage: 'stage:transport', observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status, bodyCaptured: false } });
        return { status, headers: {}, finalUrl: new URL(`https://${host}`), redirectChain: [], body: new TextEncoder().encode(html), text: () => html, json: () => ({}), truncated: false, timing: { startedAt: new Date(), elapsedMs: 1 } };
      });
      process.argv = ['node', 'probe-reachability', 'source.test'];
      const output = new Promise<string>((resolve) => {
        jest.spyOn(process.stdout, 'write').mockImplementation((value) => {
          resolve(String(value));
          return true;
        });
      });
      jest.requireActual('./probe-reachability');
      expect(JSON.parse(await output)).toMatchObject({ playbackTested: false, results: [{ domain: 'source.test', outcome, status }] });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 15000, maxBytes: 256 * 1024 }), expect.any(AbortSignal));
    });
  });

  it('rejects an unlisted target before probing any candidate', async () => {
    await jest.isolateModulesAsync(async () => {
      const { FmhyDirectoryProvider } = jest.requireActual<typeof import('../discovery/fmhy')>('../discovery/fmhy');
      const { TransportDirector } = jest.requireActual<typeof import('../engine/transport')>('../engine/transport');
      jest.spyOn(FmhyDirectoryProvider.prototype, 'fetchSnapshot').mockResolvedValue({ ok: true, snapshot: { fetchedAt: new Date(), entries: [] }, diff: [] });
      const request = jest.spyOn(TransportDirector.prototype, 'request');
      process.argv = ['node', 'probe-reachability', 'localhost'];
      const output = new Promise<string>((resolve) => {
        jest.spyOn(process.stderr, 'write').mockImplementation((value) => {
          resolve(String(value));
          return true;
        });
      });
      jest.requireActual('./probe-reachability');
      expect(await output).toContain('Domain is not in the current FMHY directory: localhost');
      expect(request).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });
});
