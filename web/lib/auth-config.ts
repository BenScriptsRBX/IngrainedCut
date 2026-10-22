// What sign-in can do on this server, without touching the database (safe to import anywhere).

/** Local testing only: a "Sign in as test user" button. Never active on Vercel production. */
export const DEV_LOGIN = process.env.ICUT_DEV_LOGIN === '1' && process.env.VERCEL_ENV !== 'production';

export const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** Accounts need the database; until DATABASE_URL is set the site runs as pages only. */
export const accountsReady = !!process.env.DATABASE_URL;
