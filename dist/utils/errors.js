export class ServiceError extends Error {
    code;
    statusCode;
    constructor(message, code, statusCode = 500) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.name = "ServiceError";
        Object.setPrototypeOf(this, ServiceError.prototype);
    }
}
export class LokaliseError extends ServiceError {
    constructor(message, statusCode = 500) {
        super(message, "LOKALISE_ERROR", statusCode);
        this.name = "LokaliseError";
        Object.setPrototypeOf(this, LokaliseError.prototype);
    }
}
export class ClaudeError extends ServiceError {
    constructor(message, statusCode = 500) {
        super(message, "CLAUDE_ERROR", statusCode);
        this.name = "ClaudeError";
        Object.setPrototypeOf(this, ClaudeError.prototype);
    }
}
export class ValidationError extends ServiceError {
    constructor(message) {
        super(message, "VALIDATION_ERROR", 400);
        this.name = "ValidationError";
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}
export class WebhookError extends ServiceError {
    constructor(message) {
        super(message, "WEBHOOK_ERROR", 400);
        this.name = "WebhookError";
        Object.setPrototypeOf(this, WebhookError.prototype);
    }
}
export function isServiceError(error) {
    return error instanceof ServiceError;
}
//# sourceMappingURL=errors.js.map