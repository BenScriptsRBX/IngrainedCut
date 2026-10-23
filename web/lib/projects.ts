import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from './auth';
import { getDb } from './db';
import { helperTokenUser } from './helperLink';

/** Max stored timeline size per project (media is never uploaded — this is JSON only). */
export const MAX_PROJECT_BYTES = 8 * 1024 * 1024;

/** The signed-in user: from the session cookie, or from a helper's token (editor opened through the helper). */
export async function apiUser() {
  const h = await headers();
  const bearer = h.get('authorization')?.match(/^Bearer (icut_[\w-]+)$/)?.[1];
  if (bearer) return helperTokenUser(bearer);
  const s = await auth.api.getSession({ headers: h });
  return s?.user ?? null;
}

export const unauthorized = () => NextResponse.json({ error: 'Sign in required' }, { status: 401 });
export const notFound = () => NextResponse.json({ error: 'Project not found' }, { status: 404 });

export function newId() {
  return 'p_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

/** Pull display metadata out of a project JSON (duration, clip count, name). */
export function summarize(data: any) {
  const clips: any[] = Array.isArray(data?.clips) ? data.clips : [];
  const duration = clips.reduce((m, c) => Math.max(m, (Number(c.start) || 0) + (Number(c.duration) || 0)), 0);
  return { duration, clip_count: clips.length };
}

export async function listProjects(userId: string) {
  const db = await getDb();
  return db
    .selectFrom('project')
    .select(['id', 'name', 'duration', 'clip_count', 'created_at', 'updated_at'])
    .where('user_id', '=', userId)
    .orderBy('updated_at', 'desc')
    .execute();
}
