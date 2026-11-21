import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RegisterPage } from '../RegisterPage';
import { useRegister } from '../../modules/auth/hooks';
import { AppError } from '../../core/api/appErrors';
import { CredentialStorageError } from '../../core/storage/secure';
import { AxiosError } from 'axios';

jest.mock('../../modules/auth/hooks', () => ({ useRegister: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/GridBackground', () => ({ GridBackground: ({ children }: any) => children }));

it('shows registration failure and makes the prefilled username editable', () => {
  const mutate = jest.fn((_args, options) => options.onError(new AppError('Username already exists.', 'validation', 'CONFLICT')));
  (useRegister as jest.Mock).mockReturnValue({ mutate, isPending: false });
  const screen = render(<RegisterPage navigation={{ navigate: jest.fn() }} route={{ params: { username: 'alice' } }} />);
  fireEvent.changeText(screen.getByPlaceholderText('Password (min 15 chars)'), 'a longer password');
  fireEvent.press(screen.getByText('Create Account'));
  expect(screen.getByText('Username already exists.')).toBeTruthy();
  expect(screen.getByPlaceholderText('Username (min 3 chars)')).toBeTruthy();
});

it('explains that an account may exist when saving its session fails', () => {
  const mutate = jest.fn((_args, options) => options.onError(new CredentialStorageError('unavailable')));
  (useRegister as jest.Mock).mockReturnValue({ mutate, isPending: false });
  const screen = render(<RegisterPage navigation={{ navigate: jest.fn() }} route={{ params: { username: 'alice' } }} />);
  fireEvent.changeText(screen.getByPlaceholderText('Password (min 15 chars)'), 'a longer password');
  fireEvent.press(screen.getByText('Create Account'));
  expect(screen.getByText(/account may have been created/)).toBeTruthy();
  expect(screen.getByText(/try signing in/)).toBeTruthy();
});

it('explains that registration may have completed when the response is lost', () => {
  const mutate = jest.fn((_args, options) => options.onError(new AxiosError('offline', 'ERR_NETWORK')));
  (useRegister as jest.Mock).mockReturnValue({ mutate, isPending: false });
  const screen = render(<RegisterPage navigation={{ navigate: jest.fn() }} route={{ params: { username: 'alice' } }} />);
  fireEvent.changeText(screen.getByPlaceholderText('Password (min 15 chars)'), 'a longer password');
  fireEvent.press(screen.getByText('Create Account'));
  expect(screen.getByText(/Registration could not be confirmed/)).toBeTruthy();
  expect(screen.getByText(/try signing in before registering again/)).toBeTruthy();
});
