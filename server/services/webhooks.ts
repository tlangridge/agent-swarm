// Webhook notification stub — placeholder for future implementation.
// Call sites use fireWebhook() which is a no-op until this is fleshed out.

export type WebhookEvent = 'shift:started' | 'shift:ended' | 'shift:closing' | 'agent:failed' | 'agent:respawned' | 'agent:dismissed' | 'shift:ready-for-review' | 'cost:exceeded' | 'cost:warning';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function fireWebhook(_event: WebhookEvent, _payload: Record<string, unknown>): void {
  // TODO: implement webhook registration, persistence, and HTTP dispatch
}
