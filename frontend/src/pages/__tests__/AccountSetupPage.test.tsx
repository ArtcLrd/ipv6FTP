import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccountSetupPage } from '../AccountSetupPage';
import { acknowledgeRecoveryCodes, regenerateRecoveryCodes, requestFreshAuth } from '../../modules/account/api';
import { activateSetup } from '../../modules/auth/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../modules/account/api', () => ({
  acknowledgeRecoveryCodes: jest.fn(), regenerateRecoveryCodes: jest.fn(), requestFreshAuth: jest.fn(),
}));
jest.mock('../../modules/auth/api', () => ({ activateSetup: jest.fn(), logout: jest.fn() }));

it('requires the displayed codes to be confirmed before activation', async () => {
  const codes = Array.from({ length: 10 }, (_, i) => `recovery-code-${i}`);
  (requestFreshAuth as jest.Mock).mockResolvedValue('grant');
  (regenerateRecoveryCodes as jest.Mock).mockResolvedValue(codes);
  (acknowledgeRecoveryCodes as jest.Mock).mockResolvedValue(undefined);
  (activateSetup as jest.Mock).mockResolvedValue(undefined);
  const screen = render(<AccountSetupPage />);
  fireEvent.changeText(screen.getByPlaceholderText('Password'), 'correct password');
  fireEvent.press(screen.getByText('Generate recovery codes'));
  await screen.findByText(codes[0]);
  expect(activateSetup).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('I have saved these recovery codes'));
  fireEvent.press(screen.getByText('Finish setup'));
  await waitFor(() => expect(activateSetup).toHaveBeenCalledTimes(1));
  expect(acknowledgeRecoveryCodes).toHaveBeenCalledWith(codes[0]);
});

it('does not activate when acknowledgement fails', async () => {
  jest.clearAllMocks();
  const codes = Array.from({ length: 10 }, (_, i) => `recovery-code-${i}`);
  (requestFreshAuth as jest.Mock).mockResolvedValue('grant');
  (regenerateRecoveryCodes as jest.Mock).mockResolvedValue(codes);
  (acknowledgeRecoveryCodes as jest.Mock).mockRejectedValue(new Error('changed'));
  const screen = render(<AccountSetupPage />);
  fireEvent.changeText(screen.getByPlaceholderText('Password'), 'correct password');
  fireEvent.press(screen.getByText('Generate recovery codes'));
  await screen.findByText(codes[0]);
  fireEvent.press(screen.getByText('I have saved these recovery codes'));
  fireEvent.press(screen.getByText('Finish setup'));
  await screen.findByRole('alert');
  expect(activateSetup).not.toHaveBeenCalled();
});
