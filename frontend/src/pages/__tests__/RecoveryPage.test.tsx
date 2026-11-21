import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { RecoveryPage } from '../RecoveryPage';
import * as api from '../../modules/account/api';

jest.mock('../../modules/account/api');
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/GridBackground', () => ({ GridBackground: ({ children }: any) => children }));
jest.mock('../../components/ScreenLayout', () => ({ ScreenLayout: ({ children }: any) => children }));

const mocked = api as jest.Mocked<typeof api>;
const codes = Array.from({ length: 10 }, (_, i) => `ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ${String(i).padStart(2, '0')}`);

beforeEach(() => jest.resetAllMocks());

it('walks identify, prove, reset and shows codes that must be acknowledged before leaving', async () => {
  mocked.beginRecovery.mockResolvedValue('x'.repeat(20));
  mocked.proveRecovery.mockResolvedValue('grant');
  mocked.completeRecovery.mockResolvedValue(codes);
  const reset = jest.fn();
  const screen = render(<RecoveryPage navigation={{ reset, goBack: jest.fn(), navigate: jest.fn() }} />);

  fireEvent.changeText(screen.getByPlaceholderText('Username'), 'alice');
  await act(async () => { fireEvent.press(screen.getByText('Continue')); });
  await waitFor(() => expect(screen.getByText('Enter a recovery code')).toBeTruthy());

  fireEvent.changeText(screen.getByPlaceholderText('Code'), 'ABCD-EFGH-IJKL');
  await act(async () => { fireEvent.press(screen.getByText('Verify')); });
  await waitFor(() => expect(screen.getByText('Choose a new password')).toBeTruthy());

  const pw = 'correct horse battery staple';
  fireEvent.changeText(screen.getByPlaceholderText('New password'), pw);
  fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), pw);
  await act(async () => { fireEvent.press(screen.getByText('Reset password')); });
  await waitFor(() => expect(screen.getByText('Save your recovery codes')).toBeTruthy());
  expect(mocked.completeRecovery).toHaveBeenCalledWith({ recovery_grant: 'grant', new_password: pw });
  expect(screen.getByText(codes[0])).toBeTruthy();

  // Leaving is blocked until the user acknowledges they saved the codes.
  fireEvent.press(screen.getByText('Go to sign in'));
  expect(reset).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('I have saved these recovery codes'));
  await act(async () => { fireEvent.press(screen.getByText('Go to sign in')); });
  expect(reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Login' }] });
});

it('shows a generic error and stays on the proof step after a rejected code', async () => {
  mocked.beginRecovery.mockResolvedValue('x'.repeat(20));
  mocked.proveRecovery.mockRejectedValue(new Error('rejected'));
  const screen = render(<RecoveryPage navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  fireEvent.changeText(screen.getByPlaceholderText('Username'), 'alice');
  await act(async () => { fireEvent.press(screen.getByText('Continue')); });
  await waitFor(() => screen.getByText('Enter a recovery code'));
  fireEvent.changeText(screen.getByPlaceholderText('Code'), 'WRONG-CODE-1');
  await act(async () => { fireEvent.press(screen.getByText('Verify')); });
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByText('Enter a recovery code')).toBeTruthy();
});

it('keeps Reset disabled for short or mismatched passwords', async () => {
  mocked.beginRecovery.mockResolvedValue('x'.repeat(20));
  mocked.proveRecovery.mockResolvedValue('grant');
  const screen = render(<RecoveryPage navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  fireEvent.changeText(screen.getByPlaceholderText('Username'), 'alice');
  await act(async () => { fireEvent.press(screen.getByText('Continue')); });
  await waitFor(() => screen.getByText('Enter a recovery code'));
  fireEvent.changeText(screen.getByPlaceholderText('Code'), 'ABCD-EFGH-IJKL');
  await act(async () => { fireEvent.press(screen.getByText('Verify')); });
  await waitFor(() => screen.getByText('Choose a new password'));
  fireEvent.changeText(screen.getByPlaceholderText('New password'), 'short');
  fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'short');
  fireEvent.press(screen.getByText('Reset password'));
  expect(mocked.completeRecovery).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByPlaceholderText('New password'), 'correct horse battery staple');
  fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'different horse battery stable');
  fireEvent.press(screen.getByText('Reset password'));
  expect(mocked.completeRecovery).not.toHaveBeenCalled();
});
