import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LoginPage } from '../LoginPage';
import { useCheckUsername, useLogin } from '../../modules/auth/hooks';
import { ERROR_COPY, AppError } from '../../core/api/appErrors';

// Mock the hooks
jest.mock('../../modules/auth/hooks');

// Mock Ionicons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

// Mock GridBackground
jest.mock('../../components/GridBackground', () => ({
  GridBackground: ({ children }: any) => children,
}));

describe('LoginPage Component', () => {
  let mockNavigation: any;
  let mockCheckMutate: jest.Mock;
  let mockLoginMutate: jest.Mock;
  let mockCheckReset: jest.Mock;
  let mockLoginReset: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockNavigation = {
      navigate: jest.fn(),
    };

    mockCheckMutate = jest.fn();
    mockLoginMutate = jest.fn();
    mockCheckReset = jest.fn();
    mockLoginReset = jest.fn();

    (useCheckUsername as jest.Mock).mockReturnValue({
      mutate: mockCheckMutate,
      isPending: false,
      isError: false,
      error: null,
      reset: mockCheckReset,
    });

    (useLogin as jest.Mock).mockReturnValue({
      mutate: mockLoginMutate,
      isPending: false,
      isError: false,
      error: null,
      reset: mockLoginReset,
    });
  });

  it('should render the Username step initially', () => {
    const { getByPlaceholderText, getByText, queryByPlaceholderText } = render(
      <LoginPage navigation={mockNavigation} />
    );

    // Should find the username input
    expect(getByPlaceholderText('Username or Email')).toBeTruthy();
    expect(getByText('Continue')).toBeTruthy();
    expect(getByText('Create an account')).toBeTruthy();

    // Password fields should NOT be shown
    expect(queryByPlaceholderText('Password')).toBeNull();
  });

  it('should not allow continuing with an empty username', () => {
    const { getByText } = render(<LoginPage navigation={mockNavigation} />);
    const continueButton = getByText('Continue');

    fireEvent.press(continueButton);

    // mutate should not have been called because username is empty
    expect(mockCheckMutate).not.toHaveBeenCalled();
  });

  it('should transition to password step when username exists', async () => {
    // Set up mock implementation for successful username check where user exists
    mockCheckMutate.mockImplementation((username, { onSuccess }) => {
      onSuccess({ exists: true });
    });

    const { getByPlaceholderText, getByText, queryByPlaceholderText } = render(
      <LoginPage navigation={mockNavigation} />
    );

    const usernameInput = getByPlaceholderText('Username or Email');
    const continueButton = getByText('Continue');

    // Type a username
    fireEvent.changeText(usernameInput, 'alice');
    fireEvent.press(continueButton);

    expect(mockCheckMutate).toHaveBeenCalledWith('alice', expect.any(Object));

    // Wait for step transition to update React state
    await waitFor(() => {
      expect(getByPlaceholderText('Password')).toBeTruthy();
    });

    expect(getByText('alice')).toBeTruthy();
    expect(getByText('Not you?')).toBeTruthy();
    expect(getByText('Sign In')).toBeTruthy();

    // Username input should now be gone from view
    expect(queryByPlaceholderText('Username or Email')).toBeNull();
  });

  it('should navigate to Register screen when username does not exist', () => {
    mockCheckMutate.mockImplementation((username, { onSuccess }) => {
      onSuccess({ exists: false });
    });

    const { getByPlaceholderText, getByText } = render(
      <LoginPage navigation={mockNavigation} />
    );

    const usernameInput = getByPlaceholderText('Username or Email');
    const continueButton = getByText('Continue');

    fireEvent.changeText(usernameInput, 'newuser');
    fireEvent.press(continueButton);

    expect(mockCheckMutate).toHaveBeenCalledWith('newuser', expect.any(Object));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Register', { username: 'newuser' });
  });

  it('should display normalized error message when username check fails', () => {
    const networkError = new AppError(ERROR_COPY.NETWORK_OFFLINE, 'network', 'OFFLINE');
    (useCheckUsername as jest.Mock).mockReturnValue({
      mutate: mockCheckMutate,
      isPending: false,
      isError: true,
      error: networkError,
      reset: mockCheckReset,
    });

    mockCheckMutate.mockImplementation((username, { onError }) => {
      onError(networkError);
    });

    const { getByPlaceholderText, getByText } = render(
      <LoginPage navigation={mockNavigation} />
    );

    const usernameInput = getByPlaceholderText('Username or Email');
    const continueButton = getByText('Continue');

    fireEvent.changeText(usernameInput, 'alice');
    fireEvent.press(continueButton);

    // Verify error copy is presented to user
    expect(getByText(ERROR_COPY.NETWORK_OFFLINE)).toBeTruthy();
  });

  it('should trigger login request and handle success on the password step', async () => {
    // 1. Move to password step
    mockCheckMutate.mockImplementation((username, { onSuccess }) => {
      onSuccess({ exists: true });
    });

    const { getByPlaceholderText, getByText } = render(
      <LoginPage navigation={mockNavigation} />
    );

    const usernameInput = getByPlaceholderText('Username or Email');
    fireEvent.changeText(usernameInput, 'alice');
    fireEvent.press(getByText('Continue'));

    // Wait for step transition
    let passwordInput: any;
    await waitFor(() => {
      passwordInput = getByPlaceholderText('Password');
    });

    // 2. Perform login request
    mockLoginMutate.mockImplementation(({ username, password }, options) => {
      if (options && typeof options.onSuccess === 'function') {
        options.onSuccess({ id: '1', username: 'alice' });
      }
    });

    const signInButton = getByText('Sign In');
    fireEvent.changeText(passwordInput, 'secret123');
    fireEvent.press(signInButton);

    expect(mockLoginMutate).toHaveBeenCalledWith(
      { username: 'alice', password: 'secret123' },
      expect.any(Object)
    );
  });

  it('should display error when sign in fails', async () => {
    // 1. Move to password step
    mockCheckMutate.mockImplementation((username, { onSuccess }) => {
      onSuccess({ exists: true });
    });

    const loginError = new AppError('Wrong password.', 'auth', 'UNAUTHORIZED');
    (useLogin as jest.Mock).mockReturnValue({
      mutate: mockLoginMutate,
      isPending: false,
      isError: true,
      error: loginError,
      reset: mockLoginReset,
    });

    const { getByPlaceholderText, getByText } = render(
      <LoginPage navigation={mockNavigation} />
    );

    const usernameInput = getByPlaceholderText('Username or Email');
    fireEvent.changeText(usernameInput, 'alice');
    fireEvent.press(getByText('Continue'));

    let passwordInput: any;
    await waitFor(() => {
      passwordInput = getByPlaceholderText('Password');
    });

    mockLoginMutate.mockImplementation(({ username, password }, { onError }) => {
      onError(loginError);
    });

    const signInButton = getByText('Sign In');
    fireEvent.changeText(passwordInput, 'wrongpassword');
    fireEvent.press(signInButton);

    expect(getByText('Wrong password.')).toBeTruthy();
  });

  it('should navigate back to username step and reset state on "Not you?" press', async () => {
    mockCheckMutate.mockImplementation((username, { onSuccess }) => {
      onSuccess({ exists: true });
    });

    const { getByPlaceholderText, getByText, queryByPlaceholderText } = render(
      <LoginPage navigation={mockNavigation} />
    );

    const usernameInput = getByPlaceholderText('Username or Email');
    fireEvent.changeText(usernameInput, 'alice');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(getByPlaceholderText('Password')).toBeTruthy();
    });

    // Press "Not you?"
    const notYouButton = getByText('Not you?');
    fireEvent.press(notYouButton);

    // React state should reset step to 'username' and clear fields
    await waitFor(() => {
      expect(getByPlaceholderText('Username or Email')).toBeTruthy();
    });

    expect(queryByPlaceholderText('Password')).toBeNull();
    expect(mockCheckReset).toHaveBeenCalled();
    expect(mockLoginReset).toHaveBeenCalled();
  });
});
