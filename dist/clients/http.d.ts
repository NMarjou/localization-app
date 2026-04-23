interface HttpClientOptions {
    baseUrl: string;
    apiKey: string;
    maxRetries?: number;
    retryDelay?: number;
}
export declare class HttpClient {
    private baseUrl;
    private apiKey;
    private maxRetries;
    private retryDelay;
    private logger;
    constructor(options: HttpClientOptions);
    get<T>(path: string, params?: Record<string, unknown>): Promise<T>;
    post<T>(path: string, body: unknown): Promise<T>;
    put<T>(path: string, body: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
    private requestWithRetry;
    private request;
    private buildUrl;
    private sleep;
}
export {};
//# sourceMappingURL=http.d.ts.map