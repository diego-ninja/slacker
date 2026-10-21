// ABOUTME: Configures the Slack SDK transport and request lifetime
// ABOUTME: Delegates retries to persisted-state synchronization

import { WebClient, LogLevel, type WebClientOptions } from '@slack/web-api';

export function createSlackConnection(
  token: string,
  options: Pick<WebClientOptions, 'slackApiUrl' | 'logger' | 'timeout'> = {},
): WebClient {
  const timeout = options.timeout ?? 5000;
  return new WebClient(token, {
    ...options,
    timeout,
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
    logLevel: LogLevel.ERROR,
    requestInterceptor: (request) => {
      request.signal = AbortSignal.timeout(timeout);
      return request;
    },
  });
}
