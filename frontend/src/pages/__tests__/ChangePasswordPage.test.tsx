import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ChangePasswordPage } from '../ChangePasswordPage';
import { changeAccountPassword } from '../../modules/account/passwordChange';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../modules/account/passwordChange', () => ({ changeAccountPassword: jest.fn() }));

it('requires matching new passwords before submitting', async () => {
  const screen = render(<ChangePasswordPage navigation={{ goBack: jest.fn() }} />);
  fireEvent.changeText(screen.getByPlaceholderText('Current password'), 'old password');
  fireEvent.changeText(screen.getByPlaceholderText('New password'), 'a better password phrase');
  fireEvent.changeText(screen.getByPlaceholderText('Confirm new password'), 'a different password');
  fireEvent.press(screen.getByText('Change password'));
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(changeAccountPassword).not.toHaveBeenCalled();
});

it('submits the current and matching new password once', async () => {
  (changeAccountPassword as jest.Mock).mockResolvedValue(undefined);
  const screen = render(<ChangePasswordPage navigation={{ goBack: jest.fn() }} />);
  fireEvent.changeText(screen.getByPlaceholderText('Current password'), 'old password');
  fireEvent.changeText(screen.getByPlaceholderText('New password'), 'a better password phrase');
  fireEvent.changeText(screen.getByPlaceholderText('Confirm new password'), 'a better password phrase');
  fireEvent.press(screen.getByText('Change password'));
  await waitFor(() => expect(changeAccountPassword).toHaveBeenCalledWith('old password', 'a better password phrase'));
});
