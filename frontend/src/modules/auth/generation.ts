let generation = 0;
let controller = new AbortController();

export class StaleIdentityError extends Error {
  constructor() { super('Authentication operation was superseded'); this.name = 'StaleIdentityError'; }
}

export function currentIdentityGeneration(): number { return generation; }
export function advanceIdentityGeneration(): number {
  controller.abort();
  controller = new AbortController();
  return ++generation;
}
export function identitySignal(): AbortSignal { return controller.signal; }
export function assertIdentityGeneration(expected: number): void {
  if (generation !== expected) throw new StaleIdentityError();
}
