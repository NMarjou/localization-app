export declare class ServiceError extends Error {
    code: string;
    statusCode: number;
    constructor(message: string, code: string, statusCode?: number);
}
export declare class LokaliseError extends ServiceError {
    constructor(message: string, statusCode?: number);
}
export declare class ClaudeError extends ServiceError {
    constructor(message: string, statusCode?: number);
}
export declare class ValidationError extends ServiceError {
    constructor(message: string);
}
export declare class WebhookError extends ServiceError {
    constructor(message: string);
}
export declare function isServiceError(error: unknown): error is ServiceError;
//# sourceMappingURL=errors.d.ts.map