/** How a failed request to the model reads, in the panel and the AI menu. */

import type { ChatFailureCode } from '../agent/session';

export const FAILURE_TEXT: Record<ChatFailureCode, string> = {
  'no-model': 'ai.error.noModel',
  'not-connected': 'ai.error.notConnected',
  'key-needed': 'ai.error.keyNeeded',
  unauthorized: 'ai.error.unauthorized',
  'rate-limited': 'ai.error.rateLimited',
  network: 'ai.error.network',
  other: 'ai.error.other',
};

/** Failures fixed in the settings, with a button that goes there. */
export const SETTINGS_FIXES = new Set<ChatFailureCode>([
  'no-model',
  'not-connected',
  'key-needed',
  'unauthorized',
]);

/** Failures the message explains in full; the service's words add nothing. */
export const SELF_EXPLAINED = new Set<ChatFailureCode>([
  'no-model',
  'not-connected',
  'key-needed',
]);
