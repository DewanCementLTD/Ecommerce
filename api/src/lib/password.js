import { randomBytes } from 'node:crypto';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateTempPassword(length = 16) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CHARS[bytes[i] % CHARS.length];
  return out;
}
