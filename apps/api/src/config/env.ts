/** Every environment setting the API reads, in one place. */
export const nodeEnv = () => process.env.NODE_ENV ?? 'development';
/** Read per call, so a test or script that sets NODE_ENV later still sees it. */
export const isProduction = () => process.env.NODE_ENV === 'production';
export const DATABASE_URL = process.env.DATABASE_URL;
export const PORT = Number(process.env.PORT ?? 3000);
/** Session cookie settings. `secure` is passed per app (buildApp opts.secureCookie). */
export const SESSION_COOKIE = 'ams_session';
export const SESSION_COOKIE_BASE = { path: '/', httpOnly: true, sameSite: 'lax' as const };
