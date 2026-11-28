jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { hostUri: '192.0.2.1:8081' } } }));

import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('backend origin configuration', () => {
  const oldEnv = process.env.EXPO_PUBLIC_BACKEND_URL;
  const oldAlias = process.env.EXPO_PUBLIC_API_BASE_URL;
  const oldDev = (global as any).__DEV__;
  afterEach(() => {
    process.env.EXPO_PUBLIC_BACKEND_URL = oldEnv;
    process.env.EXPO_PUBLIC_API_BASE_URL = oldAlias;
    (global as any).__DEV__ = oldDev;
    jest.resetModules();
  });
  it('requires an explicit HTTPS origin in production', () => {
    (global as any).__DEV__ = false;
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    expect(() => require('./env')).toThrow('explicit HTTPS');
    process.env.EXPO_PUBLIC_BACKEND_URL = 'http://example.test';
    expect(() => require('./env')).toThrow('HTTPS');
  });
  it('derives secure websocket destination from the configured origin', () => {
    (global as any).__DEV__ = false;
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://example.test/';
    expect(require('./env').WS_URL).toBe('wss://example.test');
  });
  it('keeps service secrets out of the public frontend example', () => {
    const example = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
    const names = example.split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map((line) => line.split('=')[0]);
    expect(names.every((name) => name.startsWith('EXPO_PUBLIC_'))).toBe(true);
    expect(names.some((name) => /(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|API_KEY)/i.test(name))).toBe(false);
  });
});

