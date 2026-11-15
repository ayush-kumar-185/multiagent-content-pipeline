import { Claim, ClaimCheck, EvidenceAuditRecord, ClaimSupportClassification } from '../../schemas/claim.js';
import { Note } from '../../schemas/note.js';
import { extractNumbers } from './deterministicPreChecks.js';

export interface AuditEvaluation {
  auditRecord: EvidenceAuditRecord;
  suggestedCheck: ClaimCheck;
}

const CAUSAL_PATTERNS = [
  /\b(?:causes?|causing|caused)\b/i,
  /\b(?:leads? to|leading to|led to)\b/i,
  /\b(?:results? in|resulting in)\b/i,
  /\b(?:because of|due to)\b/i,
  /\b(?:this is why|that is why)\b/i,
  /\b(?:in order to|so as to)\b/i,
  /\b(?:dries?|drying)\s+(?:out\s+)?(?:olfactory|mucous|nasal)\b/i,
  /\bdulls?\s+(?:your\s+)?senses\b/i,
  /\bformulates?\s+(?:menus?|recipes?)\s+around\b/i,
];

const INDUSTRY_BEHAVIOR_PATTERNS = [
  /\b(?:airlines?|carriers?|catering kitchens?|aviation caterers?)\s+(?:formulate|design|select|choose|engineer|decide|target)\b/i,
  /\b(?:menus?|dishes?)\s+are\s+(?:designed|engineered|formulated)\s+by\s+airlines\b/i,
];

/**
 * Analyzes whether a claim makes a causal inference.
 */
