// End-to-End Encryption using native Web Crypto API (RSA-OAEP-2048)
// No external dependencies — runs in every modern browser

const ALGORITHM = { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

// ─── Key generation (once per user, stored in IndexedDB) ───
export async function generateKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    ALGORITHM,
    true,
    ['encrypt', 'decrypt']
  );
  return keyPair;
}

export async function exportPublicKey(publicKey) {
  const exported = await window.crypto.subtle.exportKey('spki', publicKey);
  return arrayBufferToBase64(exported);
}

export async function exportPrivateKey(privateKey) {
  const exported = await window.crypto.subtle.exportKey('pkcs8', privateKey);
  return arrayBufferToBase64(exported);
}

export async function importPublicKey(base64Key) {
  const binary = base64ToArrayBuffer(base64Key);
  return window.crypto.subtle.importKey(
    'spki', binary, ALGORITHM, true, ['encrypt']
  );
}

export async function importPrivateKey(base64Key) {
  const binary = base64ToArrayBuffer(base64Key);
  return window.crypto.subtle.importKey(
    'pkcs8', binary, ALGORITHM, true, ['decrypt']
  );
}

// ─── Encryption / Decryption ───
export async function encryptMessage(plaintext, recipientPublicKey) {
  const encoded = new TextEncoder().encode(plaintext);
  // RSA-OAEP has a max payload (~190 bytes for 2048-bit keys), so we chunk for longer messages
  if (encoded.length <= 190) {
    const encrypted = await window.crypto.subtle.encrypt(ALGORITHM, recipientPublicKey, encoded);
    return arrayBufferToBase64(encrypted);
  }
  // For longer messages: hybrid encryption (AES key wrapped by RSA)
  return hybridEncrypt(plaintext, recipientPublicKey);
}

export async function decryptMessage(encryptedBase64, privateKey, isHybrid = false) {
  if (isHybrid) return hybridDecrypt(encryptedBase64, privateKey);
  try {
    const encrypted = base64ToArrayBuffer(encryptedBase64);
    const decrypted = await window.crypto.subtle.decrypt(ALGORITHM, privateKey, encrypted);
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    return null; // Decryption failed (wrong key or corrupted)
  }
}

// ─── Hybrid encryption for messages > 190 bytes ───
async function hybridEncrypt(plaintext, recipientPublicKey) {
  // Generate ephemeral AES key
  const aesKey = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);

  // Export and encrypt the AES key with RSA
  const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
  const encryptedAesKey = await window.crypto.subtle.encrypt(ALGORITHM, recipientPublicKey, rawAesKey);

  return JSON.stringify({
    hybrid: true,
    key: arrayBufferToBase64(encryptedAesKey),
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(ciphertext),
  });
}

async function hybridDecrypt(payload, privateKey) {
  try {
    const { key, iv, data } = JSON.parse(payload);
    const rawAesKey = await window.crypto.subtle.decrypt(ALGORITHM, privateKey, base64ToArrayBuffer(key));
    const aesKey = await window.crypto.subtle.importKey('raw', rawAesKey, 'AES-GCM', false, ['decrypt']);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToArrayBuffer(iv) },
      aesKey,
      base64ToArrayBuffer(data)
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    return null;
  }
}

// ─── Helpers ───
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ─── IndexedDB storage for private key (never sent to server) ───
const DB_NAME = 'yo_e2ee';
const STORE_NAME = 'keys';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storePrivateKey(userId, privateKeyBase64) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(privateKeyBase64, `private_${userId}`);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getStoredPrivateKey(userId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(`private_${userId}`);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

// ─── High-level setup: ensures user has keys, returns usable CryptoKey objects ───
export async function ensureUserKeys(userId, supabase) {
  let privateKeyBase64 = await getStoredPrivateKey(userId);
  let publicKeyBase64;

  if (!privateKeyBase64) {
    // First time: generate new key pair
    const keyPair = await generateKeyPair();
    privateKeyBase64 = await exportPrivateKey(keyPair.privateKey);
    publicKeyBase64 = await exportPublicKey(keyPair.publicKey);

    await storePrivateKey(userId, privateKeyBase64);

    // Upload public key to Supabase (public keys are safe to share)
    await supabase.from('user_encryption_keys').upsert({
      user_id: userId,
      public_key: publicKeyBase64,
      key_algorithm: 'RSA-OAEP-2048',
    }, { onConflict: 'user_id' });
  } else {
    // Fetch existing public key from server for consistency check
    const { data } = await supabase.from('user_encryption_keys').select('public_key').eq('user_id', userId).single();
    publicKeyBase64 = data?.public_key;
  }

  const privateKey = await importPrivateKey(privateKeyBase64);
  return { privateKey, publicKeyBase64 };
}

export async function getRecipientPublicKey(recipientId, supabase) {
  const { data } = await supabase.from('user_encryption_keys').select('public_key').eq('user_id', recipientId).single();
  if (!data?.public_key) return null;
  return importPublicKey(data.public_key);
}
