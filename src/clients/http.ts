import { getLogger } from "../utils/logger.js";
import { LokaliseError } from "../utils/errors.js";
import type { Logger } from "pino";

interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  maxRetries?: number;
  retryDelay?: number;
}

interface RetryOptions {
  maxRetries: number;
  delayMs: number;
}

export class HttpClient {
  private baseUrl: string;
  private apiKey: string;
  private maxRetries: number;
  private retryDelay: number;
  private logger: Logger;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelay = options.retryDelay ?? 1000;
    this.logger = getLogger();
  }

  async get<T>(
    path: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.requestWithRetry<T>("GET", url);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>("POST", url, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>("PUT", url, body);
  }

  async delete<T>(path: string): Promise<T> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>("DELETE", url);
  }

  private async requestWithRetry<T>(
    method: string,
    url: string,
    body?: unknown,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const delayMs = options.delayMs ?? this.retryDelay;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.request<T>(method, url, body);
      } catch (error) {
        lastError = error as Error;

        const isRetryable =
          error instanceof LokaliseError &&
          (error.statusCode === 429 ||
            error.statusCode === 503 ||
            error.statusCode === 504);

        const isNetworkError =
          error instanceof LokaliseError && error.statusCode === 0;

        if (!isRetryable && !isNetworkError) {
          throw error;
        }

        if (attempt < maxRetries) {
          const waitMs = delayMs * Math.pow(2, attempt);
          this.logger.debug(
            { attempt, waitMs, error: lastError.message },
            "Retrying request"
          );
          await this.sleep(waitMs);
        }
      }
    }

    throw lastError;
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<T> {
    const headers = {
      "X-Api-Token": this.apiKey,
      "Content-Type": "application/json",
    };

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const contentType = response.headers.get("content-type");
      let data: unknown = null;

      if (contentType?.includes("application/json")) {
        data = await response.json();
      } else if (response.ok) {
        data = await response.text();
      }

      if (!response.ok) {
        throw new LokaliseError(
          `Lokalise API error: ${response.statusText}`,
          response.status
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof LokaliseError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new LokaliseError(`Network error: ${error.message}`, 0);
      }

      throw new LokaliseError("Unknown error during API request", 0);
    }
  }

  private buildUrl(
    path: string,
    params?: Record<string, unknown>
  ): string {
    const url = new URL(path, this.baseUrl);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
