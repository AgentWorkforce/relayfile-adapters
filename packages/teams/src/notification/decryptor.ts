import type { EncryptedContent } from '../types.js';

export async function decryptNotificationContent(
  encrypted: EncryptedContent,
  privateKeyPem: string,
): Promise<Record<string, unknown>> {
  const crypto = await import('node:crypto');

  const encryptedKey = Buffer.from(encrypted.dataKey, 'base64');
  const symmetricKey = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha1',
    },
    encryptedKey,
  );

  const encryptedPayload = Buffer.from(encrypted.data, 'base64');
  const expectedSignature = crypto.createHmac('sha256', symmetricKey).update(encryptedPayload).digest();
  const actualSignature = Buffer.from(encrypted.dataSignature, 'base64');

  if (
    actualSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error('Rich notification signature verification failed');
  }

  const iv = encryptedPayload.subarray(0, 16);
  const ciphertext = encryptedPayload.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', symmetricKey, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(plaintext.toString('utf-8')) as Record<string, unknown>;
}
