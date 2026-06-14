import * as nacl from 'tweetnacl';
import { Buffer } from 'buffer';

const PRIVATE_KEY_STORAGE_KEY = 'ipv6ftp_private_key';
let memoryPrivateKey: string | null = null;

function getSecureStore() {
  try {
    return require('expo-secure-store');
  } catch {
    return null;
  }
}

export async function getOrCreateKeyPair() {
  const SecureStore = getSecureStore();
  let privateKeyStr = SecureStore
    ? await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY)
    : memoryPrivateKey;
  
  let keyPair: nacl.BoxKeyPair;
  
  if (privateKeyStr) {
    const privateKey = new Uint8Array(Buffer.from(privateKeyStr, 'hex'));
    keyPair = nacl.box.keyPair.fromSecretKey(privateKey);
  } else {
    keyPair = nacl.box.keyPair();
    const encodedPrivateKey = Buffer.from(keyPair.secretKey).toString('hex');
    if (SecureStore) {
      await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, encodedPrivateKey);
    } else {
      memoryPrivateKey = encodedPrivateKey;
    }
  }
  
  return {
    publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
    secretKey: keyPair.secretKey,
  };
}

export function computeSharedSecret(mySecretKey: Uint8Array, theirPublicKeyHex: string) {
  const theirPublicKey = new Uint8Array(Buffer.from(theirPublicKeyHex, 'hex'));
  return nacl.scalarMult(mySecretKey, theirPublicKey);
}
