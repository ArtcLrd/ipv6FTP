import VoiceEngine from '../../../modules/voice-engine';
import { API_BASE_URL } from '../../config/env';
import client from '../../core/api/client';
import {
  EnrollChallengeRequestSchema,
  EnrollChallengeResponseSchema,
  EnrollFinishRequestSchema,
  EnrollFinishResponseSchema,
  RegisteredBeginRequestSchema,
  ServerKeyResponseSchema,
  SessionGrantSchema,
  SetupGrantResponseSchema,
  SetupResumeRequestSchema,
} from '../../core/api/contractsV2';
import { assertIdentityGeneration, currentIdentityGeneration } from './generation';
import { readRetainedProfile, writeRetainedProfile } from '../../core/storage/secure';

/** Returns the authenticated grant to the session coordinator for durable storage. */
export async function enrollRegisteredDevice(
  mode: 'register' | 'resume',
  username: string,
  password: string,
  signal?: AbortSignal,
) {
  if (!API_BASE_URL.startsWith('https://')) throw new Error('Device enrollment requires HTTPS');
  const generation = currentIdentityGeneration();
  const config = { public: true, signal };
  const checkCurrent = () => {
    assertIdentityGeneration(generation);
    if (signal?.aborted) throw new Error('Device enrollment cancelled');
  };
  checkCurrent();
  const retained = await readRetainedProfile();
  checkCurrent();
  if (mode === 'register' && retained) throw new Error('Remove the current profile from this device before registering another account.');
  const body = mode === 'register'
    ? RegisteredBeginRequestSchema.parse({ username, password, schema_version: 2 })
    : SetupResumeRequestSchema.parse({ username, password });
  const path = mode === 'register' ? '/api/v2/auth/registered/begin' : '/api/v2/auth/setup/resume';
  const setup = SetupGrantResponseSchema.parse((await client.post(path, body, config)).data);
  checkCurrent();
  const fetchKey = async () => {
    const { data } = await client.get('/api/v2/auth/server-key', { ...config, params: { rotation: 1 } });
    checkCurrent();
    return ServerKeyResponseSchema.parse(data);
  };
  const fetchChallenge = async () => {
    const { data } = await client.post('/api/v2/auth/enroll/challenge',
      EnrollChallengeRequestSchema.parse({ setup_grant: setup.setup_grant, rotation_supported: true }), config);
    checkCurrent();
    return EnrollChallengeResponseSchema.parse(data);
  };
  let key = await fetchKey();
  let challenge = await fetchChallenge();
  if (retained && challenge.principal_id !== retained.principalId) throw new Error('Remove the current profile from this device before signing in to another account.');
  if (challenge.server_key_id !== key.key_id) {
    key = await fetchKey();
    challenge = await fetchChallenge();
    if (retained && challenge.principal_id !== retained.principalId) throw new Error('Remove the current profile from this device before signing in to another account.');
  }
  if (challenge.server_key_id !== key.key_id) throw new Error('Enrollment server key changed');
  if (!retained) {
    await writeRetainedProfile({ principalId: challenge.principal_id, scope: `principal:${challenge.principal_id}`, username: username.trim().toLowerCase() });
    checkCurrent();
  }
  try {
    const handshake = await VoiceEngine.beginEnrollmentProof({
      challengeId: challenge.challenge_id,
      principalId: challenge.principal_id,
      nonce: challenge.nonce,
      serverKey: key.public_key,
      keyId: key.key_id,
      origin: new URL(API_BASE_URL).origin,
      rotation: key.rotation,
      ttlSeconds: challenge.expires_in_seconds,
      legacyScope: mode === 'resume' ? username.trim().toLowerCase() : undefined,
    });
    checkCurrent();
    const finish = EnrollFinishResponseSchema.parse((await client.post(
      '/api/v2/auth/enroll/finish',
      EnrollFinishRequestSchema.parse({ challenge_id: challenge.challenge_id, handshake }),
      config,
    )).data);
    checkCurrent();
    const grant = SessionGrantSchema.parse(JSON.parse(await VoiceEngine.finishEnrollmentProof(challenge.challenge_id, finish.handshake)));
    checkCurrent();
    if (grant.principal_id !== challenge.principal_id) throw new Error('Enrollment account changed');
    return grant;
  } finally {
    await VoiceEngine.cancelEnrollmentProof(challenge.challenge_id).catch(() => undefined);
  }
}
