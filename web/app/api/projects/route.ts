import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { apiUser, listProjects, newId, summarize, unauthorized, MAX_PROJECT_BYTES } from '@/lib/projects';

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return NextResponse.json({ projects: await listProjects(user.id) });
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || 'Untitled Project').slice(0, 120);
  const data = body.data ?? null;
  const json = JSON.stringify(data ?? {});
  if (json.length > MAX_PROJECT_BYTES) return NextResponse.json({ error: 'Project is too large' }, { status: 413 });
  const id = newId();
  const db = await getDb();
  await db
    .insertInto('project')
    .values({ id, user_id: user.id, name, data: data ? json : '', ...summarize(data) })
    .execute();
  return NextResponse.json({ id, name }, { status: 201 });
}
