import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { getDb } from './db';
import { SITE } from './site';

import { DEV_LOGIN, googleConfigured, accountsReady } from './auth-config';

export { DEV_LOGIN, googleConfigured };

// without a database (pages-only deploy) sign-in is switched off: no provider can create users
const db = accountsReady ? await getDb() : null;

export const auth = betterAuth({
  appName: SITE.name,
  baseURL: process.env.BETTER_AUTH_URL || SITE.url,
  secret: process.env.BETTER_AUTH_SECRET,
  database: db ? { db, type: 'postgres' } : undefined,
  socialProviders: googleConfigured && db
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, prompt: 'select_account' } }
    : {},
  emailAndPassword: { enabled: DEV_LOGIN && !!db },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  // Account page → "Delete account": needs a sign-in from the last day; projects go with it (on delete cascade)
  user: { deleteUser: { enabled: true } },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
