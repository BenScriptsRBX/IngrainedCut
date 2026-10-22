import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';
import { apiUser, notFound, summarize, unauthorized, MAX_PROJECT_BYTES } from '@/lib/projects';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const db = await getDb();
  const row = await db.selectFrom('project').selectAll().where('id', '=', id).where('user_id', '=', user.id).executeTakeFirst();
  if (!row) return notFound();
  return NextResponse.json({ id: row.id, name: row.name, data: row.data ? JSON.parse(row.data) : null, updated_at: row.updated_at });
}

export async function PUT(req: Request, { params }: Ctx) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const raw = await req.text();
  if (raw.length > MAX_PROJECT_BYTES) return NextResponse.json({ error: 'Project is too large' }, { status: 413 });
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const patch: Record<string, unknown> = { updated_at: sql`CURRENT_TIMESTAMP` };
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
  if (body.data !== undefined) Object.assign(patch, { data: JSON.stringify(body.data), ...summarize(body.data) });
  const db = await getDb();
  const r = await db.updateTable('project').set(patch as any).where('id', '=', id).where('user_id', '=', user.id).executeTakeFirst();
  if (!Number(r.numUpdatedRows)) return notFound();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const db = await getDb();
  const r = await db.deleteFrom('project').where('id', '=', id).where('user_id', '=', user.id).executeTakeFirst();
  if (!Number(r.numDeletedRows)) return notFound();
  return NextResponse.json({ ok: true });
}
