import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import licenses from '@/lib/licenses.json';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: 'Open-source licenses', description: `The open-source software ${SITE.name} is built with, and its licenses.` };

type Entry = { name: string; version: string; license: string; url: string; note?: string };
const GROUPS = licenses as Record<string, { title: string; items: Entry[] }>;

export default function LicensesPage() {
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <h1>Open-source licenses</h1>
        <p className="updated">Generated from the exact package versions in this release.</p>
        <p>
          {SITE.name} is built with the open-source software below. Each entry links to where its source code is published. The full license and notice
          texts are in <a href="/third-party-licenses.txt">third-party-licenses.txt</a>; the helper package carries the same list in{' '}
          <code className="inline">THIRD_PARTY_NOTICES.md</code>.
        </p>
        {Object.entries(GROUPS).map(([key, g]) => (
          <section key={key}>
            <h2>{g.title}</h2>
            <table>
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Version</th>
                  <th>License</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((it) => (
                  <tr key={it.name + it.version}>
                    <td>
                      <a href={it.url} rel="noopener noreferrer" target="_blank">
                        {it.name}
                      </a>
                      {it.note && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{it.note}</div>}
                    </td>
                    <td>{it.version}</td>
                    <td>{it.license}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <p>
          Questions about licensing: <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>. See also the <Link href="/terms">Terms of Service</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
