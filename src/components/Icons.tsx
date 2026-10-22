import React from 'react';

const P: Record<string, React.ReactNode> = {
  play: <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />,
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </g>
  ),
  stepBack: <path d="M17 6l-7 6 7 6V6zM8 6v12" />,
  stepFwd: <path d="M7 6l7 6-7 6V6zM16 6v12" />,
  toIn: <path d="M6 5v14M19 6l-8 6 8 6z" />,
  toOut: <path d="M18 5v14M5 6l8 6-8 6z" />,
  markIn: <path d="M9 4h-3v16h3M14 12h6M17 9l3 3-3 3" />,
  markOut: <path d="M15 4h3v16h-3M10 12H4M7 9l-3 3 3 3" />,
  insert: <path d="M4 12h9M10 8l4 4-4 4M17 5v14M20 5v14" />,
  overwrite: <path d="M4 12h9M10 8l4 4-4 4M16 6h4v12h-4z" />,
  lift: <path d="M12 19V7M7 11l5-5 5 5M4 20h16" />,
  extract: <path d="M12 5v12M7 13l5 5 5-5M4 4h16" />,
  camera: <path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />,
  select: <path d="M6 3l12 9-5.5 1.2L15 19l-2.5 1-2.6-5.8L6 17z" fill="currentColor" stroke="none" />,
  razor: <path d="M7 7l10 10M7 17L17 7M5 5a2 2 0 103 0 2 2 0 00-3 0M16 16a2 2 0 103 0 2 2 0 00-3 0" />,
  ripple: <path d="M5 4v16M9 8h10M9 16h10M15 5l4 3-4 3M15 13l4 3-4 3" />,
  rolling: <path d="M12 3v18M4 12h5M15 12h5M7 9l-3 3 3 3M17 9l3 3-3 3" />,
  rate: <path d="M4 7h4v10H4zM16 7h4v10h-4zM9 12h6M12 9l3 3-3 3" />,
  slip: <path d="M5 5v14M19 5v14M8 12h8M10 9l-3 3 3 3M14 9l3 3-3 3" />,
  slide: <path d="M3 8h5v8H3zM16 8h5v8h-5zM9 12h6M12 10l3 2-3 2" />,
  hand: <path d="M8 13V6.5a1.5 1.5 0 013 0V12m0-6.5V5a1.5 1.5 0 013 0v7m0-5.5a1.5 1.5 0 013 0V13c0 4-2.5 7-6 7-2.5 0-4-1.2-5.5-3.5L4.7 13.4a1.5 1.5 0 012.6-1.5L8 13" />,
  type: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  trackfwd: <path d="M4 5v14M8 12h11M15 8l4 4-4 4M8 7h5M8 17h5" />,
  lock: <path d="M6 11h12v9H6zM8 11V8a4 4 0 018 0v3" />,
  unlock: <path d="M6 11h12v9H6zM8 11V8a4 4 0 017.5-2" />,
  eye: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z" />,
  eyeOff: <path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.2" />,
  magnet: <path d="M5 4h4v8a3 3 0 006 0V4h4v8a7 7 0 01-14 0zM5 8h4M15 8h4" />,
  link: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  marker: <path d="M6 3h12v12l-6 6-6-6z" />,
  wrench: <path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  folder: <path d="M3 6h7l2 2h9v11H3z" />,
  film: <path d="M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" />,
  audio: <path d="M9 18V6l10-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM19 16a3 3 0 11-6 0 3 3 0 016 0z" />,
  image: <path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5a1.5 1.5 0 100-.01" />,
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  search: <path d="M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5" />,
  send: <path d="M4 12l16-8-6 16-2.5-6.5z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  gear: <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 15.3H3a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 009.7 4.7V3a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1.3z" />,
  sparkle: <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" stroke="none" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />,
  mic: <path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM5 11a7 7 0 0014 0M12 18v3" />,
  speaker: <path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11" />,
  mute: <path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6" />,
  scissors: <path d="M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />,
  stopwatch: <path d="M12 21a8 8 0 100-16 8 8 0 000 16zM12 9v4l2 2M10 2h4" />,
  diamond: <path d="M12 3l9 9-9 9-9-9z" fill="currentColor" stroke="none" />,
  reset: <path d="M4 4v6h6M20 20v-6h-6M5 13a7 7 0 0012 4M19 11A7 7 0 007 7" />,
  wand: <path d="M4 20L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.6 1.4L21 13l-1.4.6L19 15l-.6-1.4L17 13l1.4-.6z" />,
  export: <path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6" />,
  safe: <path d="M3 4h18v16H3zM6 7h12v10H6z" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  check: <path d="M5 12l5 5 9-10" />,
  dots: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  copy: <path d="M8 8h11v12H8zM5 16V4h11" />,
  paste: <path d="M9 4h6v3H9zM7 5H5v15h14V5h-2M9 12h6M9 16h4" />,
  attach: <path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7" />,
  newchat: <path d="M12 20H5a1 1 0 01-1-1V5a1 1 0 011-1h14a1 1 0 011 1v7M16 19h6M19 16v6" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />,
  zoomIn: <path d="M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5M8 11h6M11 8v6" />,
  zoomOut: <path d="M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5M8 11h6" />,
};

export function Icon({ name, size = 16, className, style, title }: { name: string; size?: number; className?: string; style?: React.CSSProperties; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      {title && <title>{title}</title>}
      {P[name] ?? P.dots}
    </svg>
  );
}
