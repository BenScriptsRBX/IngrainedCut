import Link from 'next/link';
import { SITE } from '@/lib/site';
import { HeaderAuth } from './HeaderAuth';

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label={`${SITE.name} home`}>
      <span className="logo-mark">Ic</span>
      {SITE.name}
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container">
        <Logo />
        <nav className="nav" aria-label="Main">
          <Link href="/#features">Features</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/#agents">AI agents</Link>
          <Link href="/#privacy">Privacy</Link>
          <Link href="/download">Helper</Link>
        </nav>
        <div className="header-right">
          <HeaderAuth />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Logo />
            <p style={{ maxWidth: 340, marginTop: 14 }}>A professional video editor you can talk to. Your footage stays on your computer.</p>
          </div>
          <div>
            <h4>Product</h4>
            <Link href="/#features">Features</Link>
            <Link href="/#agents">AI agents</Link>
            <Link href="/download">Download the helper</Link>
            <Link href="/projects">Your projects</Link>
          </div>
          <div>
            <h4>Legal</h4>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/licenses">Open-source licenses</Link>
            <a href="https://github.com/BenScriptsRBX/IngrainedCut" rel="noopener">Source code (AGPL-3.0)</a>
          </div>
          <div>
            <h4>Support</h4>
            <a className="kofi-link" href="https://ko-fi.com/ingrainedcut" target="_blank" rel="noopener noreferrer">
              <img src="/kofi-cup.png" alt="" width={24} height={19} />
              Support on Ko-fi
            </a>
          </div>
          <div>
            <h4>Contact</h4>
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
          </div>
        </div>
        <div className="fineprint">
          © {new Date().getFullYear()} {SITE.company}. All rights reserved. Claude is a trademark of Anthropic, PBC. Codex and ChatGPT are trademarks of OpenAI.
          Cursor is a trademark of Anysphere, Inc. HyperFrames is a project of HeyGen. {SITE.name} is an independent product and is not affiliated with,
          endorsed by or sponsored by these companies. AI features use your own accounts with those providers and are subject to their terms.
        </div>
      </div>
    </footer>
  );
}
