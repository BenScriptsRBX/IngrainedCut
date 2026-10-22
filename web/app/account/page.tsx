import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader, SiteFooter } from '@/components/SiteChrome';
import { requireUser } from '@/lib/session';
import { listProjects } from '@/lib/projects';
import { DeleteAccount } from './DeleteAccount';

export const metadata: Metadata = { title: 'Account', robots: { index: false } };

export default async function AccountPage() {
  const user = await requireUser('/account');
  const projects = await listProjects(user.id);
  return (
    <>
      <SiteHeader />
      <main className="container prose">
        <h1>Account</h1>
        <table>
          <tbody>
            <tr>
              <td>Name</td>
              <td>{user.name}</td>
            </tr>
            <tr>
              <td>Email</td>
              <td>{user.email}</td>
            </tr>
            <tr>
              <td>Saved projects</td>
              <td>
                {projects.length} — <Link href="/projects">manage</Link>
              </td>
            </tr>
          </tbody>
        </table>
        <h2>Your data</h2>
        <p>
          We store your name, email, profile picture and your projects&apos; timelines. Your media files stay on your computer. See the{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
        <h2>Delete account</h2>
        <p>Deleting your account permanently removes your profile, sign-in records and every saved project from IngrainedCut. Media on your computer is not touched.</p>
        <DeleteAccount projects={projects.length} />
      </main>
      <SiteFooter />
    </>
  );
}
