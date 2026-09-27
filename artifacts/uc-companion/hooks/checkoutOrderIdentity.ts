export interface CheckoutOrderIdentity {
  idempotencyKey: string;
  codReference: string;
}

export function createCheckoutOrderIdentity(uniquePart?: string): CheckoutOrderIdentity {
  const suffix = uniquePart ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return {
    idempotencyKey: suffix,
    codReference: `cod_${suffix}`,
  };
}

export function retainCheckoutOrderIdentity(
  current: CheckoutOrderIdentity | null,
  uniquePart?: string,
): CheckoutOrderIdentity {
  return current ?? createCheckoutOrderIdentity(uniquePart);
}