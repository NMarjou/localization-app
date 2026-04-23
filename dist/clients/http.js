import { getLogger } from "../utils/logger.js";
import { LokaliseError } from "../utils/errors.js";
export class HttpClient {
    baseUrl;
    apiKey;
    maxRetries;
    retryDelay;
    logger;
    constructor(options) {
        this.baseUrl = options.baseUrl;
        this.apiKey = options.apiKey;
        this.maxRetries = options.maxRetries ?? 3;
        this.retryDelay = options.retryDelay ?? 1000;
        this.logger = getLogger();
    }
    async get(path, params) {
        const url = this.buildUrl(path, params);
        return this.requestWithRetry("GET", url);
    }
    async post(path, body) {
        const url = this.buildUrl(path);
        return this.requestWithRetry("POST", url, body);
    }
    async put(path, body) {
        const url = this.buildUrl(path);
        return this.requestWithRetry("PUT", url, body);
    }
    async delete(path) {
        const url = this.buildUrl(path);
        return this.requestWithRetry("DELETE", url);
    }
    async requestWithRetry(method, url, body, options = {}) {
        const maxRetries = options.maxRetries ?? this.maxRetries;
        const delayMs = options.delayMs ?? this.retryDelay;
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await this.request(method, url, body);
            }
            catch (error) {
                lastError = error;
                const isRetryable = error instanceof LokaliseError &&
                    (error.statusCode === 429 ||
                        error.statusCode === 503 ||
                        error.statusCode === 504);
                const isNetworkError = error instanceof LokaliseError && error.statusCode === 0;
                if (!isRetryable && !isNetworkError) {
                    throw error;
                }
                if (attempt < maxRetries) {
                    const waitMs = delayMs * Math.pow(2, attempt);
                    this.logger.debug({ attempt, waitMs, error: lastError.message }, "Retrying request");
                    await this.sleep(waitMs);
                }
            }
        }
        throw lastError;
    }
    async request(method, url, body) {
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
            let data = null;
            if (contentType?.includes("application/json")) {
                data = await response.json();
            }
            else if (response.ok) {
                data = await response.text();
            }
            if (!response.ok) {
                throw new LokaliseError(`Lokalise API error: ${response.statusText}`, response.status);
            }
            return data;
        }
        catch (error) {
            if (error instanceof LokaliseError) {
                throw error;
            }
            if (error instanceof Error) {
                throw new LokaliseError(`Network error: ${error.message}`, 0);
            }
            throw new LokaliseError("Unknown error during API request", 0);
        }
    }
    buildUrl(path, params) {
        // Strip leading slash so new URL() preserves the base URL's path segment
        // (e.g. "/api2"). Without this, an absolute path replaces it entirely.
        const relativePath = path.startsWith("/") ? path.slice(1) : path;
        const base = this.baseUrl.endsWith("/") ? this.baseUrl : this.baseUrl + "/";
        const url = new URL(relativePath, base);
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    url.searchParams.append(key, String(value));
                }
            });
        }
        return url.toString();
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
//# sourceMappingURL=http.js.map