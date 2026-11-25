// Put the video and audio of downloaded files into one MP4 (or WebM) without re-encoding, in the browser: yt-dlp
// fetches YouTube's video and audio as separate files, and HLS sites as MPEG-TS, which the browser can't play.
import { ALL_FORMATS, BlobSource, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, MP4, Output, QTFF, StreamTarget, WEBM, WebMOutputFormat } from 'mediabunny';
import type { InputAudioTrack, InputVideoTrack } from 'mediabunny';

/** True when the file already plays in the browser as it is (MP4, MOV or WebM). */
export async function playsAsIs(file: Blob) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const f = await input.getFormat();
    return f === MP4 || f === QTFF || f === WEBM;
  } catch {
    return false;
  } finally {
    input.dispose?.();
  }
}

/**
 * Copy the first video track and first audio track found in `files` into one file written to `writable`.
 * Returns the extension of what was written ('mp4', or 'webm' for codecs MP4 can't hold).
 */
export async function remux(files: Blob[], writable: FileSystemWritableFileStream): Promise<'mp4' | 'webm'> {
  const inputs = files.map((f) => new Input({ source: new BlobSource(f), formats: ALL_FORMATS }));
  try {
    let vt: InputVideoTrack | null = null;
    let at: InputAudioTrack | null = null;
    for (const i of inputs) {
      vt ??= await i.getPrimaryVideoTrack();
      at ??= await i.getPrimaryAudioTrack();
    }
    if (!vt && !at) throw new Error('No video or audio found in the download');
    const mp4 = new Mp4OutputFormat();
    const fitsMp4 = (!vt?.codec || mp4.getSupportedVideoCodecs().includes(vt.codec)) && (!at?.codec || mp4.getSupportedAudioCodecs().includes(at.codec));
    const format = fitsMp4 ? mp4 : new WebMOutputFormat();
    const out = new Output({ format, target: new StreamTarget(writable as unknown as WritableStream) });
    const vs = vt?.codec ? new EncodedVideoPacketSource(vt.codec) : null;
    const as = at?.codec ? new EncodedAudioPacketSource(at.codec) : null;
    if (vt && vs) out.addVideoTrack(vs, { rotation: vt.rotation });
    if (at && as) out.addAudioTrack(as);
    await out.start();
    const vCfg = vt ? await vt.getDecoderConfig() : null;
    const aCfg = at ? await at.getDecoderConfig() : null;
    const vIt = vt && vs ? new EncodedPacketSink(vt).packets() : null;
    const aIt = at && as ? new EncodedPacketSink(at).packets() : null;
    let v = vIt ? await vIt.next() : { done: true as const, value: undefined };
    let a = aIt ? await aIt.next() : { done: true as const, value: undefined };
    let firstV = true;
    let firstA = true;
    // interleave the two tracks by time
    while (!v.done || !a.done) {
      if (!v.done && (a.done || v.value.timestamp <= a.value.timestamp)) {
        await vs!.add(v.value, firstV && vCfg ? { decoderConfig: vCfg } : undefined);
        firstV = false;
        v = await vIt!.next();
      } else if (!a.done) {
        await as!.add(a.value, firstA && aCfg ? { decoderConfig: aCfg } : undefined);
        firstA = false;
        a = await aIt!.next();
      }
    }
    vs?.close();
    as?.close();
    await out.finalize();
    return fitsMp4 ? 'mp4' : 'webm';
  } finally {
    for (const i of inputs) i.dispose?.();
  }
}