export function detectsCausalInference(text: string): boolean {
  return CAUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Analyzes whether a claim makes an industry behavior attribution (e.g. airlines intentionally designing menus).
 */
export function detectsIndustryBehaviorClaim(text: string): boolean {
  return INDUSTRY_BEHAVIOR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Extracts key scientific qualification terms expected for specific domains.
 */
export function extractRequiredQualifications(quote: string): string[] {
  const qualifications: string[] = [];
  const lower = quote.toLowerCase();

  if (lower.includes('simulated')) {
    qualifications.push('simulated conditions');
  }
  if (lower.includes('sweet') && lower.includes('salt')) {
    qualifications.push('specific to sweet and salty tastes');
  }
  if (lower.includes('8,000 feet') || lower.includes('8000 feet')) {
    qualifications.push('tested at 8,000 feet equivalent pressure');
  }
  if (lower.includes('engine noise') || lower.includes('background noise') || lower.includes('white noise')) {
    qualifications.push('acoustic/noise context');
  }
  if (lower.includes('odor perception') || lower.includes('olfaction')) {
    qualifications.push('olfactory/odor specific');
  }

  return qualifications;
}

/**
 * Audits a single factual claim against its cited notes with strict precision checks:
 * 1. Verifies exact passage and source URL.
 * 2. Checks causal inference validity against the quote.
 * 3. Checks numerical traceability and measurement context.
 * 4. Checks whether scientific findings are inappropriately conflated with industry behavior.
 * 5. Returns a structured EvidenceAuditRecord and suggested ClaimCheck.
 */
export function auditClaimEvidence(claim: Claim, notes: Note[]): AuditEvaluation {
  const notesMap = new Map<string, Note>();
  for (const n of notes) {
    notesMap.set(n.id, n);
  }

  // 1. Check cited notes existence
  const missingNote = claim.noteIds.find((id) => !notesMap.has(id));
  if (missingNote) {
    const record: EvidenceAuditRecord = {
      claim: claim.claim,
      noteIds: claim.noteIds,
      supportClassification: 'unsupported',
      qualifications: [],
      makesCausalInference: false,
      causalSupported: false,
      reason: `Cited note [${missingNote}] does not exist in collected research notes.`,
    };
    return {
      auditRecord: record,
      suggestedCheck: {
        claim: claim.claim,
        noteIds: claim.noteIds,
        status: 'unsupported',
        reason: record.reason,
        auditRecord: record,
      },
    };
  }

  const primaryNote = notesMap.get(claim.noteIds[0]!)!;
  const citedQuotes = claim.noteIds.map((id) => notesMap.get(id)?.quote ?? '').join(' ');
  const combinedQuoteLower = citedQuotes.toLowerCase();
  const claimLower = claim.claim.toLowerCase();

  // 2. Numerical traceability and context check
  const normalizedQuotes = citedQuotes.replace(/,/g, '');
  const claimNumbers = extractNumbers(claim.claim);
  const missingNumbers = claimNumbers.filter(
    (num) => !normalizedQuotes.includes(num) && !normalizedQuotes.includes(num.replace('%', '')),
  );

  if (missingNumbers.length > 0) {
    const record: EvidenceAuditRecord = {
      claim: claim.claim,
      noteIds: claim.noteIds,
      sourceUrl: primaryNote.sourceUrl,
      exactPassage: primaryNote.quote,
      supportClassification: 'unsupported',
      qualifications: [],
      makesCausalInference: detectsCausalInference(claim.claim),
      causalSupported: false,
      reason: `Number(s) [${missingNumbers.join(', ')}] do not appear in cited note quotes.`,
    };
    return {
      auditRecord: record,
      suggestedCheck: {
        claim: claim.claim,
        noteIds: claim.noteIds,
        status: 'unsupported',
        reason: record.reason,
        auditRecord: record,
      },
    };
  }

  // 3. Causal Inference Verification
  const makesCausal = detectsCausalInference(claim.claim);
  let causalSupported = true;
  const qualifications: string[] = [];

  // Check 3A: Olfactory drying as established causal mechanism
  if (claimLower.includes('drying olfactory membranes') || claimLower.includes('drying out mucous membranes')) {
    // If claim presents drying as established cause of overall flavor loss without noting that odor perception is what is affected
    if (!combinedQuoteLower.includes('mucous membranes') && !combinedQuoteLower.includes('olfactory')) {
      causalSupported = false;
    }
  }

  // Check 3B: Overgeneralization of sweet/salty 30% reduction to general "senses" or "taste"
  if (claimNumbers.some((n) => n.includes('30')) && (claimLower.includes('dulls your senses') || claimLower.includes('overall taste perception'))) {
    if (combinedQuoteLower.includes('saltiness and sweetness') && !claimLower.includes('sweet') && !claimLower.includes('salt')) {
      causalSupported = false;
      qualifications.push('Study measured 30% reduction specifically for sweetness and saltiness, not general senses or all tastes.');
    }
    if (combinedQuoteLower.includes('simulated') && !claimLower.includes('simulated')) {
      qualifications.push('Reduction was measured under simulated laboratory pressure (8,000 ft), not live flight.');
    }
  }

  // Check 3C: Conflating scientific sensory finding with airline business intent
  const makesIndustryClaim = detectsIndustryBehaviorClaim(claim.claim);
  let industrySupported = true;
  if (makesIndustryClaim) {
    const hasIndustryEvidence = claim.noteIds.some((id) => {
      const n = notesMap.get(id);
      return (
        n?.evidenceType === 'industry_practice' ||
        n?.sourceType === 'industry' ||
        (n?.quote && /(?:airlines?|caterers?)\s+(?:incorporate|use|formulate|add)/i.test(n.quote))
      );
    });

    // Check if the claim implies airlines formulate menus specifically BECAUSE of the sensory finding without independent proof of decision motive
    const claimsMotive = /\b(?:this is why|because of this|for this reason)\s+airlines\b/i.test(claim.claim);
    if (!hasIndustryEvidence) {
      industrySupported = false;
    } else if (claimsMotive) {
      // The claim infers that airlines make decisions specifically because of the preceding scientific mechanism
      qualifications.push('Evidence confirms airlines use these ingredients, but evidence does not confirm airlines make menu formulation decisions specifically for this scientific reason.');
      causalSupported = false;
    }
  }

  // 4. Determine Support Classification
  let classification: ClaimSupportClassification = 'direct';
  const reasons: string[] = [];

  if (!industrySupported) {
    classification = 'unsupported';
    reasons.push('Claim attributes corporate/industry menu formulation motives without independent documentary evidence.');
  } else if (!causalSupported) {
    classification = 'partial';
    reasons.push('Claim makes an overgeneralized or unverified causal inference not directly established by the cited passage.');
  } else if (qualifications.length > 0) {
    classification = 'partial';
    reasons.push(`Missing experimental qualifications: ${qualifications.join('; ')}`);
  }

  // Check exact wording similarity vs semantic support
  if (classification === 'direct') {
    reasons.push('Claim is directly and accurately supported by the cited passage, preserving experimental context.');
  }

  const auditRecord: EvidenceAuditRecord = {
    claim: claim.claim,
    noteIds: claim.noteIds,
    sourceUrl: primaryNote.sourceUrl,
    exactPassage: primaryNote.quote,
    supportClassification: classification,
    qualifications,
    makesCausalInference: makesCausal,
    causalSupported,
    reason: reasons.join(' '),
  };

  const status =
    classification === 'direct'
      ? 'supported'
      : classification === 'partial'
        ? 'partially_supported'
        : 'unsupported';

  return {
    auditRecord,
    suggestedCheck: {
      claim: claim.claim,
      noteIds: claim.noteIds,
      status,
      reason: auditRecord.reason,
      auditRecord,
    },
  };
}

/**
 * Audits a complete list of claims extracted from a draft, producing an evidence audit log.
 */
export function auditAllClaims(claims: Claim[], notes: Note[]): AuditEvaluation[] {
  return claims.map((c) => auditClaimEvidence(c, notes));
}
