import {
  getRetryConfig,
  isRetryableStatus,
  isRetryableTransportError,
  sleepWithJitter,
} from './extension-client-retry';

describe('extension-client-retry', () => {
  describe('getRetryConfig', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('returns defaults when env vars are unset', () => {
      delete process.env.DIRECTUS_SYNC_EXTENSION_RETRY_MAX;
      delete process.env.DIRECTUS_SYNC_EXTENSION_RETRY_BASE_MS;
      expect(getRetryConfig()).toEqual({ max: 3, baseMs: 2000 });
    });

    it('respects env var overrides', () => {
      process.env.DIRECTUS_SYNC_EXTENSION_RETRY_MAX = '5';
      process.env.DIRECTUS_SYNC_EXTENSION_RETRY_BASE_MS = '500';
      expect(getRetryConfig()).toEqual({ max: 5, baseMs: 500 });
    });

    it('falls back to defaults on invalid env values', () => {
      process.env.DIRECTUS_SYNC_EXTENSION_RETRY_MAX = 'not-a-number';
      process.env.DIRECTUS_SYNC_EXTENSION_RETRY_BASE_MS = '-1';
      expect(getRetryConfig().max).toBe(3);
      expect(getRetryConfig().baseMs).toBe(2000);
    });

    it('accepts zero (disables retries)', () => {
      process.env.DIRECTUS_SYNC_EXTENSION_RETRY_MAX = '0';
      expect(getRetryConfig().max).toBe(0);
    });
  });

  describe('isRetryableStatus', () => {
    it('retries 502/503/504 on idempotent methods', () => {
      expect(isRetryableStatus(502, 'GET')).toBe(true);
      expect(isRetryableStatus(503, 'GET')).toBe(true);
      expect(isRetryableStatus(504, 'GET')).toBe(true);
      expect(isRetryableStatus(503, 'DELETE')).toBe(true);
      expect(isRetryableStatus(503, 'HEAD')).toBe(true);
    });

    it('does not retry 500 or 501', () => {
      expect(isRetryableStatus(500, 'GET')).toBe(false);
      expect(isRetryableStatus(501, 'GET')).toBe(false);
    });

    it('does not retry 4xx', () => {
      expect(isRetryableStatus(400, 'GET')).toBe(false);
      expect(isRetryableStatus(401, 'GET')).toBe(false);
      expect(isRetryableStatus(404, 'GET')).toBe(false);
    });

    it('does NOT retry retryable status codes on POST/PATCH (idempotency guard)', () => {
      expect(isRetryableStatus(503, 'POST')).toBe(false);
      expect(isRetryableStatus(503, 'PATCH')).toBe(false);
      expect(isRetryableStatus(502, 'POST')).toBe(false);
      expect(isRetryableStatus(504, 'PATCH')).toBe(false);
    });

    it('is case-insensitive on method', () => {
      expect(isRetryableStatus(503, 'get')).toBe(true);
      expect(isRetryableStatus(503, 'post')).toBe(false);
    });
  });

  describe('isRetryableTransportError', () => {
    it('retries on TypeError (network failure)', () => {
      expect(isRetryableTransportError(new TypeError('fetch failed'))).toBe(
        true,
      );
    });

    it('does not retry on other Error types', () => {
      expect(isRetryableTransportError(new Error('boom'))).toBe(false);
      expect(isRetryableTransportError(new RangeError('range'))).toBe(false);
      expect(isRetryableTransportError(undefined)).toBe(false);
      expect(isRetryableTransportError(null)).toBe(false);
      expect(isRetryableTransportError('string error')).toBe(false);
    });
  });

  describe('sleepWithJitter', () => {
    it('sleeps approximately the expected time on attempt 1', async () => {
      const start = Date.now();
      await sleepWithJitter(50, 1);
      const elapsed = Date.now() - start;
      // base 50ms, ±25% jitter → expect roughly 37-62ms
      expect(elapsed).toBeGreaterThanOrEqual(35);
      expect(elapsed).toBeLessThan(200);
    });

    it('scales exponentially with attempt', async () => {
      const start = Date.now();
      await sleepWithJitter(50, 2);
      const elapsed = Date.now() - start;
      // base 50ms * 2^1 = 100ms, ±25% → expect roughly 75-125ms
      expect(elapsed).toBeGreaterThanOrEqual(70);
    });
  });
});
