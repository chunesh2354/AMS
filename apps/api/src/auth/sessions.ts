import { createHash, randomBytes } from 'node:crypto';

export { SESSION_COOKIE } from '../config/env';
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
