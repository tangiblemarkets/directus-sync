import createHttpError from 'http-errors';
import { MigrationClient } from './migration-client';
import { Cacheable } from 'typescript-cacheable';
import {
  getRetryConfig,
  isRetryableStatus,
  isRetryableTransportError,
  sleepWithJitter,
} from './extension-client-retry';

export const NO_ID_MAP_MESSAGE = 'No id map found';

/**
 * This class provides an interface to interact with the Directus extension sync endpoints.
 */
export abstract class ExtensionClient {
  protected readonly extensionUri = '/directus-extension-sync';

  constructor(protected readonly migrationClient: MigrationClient) {}

  protected async fetch<T = unknown>(
    uri: string,
    method: RequestInit['method'] = 'GET',
    payload: unknown = undefined,
    options: RequestInit = {},
  ): Promise<T> {
    const { url, token } = await this.getUrlAndToken();
    const doFetch = await this.getFetch();
    const fullUrl = `${url}${this.extensionUri}${uri}`;
    const fetchOpts: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      method,
      body: payload ? JSON.stringify(payload) : null,
      ...options,
    };

    const { max, baseMs } = getRetryConfig();
    const methodName = (method ?? 'GET').toUpperCase();

    for (let attempt = 0; attempt <= max; attempt++) {
      let response: Response;
      try {
        response = await doFetch(fullUrl, fetchOpts);
      } catch (err) {
        if (attempt < max && isRetryableTransportError(err)) {
          await sleepWithJitter(baseMs, attempt + 1);
          continue;
        }
        throw err;
      }

      if (response.ok) {
        try {
          return (await response.json()) as T;
        } catch {
          return (await response.text()) as T;
        }
      }

      if (attempt < max && isRetryableStatus(response.status, methodName)) {
        await sleepWithJitter(baseMs, attempt + 1);
        continue;
      }

      let error;
      try {
        const errPayload: Error = await response.json();
        error = createHttpError(response.status, errPayload.message);
      } catch (e) {
        if (response.status === 404 && response.statusText === 'Not Found') {
          error = createHttpError(
            response.status,
            `${response.statusText}: Did you add directus-extension-sync to Directus? Please check the version of the extension as well.`,
          );
        } else {
          error = createHttpError(response.status, response.statusText);
        }
      }
      throw error;
    }

    // Defensive: loop always returns or throws.
    throw createHttpError(503, 'extension-client retry loop exhausted');
  }

  @Cacheable()
  protected async getUrlAndToken() {
    const directus = await this.migrationClient.get();
    //Remove trailing slash
    const url = directus.url.toString().replace(/\/$/, '');
    const token = await directus.getToken();
    if (!token) {
      throw new Error('Cannot get token from Directus');
    }
    return { url, token };
  }

  @Cacheable()
  protected async getFetch() {
    const directus = await this.migrationClient.get();
    return directus.globals.fetch as typeof fetch;
  }
}
