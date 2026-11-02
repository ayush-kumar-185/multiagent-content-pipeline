import { GraphState } from '../schemas/state.js';

export const MAX_RESEARCH_ROUNDS = 2;
export const MAX_WRITE_CYCLES = 3;

export const ROUTE_TARGETS = {
  RESEARCHER: 'researcher',
  WRITER: 'writer',
  FACT_CHECKER: 'factChecker',
  EDITOR: 'editor',
  PREPARE_REVIEW: 'prepareReview',
  HUMAN_REVIEW: 'humanReview',
} as const;

export type RouteADestination =
  | typeof ROUTE_TARGETS.RESEARCHER
  | typeof ROUTE_TARGETS.WRITER
  | typeof ROUTE_TARGETS.EDITOR
  | typeof ROUTE_TARGETS.PREPARE_REVIEW;

export type RouteBDestination = typeof ROUTE_TARGETS.WRITER | typeof ROUTE_TARGETS.PREPARE_REVIEW;

/**
 * Route A (after factChecker):
 * - any needs_more_research AND researchRounds < 2 -> researcher
 * - any needs_more_research AND researchRounds >= 2 -> prepareReview (cap hit)
 * - any unsupported AND writeCycles < 3 -> writer (with flags)
 * - any unsupported AND writeCycles >= 3 -> prepareReview (cap hit)
 * - all supported -> editor
 */
export function routeAfterFactChecker(state: GraphState): RouteADestination {
  if (state.status === 'budget_exceeded') {
    return ROUTE_TARGETS.PREPARE_REVIEW;
  }

  const { claimChecks, researchRounds, writeCycles } = state;

  const hasNeedsMoreResearch = claimChecks.some((c) => c.status === 'needs_more_research');
  const hasUnsupported = claimChecks.some((c) => c.status === 'unsupported');

  if (hasNeedsMoreResearch) {
    if (researchRounds < MAX_RESEARCH_ROUNDS) {
      return ROUTE_TARGETS.RESEARCHER;
    }
    // Cap hit on research rounds
    return ROUTE_TARGETS.PREPARE_REVIEW;
  }

  if (hasUnsupported) {
    if (writeCycles < MAX_WRITE_CYCLES) {
      return ROUTE_TARGETS.WRITER;
    }
    // Cap hit on write cycles
    return ROUTE_TARGETS.PREPARE_REVIEW;
  }

  // All claims are supported (or no claim flags)
  return ROUTE_TARGETS.EDITOR;
}

/**
 * Route B (after editor):
 * - accept -> prepareReview (which moves to humanReview)
 * - revise AND writeCycles < 3 -> writer (with feedback)
 * - revise AND cap hit (writeCycles >= 3) -> prepareReview (feedback in openIssues)
 */
export function routeAfterEditor(state: GraphState): RouteBDestination {
  if (state.status === 'budget_exceeded') {
    return ROUTE_TARGETS.PREPARE_REVIEW;
  }

  const { editorVerdict, writeCycles } = state;

  if (editorVerdict?.decision === 'accept') {
    return ROUTE_TARGETS.PREPARE_REVIEW;
  }

  if (editorVerdict?.decision === 'revise') {
    if (writeCycles < MAX_WRITE_CYCLES) {
      return ROUTE_TARGETS.WRITER;
    }
    // Cap hit on revision cycles
    return ROUTE_TARGETS.PREPARE_REVIEW;
  }

  // Default fallback to review if no verdict is present
  return ROUTE_TARGETS.PREPARE_REVIEW;
}
