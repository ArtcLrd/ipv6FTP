import axios, { AxiosError } from 'axios';
import { changeAccountPassword } from '../passwordChange';
import { requestFreshAuth } from '../api';
import { beginPasswordChange, finishPasswordChange, rejectPasswordChange } from '../../auth/api';
import { currentIdentityGeneration } from '../../auth/generation';

jest.mock('../../../config/env', () => ({ API_BASE_URL: 'https://example.test' }));
jest.mock('../api', () => ({ requestFreshAuth: jest.fn() }));
jest.mock('../../auth/api', () => ({ beginPasswordChange: jest.fn(), finishPasswordChange: jest.fn(), rejectPasswordChange: jest.fn() }));

const password = 'a better password phrase';
const begin = beginPasswordChange as jest.Mock;
const finish = finishPasswordChange as jest.Mock;
const reject = rejectPasswordChange as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (requestFreshAuth as jest.Mock).mockResolvedValue('grant');
  begin.mockResolvedValue({ generation: currentIdentityGeneration(), tokens: { accessToken: 'access', refreshToken: 'refresh' } });
  finish.mockResolvedValue(undefined);
  reject.mockResolvedValue(undefined);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it('changes the password only after fresh authentication and a durable uncertainty marker', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ status: 204 });
  await changeAccountPassword('old password', password);
  expect(requestFreshAuth).toHaveBeenCalledWith('old password', 'password_change');
  expect(begin.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
  expect(post).toHaveBeenCalledWith('https://example.test/api/v2/account/password',
    { fresh_auth_grant: 'grant', new_password: password }, expect.objectContaining({ headers: { Authorization: 'Bearer access' } }));
  expect(finish).toHaveBeenCalledWith(currentIdentityGeneration(), true);
});

it('restores the session when the backend definitively rejects the change', async () => {
  const response = { status: 400, statusText: '', headers: {}, config: {} as any,
    data: { error: { code: 'validation_failed', message: 'Password rejected' } } };
  jest.spyOn(axios, 'post').mockRejectedValue(new AxiosError('rejected', 'ERR_BAD_REQUEST', undefined, undefined, response));
  await expect(changeAccountPassword('old password', password)).rejects.toThrow('rejected');
  expect(reject).toHaveBeenCalledTimes(1);
  expect(finish).not.toHaveBeenCalled();
});

it('requires sign-in when the response is lost', async () => {
  jest.spyOn(axios, 'post').mockRejectedValue(new AxiosError('offline', 'ERR_NETWORK'));
  await changeAccountPassword('old password', password);
  expect(finish).toHaveBeenCalledWith(currentIdentityGeneration(), false);
  expect(reject).not.toHaveBeenCalled();
});

it('times out even if the transport ignores cancellation', async () => {
  jest.useFakeTimers();
  jest.spyOn(axios, 'post').mockImplementation(() => new Promise(() => undefined));
  const pending = changeAccountPassword('old password', password);
  await Promise.resolve();
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(10000);
  await pending;
  expect(finish).toHaveBeenCalledWith(currentIdentityGeneration(), false);
});

it('does not start a change when current-password verification fails', async () => {
  (requestFreshAuth as jest.Mock).mockRejectedValue(new Error('wrong password'));
  await expect(changeAccountPassword('wrong', password)).rejects.toThrow('wrong password');
  expect(begin).not.toHaveBeenCalled();
});

it('does not send the mutation when the local uncertainty marker fails', async () => {
  begin.mockRejectedValue(new Error('secure storage unavailable'));
  const post = jest.spyOn(axios, 'post');
  await expect(changeAccountPassword('old password', password)).rejects.toThrow('secure storage unavailable');
  expect(post).not.toHaveBeenCalled();
});
