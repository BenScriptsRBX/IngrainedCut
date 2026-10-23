// Public-facing details used across the site and the legal pages.
// Fill in every [PLACEHOLDER] before launch, and have the legal pages reviewed by a lawyer.
export const SITE = {
  name: 'IngrainedCut',
  tagline: 'The video editor you can talk to.',
  description:
    'IngrainedCut is a professional, timeline-based video editor with Claude, Codex and Cursor built in. Describe the edit — your AI makes it on the timeline while you watch.',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  company: '[COMPANY OR OWNER LEGAL NAME]',
  contactEmail: '[CONTACT EMAIL]',
  privacyEmail: '[PRIVACY CONTACT EMAIL]',
  address: '[POSTAL ADDRESS]',
  governingLaw: '[COUNTRY / STATE OF GOVERNING LAW]',
  minimumAge: 13,
  legalUpdated: '[DATE THESE TERMS TAKE EFFECT]',
  /** Google AdSense publisher ID (ADSENSE_CLIENT overrides it; forks should use their own). */
  adsenseClient: 'ca-pub-5183770861913918',
  /** Where the helper's default allowed origin points; must match the deployed domain. */
  helperPort: 5310,
};
