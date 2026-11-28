import { useCallback, useReducer, useRef } from 'react';
import axios from 'axios';
import { ErrorEnvelopeSchema } from '../../core/api/contractsV2';
import { beginRecovery, completeRecovery, proveRecovery } from './api';

export type RecoveryMethod = 'saved_code' | 'email';
export type RecoveryStep = 'identify' | 'prove' | 'reset' | 'codes';

export interface RecoveryState {
  step: RecoveryStep;
  method: RecoveryMethod;
  recoveryId: string | null;
  grant: string | null;
  codes: string[] | null;
  pending: boolean;
  error: string | null;
}

export const initialRecoveryState: RecoveryState = {
  step: 'identify', method: 'saved_code', recoveryId: null, grant: null, codes: null, pending: false, error: null,
};

type Action =
  | { type: 'method'; method: RecoveryMethod }
  | { type: 'start' }
  | { type: 'failed'; error: string }
  | { type: 'begun'; recoveryId: string }
  | { type: 'proved'; grant: string }
  | { type: 'completed'; codes: string[] }
  | { type: 'restart' };

export function recoveryReducer(state: RecoveryState, action: Action): RecoveryState {
  switch (action.type) {
    case 'method': return { ...initialRecoveryState, method: action.method };
    case 'start': return { ...state, pending: true, error: null };
    case 'failed': return { ...state, pending: false, error: action.error };
    // Always advance after begin: the server answers identically for unknown accounts.
    case 'begun': return { ...state, pending: false, step: 'prove', recoveryId: action.recoveryId, error: null };
    case 'proved': return { ...state, pending: false, step: 'reset', grant: action.grant, error: null };
    // The grant is single use, so drop it as soon as it has been spent.
    case 'completed': return { ...state, pending: false, step: 'codes', grant: null, recoveryId: null, codes: action.codes, error: null };
    case 'restart': return { ...initialRecoveryState, method: state.method };
  }
}

/** User-facing copy. Deliberately never distinguishes unknown accounts from wrong proofs. */
export function recoveryErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const parsed = ErrorEnvelopeSchema.safeParse(error.response?.data);
    if (parsed.success) {
      const { code, retry_after_seconds } = parsed.data.error;
      switch (code) {
        case 'rate_limited':
          return retry_after_seconds ? `Too many attempts. Try again in ${retry_after_seconds} seconds.` : 'Too many attempts. Try again later.';
        case 'validation_failed': return 'Check what you entered and try again.';
        case 'forbidden': return 'That code did not work or has expired. Check it and try again.';
        case 'unavailable': return 'Recovery is temporarily unavailable. Try again shortly.';
        case 'upgrade_required': return 'Update the app to continue.';
      }
    }
    if (!error.response) return 'Could not reach the server. Check your connection and try again.';
  }
  if (error instanceof Error && error.name === 'ZodError') return 'Check what you entered and try again.';
  return 'Something went wrong. Try again.';
}

export function useRecoveryFlow() {
  const [state, dispatch] = useReducer(recoveryReducer, initialRecoveryState);
  const busy = useRef(false);

  // One request at a time so a double tap cannot spend a code twice.
  const run = useCallback(async (work: () => Promise<Action>) => {
    if (busy.current) return;
    busy.current = true;
    dispatch({ type: 'start' });
    try { dispatch(await work()); }
    catch (error) { dispatch({ type: 'failed', error: recoveryErrorMessage(error) }); }
    finally { busy.current = false; }
  }, []);

  return {
    state,
    setMethod: (method: RecoveryMethod) => dispatch({ type: 'method', method }),
    restart: () => dispatch({ type: 'restart' }),
    begin: (identifier: string) => run(async () => ({ type: 'begun', recoveryId: await beginRecovery({ method: state.method, identifier }) })),
    prove: (code: string) => run(async () => {
      if (!state.recoveryId) throw new Error('missing recovery id');
      return { type: 'proved', grant: await proveRecovery({ recovery_id: state.recoveryId, code }) };
    }),
    complete: (newPassword: string) => run(async () => {
      if (!state.grant) throw new Error('missing grant');
      return { type: 'completed', codes: await completeRecovery({ recovery_grant: state.grant, new_password: newPassword }) };
    }),
  };
}
