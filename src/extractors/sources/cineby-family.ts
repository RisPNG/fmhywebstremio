import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { SpeedracelightApiHostArchitecture, type SpeedracelightHostArchitecture } from '../hosts/speedracelight-host-architecture';

export class CinebyFamily implements SourceFamily {
  public readonly id = 'cineby';

  public constructor(private readonly host: SpeedracelightHostArchitecture = new SpeedracelightApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.htmlSample && /Cineby - Watch Free Movies|contact@cineby\.at/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'cineby-brand' });
    if (snapshot.routeHints.some(path => /^\/(?:movie|tv)\//i.test(path))) evidence.push({ type: 'route-shape', value: '/movie|tv/{tmdbId}' });
    if (snapshot.htmlSample && /speedracelight/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'speedracelight-player' });
    if (evidence.length < 2) return null;
    return { familyId: this.id, confidence: Math.min(1, 0.45 + evidence.length * 0.2), evidence };
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    return this.host.discover(media, source.id, services, signal);
  }
}
