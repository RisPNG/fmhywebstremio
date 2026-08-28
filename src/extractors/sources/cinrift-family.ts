import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { VidriftApiHostArchitecture, type VidriftHostArchitecture } from '../hosts/vidrift-host-architecture';

export class CinriftFamily implements SourceFamily {
  public readonly id = 'cinrift';

  public constructor(private readonly host: VidriftHostArchitecture = new VidriftApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.htmlSample && /embed\.vidrift\.in/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'vidrift-player' });
    if (snapshot.htmlSample && /cinrift_(?:preferences|continue_watching|watchlist)/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'cinrift-client' });
    if (snapshot.htmlSample && /(?:Watch on )?7Movies|Cinrift/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'cinrift-brand' });
    if (evidence.length < 2) return null;
    return { familyId: this.id, confidence: Math.min(1, 0.45 + evidence.length * 0.2), evidence };
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const streams = await this.host.discover(media, source.id, new URL(`https://${source.canonicalDomain}/`), services, signal);
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
