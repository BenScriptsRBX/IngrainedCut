// Public-facing details used across the site and the legal pages.
// The Terms and Privacy Policy read these; update legalUpdated whenever those pages change.
export const SITE = {
  name: 'IngrainedCut',
  tagline: 'The video editor you can talk to.',
  description:
    'IngrainedCut is a professional, timeline-based video editor with Claude, Codex and Cursor built in. Describe the edit — your AI makes it on the timeline while you watch.',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  /** Who runs the Service, as named in the Terms and Privacy Policy (a trade name; swap in an LLC's name if you form one). */
  company: 'IngrainedCut',
  contactEmail: 'ingrainedcut@proton.me',
  privacyEmail: 'ingrainedcut@proton.me',
  governingLaw: 'the State of Arizona, United States',
  minimumAge: 13,
  legalUpdated: 'October 22, 2026',
  /** Google AdSense publisher ID (ADSENSE_CLIENT overrides it; forks should use their own). */
  adsenseClient: 'ca-pub-5183770861913918',
  /** Where the helper's default allowed origin points; must match the deployed domain. */
  helperPort: 5310,
};
