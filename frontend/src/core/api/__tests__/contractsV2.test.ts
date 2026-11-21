import * as fs from 'fs';
import * as path from 'path';
import { CONTRACTS_V2, ErrorEnvelopeSchema } from '../contractsV2';

// Shared with the Go contract tests; see backend/testdata/contracts/v2.
const root = path.resolve(__dirname, '../../../../../backend/testdata/contracts/v2');
const list = (kind: string) => fs.readdirSync(path.join(root, kind)).filter((f) => f.endsWith('.json'));
const read = (kind: string, file: string) => fs.readFileSync(path.join(root, kind, file), 'utf8');

describe('v2 contract fixtures', () => {
  it.each(list('valid'))('accepts valid fixture %s', (file) => {
    const name = file.split('.')[0] as keyof typeof CONTRACTS_V2;
    const schema = CONTRACTS_V2[name];
    expect(schema).toBeDefined();
    expect(schema.safeParse(JSON.parse(read('valid', file))).success).toBe(true);
  });

  // The server screens common passwords; that rule needs a blocklist the client
  // intentionally does not duplicate, so only that fixture is excluded here.
  const serverOnly = new Set(['RecoveryCompleteRequest.common_password.json']);

  it.each(list('invalid').filter((f) => !serverOnly.has(f)))('rejects invalid fixture %s', (file) => {
    const name = file.split('.')[0] as keyof typeof CONTRACTS_V2;
    const schema = CONTRACTS_V2[name];
    expect(schema).toBeDefined();
    let parsed: unknown;
    try { parsed = JSON.parse(read('invalid', file)); } catch { return; } // trailing data is not valid JSON at all
    expect(schema.safeParse(parsed).success).toBe(false);
  });

  it('covers every contract type with at least one valid fixture', () => {
    const covered = new Set(list('valid').map((f) => f.split('.')[0]));
    for (const name of Object.keys(CONTRACTS_V2)) expect(covered.has(name)).toBe(true);
  });
});

describe('error envelope', () => {
  it('accepts known codes and rejects unknown ones or extra fields', () => {
    expect(ErrorEnvelopeSchema.safeParse({ error: { code: 'rate_limited', message: 'slow down', retry_after_seconds: 30 } }).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse({ error: { code: 'made_up', message: 'x' } }).success).toBe(false);
    expect(ErrorEnvelopeSchema.safeParse({ error: { code: 'forbidden', message: 'x', extra: 1 } }).success).toBe(false);
  });
});
