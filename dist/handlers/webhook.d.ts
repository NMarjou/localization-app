import type { LokaliseWebhookEvent, WebhookContext } from "../types/webhook.js";
export declare class WebhookHandler {
    private pendingBatches;
    private logger?;
    private getLogger;
    validateSignature(payload: string, signature: string, secret: string): boolean;
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