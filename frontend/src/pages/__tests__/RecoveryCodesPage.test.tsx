import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RecoveryCodesPage } from '../RecoveryCodesPage';
import { acknowledgeRecoveryCodes, regenerateRecoveryCodes, requestFreshAuth } from '../../modules/account/api';
import { advanceIdentityGeneration } from '../../modules/auth/generation';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../modules/account/api', () => ({
  acknowledgeRecoveryCodes: jest.fn(), regenerateRecoveryCodes: jest.fn(), requestFreshAuth: jest.fn(),
}));

const codes = Array.from({ length: 10 }, (_, index) => `recovery-code-${index}`);

function navigation() {
  return { addListener: jest.fn((_name: string, _listener: (event: any) => void) => jest.fn()), goBack: jest.fn(), dispatch: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requestFreshAuth as jest.Mock).mockResolvedValue('grant');
  (regenerateRecoveryCodes as jest.Mock).mockResolvedValue(codes);
  (acknowledgeRecoveryCodes as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it('requires password and explicit confirmation before acknowledging the displayed set', async () => {
  const nav = navigation();
  const screen = render(<RecoveryCodesPage navigation={nav} />);
  fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password');
  fireEvent.press(screen.getByText('Generate new codes'));
  await screen.findByText(codes[0]);
  expect(requestFreshAuth).toHaveBeenCalledWith('password', 'recovery_codes');
  expect(regenerateRecoveryCodes).toHaveBeenCalledWith('grant');
  expect(acknowledgeRecoveryCodes).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('I have saved these recovery codes'));
  fireEvent.press(screen.getByText('Done'));
  await waitFor(() => expect(nav.goBack).toHaveBeenCalledTimes(1));
  expect(acknowledgeRecoveryCodes).toHaveBeenCalledWith(codes[0]);
}, 10000);

it('warns when the generated set response is lost', async () => {
  (regenerateRecoveryCodes as jest.Mock).mockRejectedValue(new Error('network'));
  const screen = render(<RecoveryCodesPage navigation={navigation()} />);
  fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password');
  fireEvent.press(screen.getByText('Generate new codes'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Your previous codes may no longer work/);
  expect(acknowledgeRecoveryCodes).not.toHaveBeenCalled();
});

it('warns before leaving an unconfirmed set and permits an identity change to proceed', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const nav = navigation();
  const screen = render(<RecoveryCodesPage navigation={nav} />);
  fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password');
  fireEvent.press(screen.getByText('Generate new codes'));
  await screen.findByText(codes[0]);
  const listener = nav.addListener.mock.calls[0][1] as (event: any) => void;
  const event = { preventDefault: jest.fn(), data: { action: {} } };
  listener(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledTimes(1);
  advanceIdentityGeneration();
  listener(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
});

it('does not show codes from an earlier identity', async () => {
  let resolve!: (value: string[]) => void;
  (regenerateRecoveryCodes as jest.Mock).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const screen = render(<RecoveryCodesPage navigation={navigation()} />);
  fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password');
  fireEvent.press(screen.getByText('Generate new codes'));
  await waitFor(() => expect(resolve).toBeDefined());
  advanceIdentityGeneration();
  resolve(codes);
  await waitFor(() => expect(screen.queryByText(codes[0])).toBeNull());
});
