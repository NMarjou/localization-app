import type { LokaliseWebhookEvent, WebhookContext } from "../types/webhook.js";
export declare class WebhookHandler {
    private pendingBatches;
    private logger?;
    private getLogger;
    /**
     * Lokalise webhooks authenticate by echoing a configured secret verbatim
     * in one of three headers (X-Secret, X-Api-Key, or a custom header).
     * There is no HMAC. We do a constant-time equality check against
     * WEBHOOK_SECRET.
     */
    validateSecret(received: string, secret: string): boolean;
    handleEvent(event: LokaliseWebhookEvent, context: WebhookContext): Promise<void>;
    private getTranslationText;
    private handleTranslationRequest;
    private handleTranslationApproved;
    pushResults(response: any, context: WebhookContext): Promise<void>;
    pollPendingBatches(): Promise<void>;
    getPendingBatchCount(): number;
}
export declare const webhookHandler: WebhookHandler;
//# sourceMappingURL=webhook.d.ts.map