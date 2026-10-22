'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function HeaderAuth() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return <span style={{ width: 120 }} />;
  if (!data)
    return (
      <>
        <Link href="/login" className="btn sm ghost">
          Sign in
        </Link>
        <Link href="/login?next=/projects" className="btn sm primary">
          Start editing
        </Link>
      </>
    );
  return (
    <>
      <Link href="/projects" className="btn sm">
        Your projects
      </Link>
      <UserMenu name={data.user.name} email={data.user.email} image={data.user.image} />
    </>
  );
}

export function UserMenu({ name, email, image }: { name: string; email: string; image?: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="avatar" onClick={() => setOpen(!open)} aria-label="Account menu" style={{ cursor: 'pointer', padding: 0, overflow: 'hidden' }}>
        {image ? <img src={image} alt="" width={32} height={32} referrerPolicy="no-referrer" /> : (name || email || '?')[0].toUpperCase()}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="who">
            {name}
            <small>{email}</small>
          </div>
          <Link href="/projects" role="menuitem">
            Your projects
          </Link>
          <Link href="/download" role="menuitem">
            Helper setup
          </Link>
          <Link href="/account" role="menuitem">
            Account
          </Link>
          <button
            role="menuitem"
            onClick={async () => {
              await authClient.signOut();
              location.href = '/';
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
