import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function Terms() {
  const S = SITE;
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <h1>Terms of Service</h1>
        <p className="updated">Effective {S.legalUpdated}</p>

        <p>
          These Terms of Service (“Terms”) govern your use of {S.name}, including the website at {S.url}, the browser-based editor, the {S.name} helper software
          and related services (together, the “Service”), provided by {S.company} (“we”, “us”). By creating an account or using the Service you agree to these Terms
          and to our <Link href="/privacy">Privacy Policy</Link>. If you use the Service for an organization, you confirm you are authorized to accept these Terms
          for it.
        </p>

        <h2>1. Eligibility and accounts</h2>
        <p>
          You must be at least {S.minimumAge} years old (or the minimum age of digital consent in your country, if higher) to use the Service. You sign in with a
          Google account; you are responsible for activity under your account and for keeping your Google account secure. Tell us promptly at {S.contactEmail} if
          you believe your account has been compromised.
        </p>

        <h2>2. How the Service works</h2>
        <p>
          The editor runs in your web browser. The helper runs on your own computer and processes your media files locally; your media files are not uploaded to our
          servers. We store your account details and the project data you save (timeline structure, edits, titles and settings), as described in the Privacy Policy.
        </p>

        <h2>3. Your content</h2>
        <p>
          You keep all rights to the media you edit and the projects and exports you create (“Your Content”). You give us a limited licence to store and transmit
          the project data you save only as needed to provide the Service to you. You are responsible for having the rights to the media you use and for anything
          you create, publish or distribute with the Service.
        </p>

        <h2>4. AI features and third-party providers</h2>
        <p>
          AI features run through third-party agents — such as Claude (Anthropic), Codex (OpenAI) and Cursor (Anysphere) — using <b>your own</b> account,
          subscription or API key with that provider. When you use an AI feature, your prompts, the timeline description and any frames you choose to share are sent
          from your computer to that provider. Your use of those services is governed by their terms and policies, and any fees or usage limits are between you and
          them. We do not control, and are not responsible for, third-party services or their outputs.
        </p>
        <p>
          If you connect your own Claude Code, Codex or Cursor (“your own app”), the AI runs in that app on your own plan: its usage counts toward your
          subscription with that provider, and you are responsible for using it within that provider’s terms. {SITE.name} does not provide, resell or pay for
          that AI.
        </p>
        <p>
          AI output can be wrong or unexpected. Review edits before you rely on or publish them. Editing actions can be undone; actions outside the editor (for
          example, shell commands) ask for your permission unless you turn on “Bypass permissions”, which you do at your own risk.
        </p>

        <h2>5. Acceptable use</h2>
        <p>You agree not to use the Service to:</p>
        <ul>
          <li>create, edit or distribute content that is illegal, infringes others’ rights, or depicts child sexual abuse;</li>
          <li>create deceptive deepfakes or impersonate real people without their consent, or harass, threaten or defame anyone;</li>
          <li>break, probe or overload the Service, circumvent its security or access controls, or access other users’ data;</li>
          <li>use the Service in violation of applicable law or of the terms of the AI providers you connect.</li>
        </ul>

        <h2>6. Third-party software</h2>
        <p>
          The Service relies on third-party and open-source components (including FFmpeg, which you install separately, and the agents you choose). Those
          components are licensed under their own terms.
        </p>

        <h2>7. Availability, changes and fees</h2>
        <p>
          The Service is currently offered free of charge as early-access software and may change, be interrupted or be discontinued. If we introduce paid features,
          we will tell you in advance and you will not be charged without agreeing to the price.
        </p>
        <p>
          <b>Ads and the ad-free editor.</b> The free editor on the website shows ads, provided by Google AdSense. You can remove them by supporting {SITE.name} on
          Ko-fi with a total of at least US$2: ads are then turned off in the editor for the account we match the payment
          to (by the code on your account page in your Ko-fi message, or by your email address). Support is voluntary and is not a purchase of software, a licence
          or any other feature; the ad-free editor lasts for as long as we run the Service with ads. Payments are processed by Ko-fi under its own terms and, except
          where the law requires otherwise, are non-refundable. If a payment can’t be matched to your account, contact us at{' '}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>

        <h2>8. Termination</h2>
        <p>
          You may stop using the Service and delete your account at any time. We may suspend or terminate access if you breach these Terms or if required by law.
          On termination, we delete your saved project data as described in the Privacy Policy; files on your own computer are not affected.
        </p>

        <h2>9. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE”, WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. Keep your own backups of your media and projects.
        </p>

        <h2>10. Limitation of liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR LOSS OF DATA,
          CONTENT, PROFITS OR REVENUE, ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO THE GREATER OF THE AMOUNT YOU PAID US IN THE
          12 MONTHS BEFORE THE CLAIM OR US$50. Nothing in these Terms limits liability that cannot be limited by law, including your statutory rights as a consumer.
        </p>

        <h2>11. Indemnity</h2>
        <p>
          You agree to indemnify us against claims arising from Your Content or your breach of these Terms, to the extent permitted by law.
        </p>

        <h2>12. Governing law and disputes</h2>
        <p>
          These Terms are governed by the laws of {S.governingLaw}, without regard to conflict-of-law rules. Any dispute will be brought in the state or
          federal courts located in Arizona, and you and we agree to their jurisdiction. If you are a consumer, you may also benefit from mandatory protections of the country where you live.
        </p>

        <h2>13. Changes to these Terms</h2>
        <p>
          We may update these Terms. If a change is material we will notify you (for example by email or in the Service) before it takes effect. Continuing to use
          the Service after the effective date means you accept the updated Terms.
        </p>

        <h2>14. Contact</h2>
        <p>
          {S.company} · <a href={`mailto:${S.contactEmail}`}>{S.contactEmail}</a>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
