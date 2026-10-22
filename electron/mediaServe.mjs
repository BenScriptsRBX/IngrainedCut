// Serves local media files with HTTP Range support (video seeking). Used by the Electron icut:// protocol
// and by the web server's /media/ route.
import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.json': 'application/json',
};

/** Media URLs stored in projects are always icut://media/<encoded path>; the web client maps them to /media/. */
export const mediaUrl = (p) => 'icut://media/' + encodeURIComponent(p);

/**
 * @returns {{status:number, headers:Record<string,string>, stream?: fs.ReadStream}}
 */
export function openMedia(filePath, rangeHeader) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch {
    return { status: 404, headers: {} };
  }
  if (!st.isFile()) return { status: 404, headers: {} };
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (rangeHeader) {
    const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    let start = m?.[1] ? parseInt(m[1], 10) : 0;
    let end = m?.[2] ? parseInt(m[2], 10) : st.size - 1;
    if (m && !m[1] && m[2]) {
      start = Math.max(0, st.size - parseInt(m[2], 10));
      end = st.size - 1;
    }
    end = Math.min(end, st.size - 1);
    if (start > end) return { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } };
    return {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) },
      stream: fs.createReadStream(filePath, { start, end }),
    };
  }
  return { status: 200, headers: { ...headers, 'Content-Length': String(st.size) }, stream: fs.createReadStream(filePath) };
}
