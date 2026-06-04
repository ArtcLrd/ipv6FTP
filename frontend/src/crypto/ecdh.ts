import * as nacl from 'tweetnacl';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';

const PRIVATE_KEY_STORAGE_KEY = 'ipv6ftp_private_key';

export async function getOrCreateKeyPair() {
  let privateKeyStr = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
  
  let keyPair: nacl.BoxKeyPair;
  
  if (privateKeyStr) {
    const privateKey = new Uint8Array(Buffer.from(privateKeyStr, 'hex'));
    keyPair = nacl.box.keyPair.fromSecretKey(privateKey);
  } else {
    keyPair = nacl.box.keyPair();
    await SecureStore.setItemAsync(
      PRIVATE_KEY_STORAGE_KEY, 
      Buffer.from(keyPair.secretKey).toString('hex')
    );
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
