import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { ExtractionResult, Failure, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../core/models';

export interface ProbeBudget { maxRequests: number; maxBytes: number; deadlineMs: number }
export interface SourceProbeSnapshot { finalUrl: URL; status: number; headers: Readonly<Record<string, string>>; htmlSample?: string; domFingerprint?: string; assetPaths: readonly string[]; scriptSignatures: readonly string[]; routeHints: readonly string[] }
export interface FamilyMatch { familyId: string; confidence: number; evidence: readonly FamilyEvidence[] }
export interface SourceFamily {
  readonly id: string;
  classify(source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null;
  discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}
export interface FamilyRecognitionOptions { minimumConfidence?: number; runnerUpMargin?: number; overrides?: Readonly<Record<string, { minimumConfidence?: number; runnerUpMargin?: number }>> }
export type FamilyRecognition = { type: 'matched'; match: FamilyMatch; snapshot: SourceProbeSnapshot } | { type: 'failure'; failure: Failure; snapshot?: SourceProbeSnapshot };

export class SourceFamilyProbeRunner {
  public constructor(private readonly services: RequestServices, private readonly families: readonly SourceFamily[], private readonly budget: ProbeBudget, private readonly options: FamilyRecognitionOptions = {}) {}
  public async recognize(source: SourceRecord, signal: AbortSignal): Promise<FamilyRecognition> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.budget.deadlineMs);
    try {
      if (this.budget.maxRequests < 1) return this.failed('FAMILY_PROBE_BUDGET_EXCEEDED', source, 'Probe request budget is empty');
      const response = await this.services.request({ url: new URL(`https://${source.canonicalDomain}/`), expectedContent: 'html', timeoutMs: this.budget.deadlineMs, maxBytes: this.budget.maxBytes }, controller.signal);
      if (response.body.byteLength > this.budget.maxBytes || response.truncated) return this.failed('FAMILY_PROBE_BUDGET_EXCEEDED', source, 'Probe byte budget exceeded');
      const html = response.text();
      const $ = cheerio.load(html);
      const assetPaths = [...new Set($('script[src],link[href],img[src]').map((_index, element) => $(element).attr('src') ?? $(element).attr('href')).get().filter((value): value is string => Boolean(value)).map((value) => {
        try {
          return new URL(value, response.finalUrl).pathname;
        } catch {
          return value;
        }
      }))].sort();
      const routeHints = [...new Set($('a[href],form[action]').map((_index, element) => $(element).attr('href') ?? $(element).attr('action')).get().filter((value): value is string => Boolean(value)).map((value) => {
        try {
          return new URL(value, response.finalUrl).pathname;
        } catch {
          return value;
        }
      }))].sort().slice(0, 100);
      const scriptSignatures = $('script:not([src])').map((_index, element) => createHash('sha256').update($(element).text().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16)).get().filter(Boolean).sort();
      const domShape = $('body *').map((_index, element) => element.tagName).get().slice(0, 250).join('>');
      const snapshot: SourceProbeSnapshot = { finalUrl: response.finalUrl, status: response.status, headers: response.headers, htmlSample: html, domFingerprint: createHash('sha256').update(domShape).digest('hex'), assetPaths, scriptSignatures, routeHints };
      const matches = this.families.map(family => family.classify(source, snapshot)).filter((match): match is FamilyMatch => match !== null).sort((a, b) => b.confidence - a.confidence || a.familyId.localeCompare(b.familyId));
      const winner = matches[0];
      if (!winner) return this.failed('UNSUPPORTED_SOURCE_PATTERN', source, 'No known source family matched', snapshot);
      const config = this.options.overrides?.[winner.familyId];
      const minimum = config?.minimumConfidence ?? this.options.minimumConfidence ?? 0.75;
      const margin = config?.runnerUpMargin ?? this.options.runnerUpMargin ?? 0.15;
      if (winner.confidence < minimum) return this.failed('UNSUPPORTED_SOURCE_PATTERN', source, 'No family cleared the confidence threshold', snapshot);
      if (matches[1] && winner.confidence - matches[1].confidence < margin) return this.failed('FAMILY_PROBE_AMBIGUOUS', source, 'Source family evidence is ambiguous', snapshot);
      return { type: 'matched', match: winner, snapshot };
    } catch (error) {
      if (controller.signal.aborted) return this.failed('FAMILY_PROBE_TIMEOUT', source, 'Source family probe timed out');
      if (error && typeof error === 'object' && 'failure' in error) {
        const failure = (error as { failure?: Failure }).failure;
        if (failure?.code === 'HTTP_FORBIDDEN' || failure?.code === 'RATE_LIMITED') return this.failed('FAMILY_PROBE_BLOCKED', source, failure.message);
      }
      return this.failed('FAMILY_PROBE_NETWORK_FAILED', source, error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    }
  }

  private failed(code: 'FAMILY_PROBE_BUDGET_EXCEEDED' | 'UNSUPPORTED_SOURCE_PATTERN' | 'FAMILY_PROBE_AMBIGUOUS' | 'FAMILY_PROBE_TIMEOUT' | 'FAMILY_PROBE_BLOCKED' | 'FAMILY_PROBE_NETWORK_FAILED', source: SourceRecord, message: string, snapshot?: SourceProbeSnapshot): FamilyRecognition {
    return { type: 'failure', failure: { code, message, stage: 'stage:discovery', sourceId: source.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', ...(snapshot && { status: snapshot.status, finalUrl: snapshot.finalUrl.href }), bodyCaptured: false } }, ...(snapshot && { snapshot }) };
  }
}
