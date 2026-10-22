import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteChrome';
import { requireUser } from '@/lib/session';
import { listProjects } from '@/lib/projects';
import { ProjectsClient } from './ProjectsClient';

export const metadata: Metadata = { title: 'Your projects', robots: { index: false } };

export default async function ProjectsPage() {
  const user = await requireUser('/projects');
  const rows = await listProjects(user.id);
  const projects = rows.map((r) => ({
    id: r.id,
    name: r.name,
    duration: Number(r.duration) || 0,
    clips: Number(r.clip_count) || 0,
    updated: new Date(r.updated_at).toISOString(),
  }));
  return (
    <>
      <SiteHeader />
      <main className="container">
        <ProjectsClient initial={projects} firstName={(user.name || '').split(' ')[0]} />
      </main>
    </>
  );
}
