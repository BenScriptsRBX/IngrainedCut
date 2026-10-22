import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from './auth';

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Server components: the signed-in user, or a redirect to /login (coming back to `next` afterwards). */
export async function requireUser(next: string) {
  const s = await getSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  return s.user;
}
