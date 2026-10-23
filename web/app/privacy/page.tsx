import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function Privacy() {
  const S = SITE;
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <div className="draft-banner">
          Draft for review: replace every [PLACEHOLDER], list your actual processors and regions, and have a qualified lawyer review this policy (for example for
          GDPR/UK GDPR and CCPA/CPRA) before launch.
        </div>
        <h1>Privacy Policy</h1>
        <p className="updated">Effective {S.legalUpdated}</p>

        <div className="toc">
          <b>The short version</b>
          <ol>
            <li>Your video, audio and images stay on your computer — we never receive them.</li>
            <li>We store your Google account basics (name, email, profile picture) and the project timelines you save.</li>
            <li>AI requests go from your computer straight to the AI provider you choose, under your account with them.</li>
            <li>The editor shows an ad from Google AdSense, which uses cookies — unless you removed ads by supporting us on Ko-fi.</li>
          </ol>
        </div>

        <h2>1. Who we are</h2>
        <p>
          {S.company} (“we”, “us”), {S.address}, is the controller of the personal data described here for {S.name} (the “Service”). Contact:{' '}
          <a href={`mailto:${S.privacyEmail}`}>{S.privacyEmail}</a>.
        </p>

        <h2>2. What we collect</h2>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Source</th>
              <th>Why</th>
              <th>Legal basis (EEA/UK)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Name, email address, profile picture, Google account ID</td>
              <td>Google, when you sign in</td>
              <td>Create and secure your account, sign you in</td>
              <td>Contract</td>
            </tr>
            <tr>
              <td>Session data: session token, IP address, browser user agent, timestamps</td>
              <td>Your browser</td>
              <td>Keep you signed in, protect against abuse</td>
              <td>Contract; legitimate interests (security)</td>
            </tr>
            <tr>
              <td>Project data you save: project names, timeline structure, clip timings, effects, titles and captions text, and the file names and folder paths of media on your computer</td>
              <td>You</td>
              <td>Save and reopen your projects</td>
              <td>Contract</td>
            </tr>
            <tr>
              <td>Ko-fi payments: transaction ID, payer email, amount, currency, payment type and date, and the code from your Ko-fi message (the rest of the message is not stored)</td>
              <td>Ko-fi, when you support us</td>
              <td>Turn off ads in the editor for your account</td>
              <td>Contract</td>
            </tr>
            <tr>
              <td>Advertising data: cookies and similar identifiers, IP address, device and browser information, and the ads shown and clicked</td>
              <td>Google AdSense, in the editor</td>
              <td>Show ads that fund the Service, measure them and prevent ad fraud</td>
              <td>Consent where required (EEA/UK/Switzerland); legitimate interests elsewhere [CONFIRM]</td>
            </tr>
            <tr>
              <td>Messages you send us</td>
              <td>You</td>
              <td>Support</td>
              <td>Legitimate interests</td>
            </tr>
          </tbody>
        </table>
        <p>
          <b>What we do not collect:</b> your media files (video, audio, images), exported videos, the contents of your conversations with AI agents, or your AI
          provider credentials. The helper keeps these on your computer and talks to AI providers directly.
        </p>

        <h2>3. AI providers</h2>
        <p>
          When you use an AI feature, the helper on your computer sends your prompt, a text description of your timeline (which can include media file names and
          paths, clip timings and any title or caption text) and, if you choose, frames from your edit or transcripts of your media, to the provider you selected —
          Anthropic (Claude), OpenAI (Codex) or Anysphere (Cursor) — using your own account with them. They process that data under their own terms and privacy
          policies, not ours.
        </p>

        <h2>4. Cookies and advertising</h2>
        <p>
          We use cookies that are strictly necessary to sign you in and keep your session secure. The editor also shows an ad from Google AdSense. Google and its
          partners use cookies to serve ads based on your visits to this and other websites, to limit how often you see an ad and to measure ads. Learn how Google
          uses this information at{' '}
          <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">
            policies.google.com/technologies/partner-sites
          </a>
          , and turn off personalised ads at{' '}
          <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">
            adssettings.google.com
          </a>
          . In the EEA, the UK and Switzerland we ask for your consent before personalised ads are shown. Ads appear only in the editor, never on your exported
          videos, and you can remove them for good by supporting IngrainedCut on Ko-fi (see your <Link href="/account#ad-free">account page</Link>). We do not use
          analytics cookies.
        </p>

        <h2>5. Who we share data with</h2>
        <p>We do not sell your personal information for money. We use service providers that process data on our behalf:</p>
        <ul>
          <li>Vercel Inc. — website hosting [REGION]</li>
          <li>[DATABASE PROVIDER, e.g. Neon] — database hosting [REGION]</li>
          <li>Google — sign-in</li>
          <li>Google — advertising in the editor (AdSense), which collects the advertising data above directly through its cookies</li>
          <li>Ko-fi Labs Limited — supporter payments (Ko-fi handles the payment; we receive the details listed above, never your card or PayPal details)</li>
        </ul>
        <p>We may also disclose data if required by law or to protect the rights, safety and security of users and the Service.</p>

        <h2>6. International transfers</h2>
        <p>
          Our providers may process data outside your country. Where required, transfers rely on appropriate safeguards such as the European Commission’s Standard
          Contractual Clauses. [CONFIRM WITH YOUR PROVIDERS.]
        </p>

        <h2>7. Retention</h2>
        <p>
          We keep your account and saved projects while your account is active. Deleted projects are removed from our database immediately [AND FROM BACKUPS WITHIN
          N DAYS]. Session records expire after 30 days. When you delete your account we delete your account data and projects [WITHIN N DAYS].
          Ko-fi payment records are kept as financial records for [N YEARS — CHECK YOUR TAX RULES]; deleting your account unlinks them from it.
        </p>

        <h2>8. Your rights</h2>
        <p>
          Depending on where you live, you may have the right to access, correct, delete or export your personal data, to object to or restrict certain processing,
          and to complain to your data protection authority. California residents have the right to know, delete and correct personal information, to
          non-discrimination, and to opt out of the “sharing” of personal information for cross-context behavioural advertising, which the AdSense cookies in the
          editor may count as; you can opt out at adssettings.google.com or by removing ads. [CONFIRM CCPA/CPRA WORDING AND ANY “DO NOT SELL OR SHARE” LINK WITH
          YOUR LAWYER.] To exercise your rights, email <a href={`mailto:${S.privacyEmail}`}>{S.privacyEmail}</a>.
          You can delete individual projects yourself on the <Link href="/projects">projects page</Link>, and your whole account (with every project) on
          the <Link href="/account">account page</Link>.
        </p>

        <h2>9. Security</h2>
        <p>
          We use encryption in transit (HTTPS), secure session cookies and access controls. The helper only accepts connections from this website and from your own
          computer. No system is perfectly secure; please keep your Google account protected.
        </p>

        <h2>10. Children</h2>
        <p>The Service is not directed to children under {S.minimumAge}, and we do not knowingly collect their personal data.</p>

        <h2>11. Changes</h2>
        <p>We will post updates here and, for material changes, notify you before they take effect.</p>

        <h2>12. Contact</h2>
        <p>
          {S.company}, {S.address} · <a href={`mailto:${S.privacyEmail}`}>{S.privacyEmail}</a>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
