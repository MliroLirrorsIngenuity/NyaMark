/** How a failed request to the model reads, in the panel and the AI menu. */

import { i18next } from '../../i18n';
import type { ChatFailure, ChatFailureCode } from '../agent/session';

export const FAILURE_TEXT: Record<ChatFailureCode, string> = {
  'no-model': 'ai.error.noModel',
  'not-connected': 'ai.error.notConnected',
  'key-needed': 'ai.error.keyNeeded',
  unauthorized: 'ai.error.unauthorized',
  'rate-limited': 'ai.error.rateLimited',
  network: 'ai.error.network',
  'signed-out': 'ai.error.signedOut',
  'renew-failed': 'ai.error.renewFailed',
  'usage-limit': 'ai.error.usageLimit',
  'plan-unavailable': 'ai.error.planUnavailable',
  other: 'ai.error.other',
};

/** Failures fixed in the settings, with a button that goes there. */
export const SETTINGS_FIXES = new Set<ChatFailureCode>([
  'no-model',
  'not-connected',
  'key-needed',
  'unauthorized',
  'signed-out',
  'renew-failed',
]);

/** Failures the user looks into on ChatGPT's usage page. */
export const USAGE_FIXES = new Set<ChatFailureCode>(['usage-limit']);

/** Failures the message explains in full; the service's words add nothing. */
export const SELF_EXPLAINED = new Set<ChatFailureCode>([
  'no-model',
  'not-connected',
  'key-needed',
  'signed-out',
]);

/** What a failure says: its reading, and the service's own words where they add to it. */
export function failureReading(failure: ChatFailure): {
  text: string;
  detail: string | null;
} {
  const { code, message, status } = failure;
  return {
    text: i18next.t(FAILURE_TEXT[code], { status }),
    detail: message && !SELF_EXPLAINED.has(code) ? message : null,
  };
}
