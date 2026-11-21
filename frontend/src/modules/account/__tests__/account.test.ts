import { AxiosError } from 'axios';
import { act, renderHook } from '@testing-library/react-native';
import client from '../../../core/api/client';
import * as api from '../api';
import { initialRecoveryState, recoveryErrorMessage, recoveryReducer, useRecoveryFlow } from '../recoveryFlow';

jest.mock('../../../core/api/client', () => ({ __esModule: true, default: { post: jest.fn() } }));

const post = client.post as jest.Mock;
const codes = Array.from({ length: 10 }, (_, i) => `ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ${String(i).padStart(2, '0')}`);
const goodPassword = 'correct horse battery staple';

function apiError(status: number, code: string, extra: object = {}) {
  const config = { headers: {} } as any;
  return new AxiosError(code, 'ERR_BAD_REQUEST', config, undefined,
    { status, statusText: '', headers: {}, config, data: { error: { code, message: 'x', ...extra } } });
}

beforeEach(() => post.mockReset());

describe('account api', () => {
  it('validates requests before sending anything', async () => {
    await expect(api.completeRecovery({ recovery_grant: 'g', new_password: 'short' })).rejects.toThrow();
    await expect(api.beginRecovery({ method: 'email', identifier: 'not-an-email' })).rejects.toThrow();
    await expect(api.verifyEmail('nope', '12345678')).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects malformed server responses', async () => {
    post.mockResolvedValueOnce({ data: { recovery_codes: codes.slice(0, 9) } });
    await expect(api.completeRecovery({ recovery_grant: 'g', new_password: goodPassword })).rejects.toThrow();
    post.mockResolvedValueOnce({ data: { recovery_grant: 'g', extra: true } });
    await expect(api.proveRecovery({ recovery_id: 'x'.repeat(20), code: 'ABCD-EFGH' })).rejects.toThrow();
  });

  it('sends operation ids on account mutations but not on credential-issuing recovery calls', async () => {
    post.mockResolvedValue({ data: {} });
    await api.changePassword('grant', goodPassword);
    expect(post.mock.calls[0][2].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);

    post.mockReset();
    post.mockResolvedValueOnce({ data: { recovery_id: 'x'.repeat(20) } });
    await api.beginRecovery({ method: 'saved_code', identifier: 'alice' });
    expect(post.mock.calls[0][2]).toEqual({ public: true });
  });

  it('uses unique operation ids per call', async () => {
    post.mockResolvedValue({ data: {} });
    await api.acknowledgeRecoveryCodes('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA');
    await api.acknowledgeRecoveryCodes('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA');
    const ids = post.mock.calls.map((c) => c[2].headers['Idempotency-Key']);
    expect(new Set(ids).size).toBe(2);
  });

  it('keeps the grant bound to a named operation', async () => {
    post.mockResolvedValueOnce({ data: { fresh_auth_grant: 'g', expires_in_seconds: 300 } });
    await expect(api.requestFreshAuth('pw', 'password_change')).resolves.toBe('g');
    expect(post.mock.calls[0][1]).toEqual({ password: 'pw', operation: 'password_change' });
    await expect(api.requestFreshAuth('pw', 'launch' as any)).rejects.toThrow();
  });
});

describe('recovery reducer', () => {
  it('advances after begin regardless of whether the account exists', () => {
    const s = recoveryReducer(initialRecoveryState, { type: 'begun', recoveryId: 'opaque' });
    expect(s.step).toBe('prove');
  });

  it('drops the spent grant and recovery id once codes are issued', () => {
    let s = recoveryReducer(initialRecoveryState, { type: 'begun', recoveryId: 'opaque' });
    s = recoveryReducer(s, { type: 'proved', grant: 'grant' });
    expect(s.grant).toBe('grant');
    s = recoveryReducer(s, { type: 'completed', codes });
    expect(s).toMatchObject({ step: 'codes', grant: null, recoveryId: null });
    expect(s.codes).toHaveLength(10);
  });

  it('keeps the step on failure and clears secrets on restart', () => {
    let s = recoveryReducer(initialRecoveryState, { type: 'begun', recoveryId: 'opaque' });
    s = recoveryReducer(s, { type: 'failed', error: 'nope' });
    expect(s).toMatchObject({ step: 'prove', error: 'nope', pending: false });
    s = recoveryReducer(s, { type: 'restart' });
    expect(s).toEqual(initialRecoveryState);
  });

  it('switching method resets progress', () => {
    const s = recoveryReducer({ ...initialRecoveryState, step: 'prove', recoveryId: 'x' }, { type: 'method', method: 'email' });
    expect(s).toMatchObject({ step: 'identify', method: 'email', recoveryId: null });
  });
});

describe('recoveryErrorMessage', () => {
  it('never distinguishes unknown accounts from wrong proofs', () => {
    expect(recoveryErrorMessage(apiError(403, 'forbidden'))).toMatch(/did not work or has expired/);
    expect(recoveryErrorMessage(apiError(403, 'forbidden'))).not.toMatch(/account|user|exist/i);
  });
  it('shows retry-after, offline and fallback copy', () => {
    expect(recoveryErrorMessage(apiError(429, 'rate_limited', { retry_after_seconds: 30 }))).toMatch(/30 seconds/);
    expect(recoveryErrorMessage(new AxiosError('offline', 'ERR_NETWORK'))).toMatch(/Could not reach the server/);
    expect(recoveryErrorMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});

describe('useRecoveryFlow', () => {
  it('runs the saved-code journey end to end', async () => {
    post
      .mockResolvedValueOnce({ data: { recovery_id: 'x'.repeat(20) } })
      .mockResolvedValueOnce({ data: { recovery_grant: 'grant-1' } })
      .mockResolvedValueOnce({ data: { recovery_codes: codes } });
    const { result } = renderHook(() => useRecoveryFlow());
    await act(async () => { await result.current.begin('alice'); });
    expect(result.current.state.step).toBe('prove');
    await act(async () => { await result.current.prove('ABCD-EFGH-IJKL'); });
    expect(result.current.state.step).toBe('reset');
    await act(async () => { await result.current.complete(goodPassword); });
    expect(result.current.state.step).toBe('codes');
    expect(post.mock.calls[1][1]).toEqual({ recovery_id: 'x'.repeat(20), code: 'ABCD-EFGH-IJKL' });
    expect(post.mock.calls[2][1]).toEqual({ recovery_grant: 'grant-1', new_password: goodPassword });
  });

  it('stays on the proof step after a wrong code so the user can retry', async () => {
    post
      .mockResolvedValueOnce({ data: { recovery_id: 'x'.repeat(20) } })
      .mockRejectedValueOnce(apiError(403, 'forbidden'));
    const { result } = renderHook(() => useRecoveryFlow());
    await act(async () => { await result.current.begin('alice'); });
    await act(async () => { await result.current.prove('WRONG-CODE-1'); });
    expect(result.current.state.step).toBe('prove');
    expect(result.current.state.error).toMatch(/did not work/);
  });

  it('ignores a second submit while one is in flight', async () => {
    let release!: (v: unknown) => void;
    post.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useRecoveryFlow());
    await act(async () => {
      const first = result.current.begin('alice');
      void result.current.begin('alice');
      release({ data: { recovery_id: 'x'.repeat(20) } });
      await first;
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
