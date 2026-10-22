// The IngrainedCut tool registry. Shared by the in-app Claude chat (Agent SDK in-process MCP server)
// and the standalone stdio MCP server (mcp/server.mjs) used by external Claude Code sessions.
// `where` says who executes the tool: the renderer (owns the timeline state) or the main process.
import { z } from 'zod';

const n = () => z.number();
const track = () => z.string().describe('Track name such as "V1", "V2", "A1", or a track id');
const time = (what = 'Timeline time') => z.number().describe(`${what} in seconds`);

const transform = z
  .object({
    x: n().describe('Horizontal offset from frame center, in sequence pixels'),
    y: n().describe('Vertical offset from frame center, in sequence pixels (positive = down)'),
    scale: n().describe('Scale percent, 100 = fit to frame'),
    rotation: n().describe('Degrees clockwise'),
    opacity: n().describe('0-100'),
  })
  .partial();

const effects = z
  .object({
    brightness: n().describe('-100..100, 0 = none'),
    contrast: n().describe('-100..100, 0 = none'),
    saturation: n().describe('0..300 percent, 100 = none, 0 = black & white'),
    hue: n().describe('Hue rotation in degrees'),
    temperature: n().describe('-100 (cool/blue) .. 100 (warm/orange)'),
    tint: n().describe('-100 (green) .. 100 (magenta)'),
    blur: n().describe('Gaussian blur radius in pixels'),
    grayscale: n().describe('0-100'),
    sepia: n().describe('0-100'),
    invert: n().describe('0-100'),
    vignette: n().describe('0-100'),
  })
  .partial();

const LOOK_IDS = ['look-teal-orange', 'look-warm-film', 'look-cool-night', 'look-bleach-bypass', 'look-vintage-fade', 'look-mono-contrast', 'look-vivid'];
const wheel = z
  .object({ x: n().describe('-1..1 push toward red(+x)…cyan(-x)'), y: n().describe('-1..1 push toward green/yellow(+y)…blue/magenta(-y)'), luma: n().describe('-100..100 brightness of this range') })
  .partial();
const curve = z.array(z.tuple([n(), n()])).describe('Control points [input, output] in 0..1, e.g. [[0,0],[0.25,0.2],[0.75,0.8],[1,1]] for an S-curve');
const colorGrade = z
  .object({
    enabled: z.boolean(),
    exposure: n().describe('Stops, -5..5 (0.5 = half a stop brighter)'),
    highlights: n().describe('-100..100'),
    shadows: n().describe('-100..100 (positive lifts detail out of the shadows)'),
    whites: n().describe('-100..100'),
    blacks: n().describe('-100..100'),
    vibrance: n().describe('-100..100, boosts muted colours more than saturated ones'),
    wheels: z.object({ shadows: wheel, midtones: wheel, highlights: wheel }).partial().describe('Lift / gamma / gain colour wheels'),
    curves: z.object({ master: curve, r: curve, g: curve, b: curve }).partial(),
  })
  .partial()
  .describe('Colour grade (GPU). Merged into the existing grade; white balance is effects.temperature / effects.tint, contrast and saturation are in effects too.');

const textStyle = z
  .object({
    content: z.string().describe('Text; use \\n for new lines'),
    font: z.string().describe('CSS font family, e.g. "Inter", "Arial", "Georgia", "Impact"'),
    size: n().describe('Font size in sequence pixels'),
    color: z.string().describe('CSS color'),
    bold: z.boolean(),
    italic: z.boolean(),
    align: z.enum(['left', 'center', 'right']),
    stroke_color: z.string(),
    stroke_width: n(),
    background_color: z.string(),
    background_opacity: n().describe('0-100'),
    shadow: z.boolean(),
  })
  .partial();

const TRANSITIONS = ['cross-dissolve', 'dip-to-black', 'dip-to-white', 'wipe-left', 'wipe-right', 'slide-left', 'slide-right', 'push-left', 'zoom-in', 'blur-dissolve'];

const clipProperties = z
  .object({
    name: z.string(),
    enabled: z.boolean(),
    speed: n().describe('Playback speed multiplier, 1 = normal, 2 = double speed, 0.5 = slow motion. Changes clip duration.'),
    speed_ripple: z
      .boolean()
      .describe('With speed: true (default) shifts every later clip on the track(s) by the change in length, even across gaps. false keeps later clips in place: slowing down only fills empty space up to the next clip (the end of the source is cut off), speeding up leaves a gap. Use false for speed ramps built from several pieces.'),
    volume_db: n().describe('Clip gain in dB, 0 = unchanged, -60 = silent'),
    pan: n().describe('-100 (left) .. 100 (right)'),
    fade_in: n().describe('Fade-in seconds (opacity for visuals, volume for audio)'),
    fade_out: n().describe('Fade-out seconds'),
    source_in: n().describe('Slip: source media time (s) shown at the clip start'),
    transform,
    effects,
    crop: z.object({ left: n(), right: n(), top: n(), bottom: n() }).partial().describe('Crop percents 0-100'),
    blend_mode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add', 'difference']),
    text: textStyle,
    color: z.string().describe('Fill color for color mattes'),
    label: z.string().describe('Timeline label color (CSS color)'),
    chroma_key: z.object({ enabled: z.boolean(), color: z.string(), tolerance: n(), softness: n() }).partial(),
    color_grade: colorGrade,
    look: z.enum(['none', ...LOOK_IDS]).describe('Creative look (3D LUT): none, ' + LOOK_IDS.join(', ')),
    look_intensity: n().describe('0..100, default 100'),
  })
  .partial();

export const TOOL_DEFS = [
  {
    name: 'get_project_state',
    where: 'renderer',
    description:
      'Return the full current editor state: sequence settings, media bin, tracks, every clip with timing/properties, markers, playhead, selection. The user may edit manually between your messages, so call this whenever you need exact, fresh values.',
    shape: { detail: z.enum(['summary', 'full']).optional().describe('summary = compact text; full = JSON with all clip properties (default full)') },
  },
  {
    name: 'import_media',
    where: 'renderer',
    description: 'Import media files (video, audio, images) from disk into the project bin. Returns the new media ids.',
    shape: { paths: z.array(z.string()).describe('Absolute file paths') },
  },
  {
    name: 'add_clip',
    where: 'renderer',
    description:
      'Place a media item from the bin onto the timeline. Video with audio also places a linked audio clip on the matching audio track. Overwrites whatever is underneath unless mode="insert" (which ripples later clips right).',
    shape: {
      media_id: z.string(),
      start: time('Timeline position').optional().describe('Timeline start in seconds; default = end of the target track'),
      track: track().optional().describe('Video track for visuals (default V1), audio track for audio-only media (default A1), or "auto" for the lowest video track that is free over the clip\'s time range'),
      audio_track: track().optional().describe('Audio track for the linked audio (default: same number as the video track)'),
      source_in: z.number().optional().describe('Source in point (s), default 0'),
      source_out: z.number().optional().describe('Source out point (s), default end of media'),
      duration: z.number().optional().describe('Duration on timeline (s); for images default 5s'),
      include_audio: z.boolean().optional().describe('Place linked audio (default true)'),
      include_video: z.boolean().optional().describe('Place video (default true)'),
      mode: z.enum(['overwrite', 'insert']).optional(),
    },
  },
  {
    name: 'add_text',
    where: 'renderer',
    description: 'Add a text / title clip on a video track (default: the top-most empty-at-that-time video track, creating one if needed).',
    shape: {
      text: z.string(),
      start: time(),
      duration: z.number().describe('Seconds'),
      track: track().optional(),
      style: textStyle.optional(),
      transform: transform.optional(),
      fade_in: z.number().optional(),
      fade_out: z.number().optional(),
    },
  },
  {
    name: 'add_color_matte',
    where: 'renderer',
    description: 'Add a solid color clip (backgrounds, flashes, letterbox bars combined with crop/transform).',
    shape: { color: z.string(), start: time(), duration: z.number(), track: track().optional() },
  },
  {
    name: 'add_adjustment_layer',
    where: 'renderer',
    description: 'Add an adjustment layer: its effects apply to everything on the tracks below it for its duration (great for global color grading).',
    shape: { start: time(), duration: z.number(), track: track().optional(), effects: effects.optional() },
  },
  {
    name: 'move_clip',
    where: 'renderer',
    description: 'Move a clip to a new start time and/or track. Linked clips move with it. Overwrites clips at the destination.',
    shape: {
      clip_id: z.string(),
      start: time('New timeline start').optional(),
      track: track().optional(),
      move_linked: z.boolean().optional().describe('default true'),
    },
  },
  {
    name: 'trim_clip',
    where: 'renderer',
    description:
      'Trim a clip by setting its new timeline start and/or end (content stays anchored, like dragging the clip edges). Linked clips are trimmed too. ripple=true shifts later clips on the affected tracks to keep them adjacent.',
    shape: {
      clip_id: z.string(),
      new_start: time('New in edge').optional(),
      new_end: time('New out edge').optional(),
      ripple: z.boolean().optional(),
    },
  },
  {
    name: 'sync_clips',
    where: 'renderer',
    description:
      'Synchronize clips with a reference clip: by audio (matches the sound, e.g. camera audio with an external mic or several cameras; needs audio on both), or by clip start / end. Linked clips move together. The reference stays put: reference_clip_id, else the selected group on the lowest track that starts first. link=true links all synced clips into one group.',
    shape: {
      clip_ids: z.array(z.string()).describe('At least two clips (or linked groups)'),
      method: z.enum(['audio', 'start', 'end']).optional().describe('default audio'),
      reference_clip_id: z.string().optional(),
      link: z.boolean().optional(),
    },
  },
  {
    name: 'remove_silence',
    where: 'renderer',
    description:
      'Cut out silent stretches: finds where the audio is quieter than threshold_db for at least min_duration and ripple-deletes those ranges on every track (picture and sound stay in sync). Uses the waveform data, so it is fast. clip_ids limits which audio is listened to (default: all audio on the timeline). Returns the removed timeline ranges.',
    shape: {
      threshold_db: n().optional().describe('default -40'),
      min_duration: n().optional().describe('Seconds, default 0.6'),
      padding: n().optional().describe('Seconds kept around speech, default 0.12'),
      clip_ids: z.array(z.string()).optional(),
      dry_run: z.boolean().optional().describe('Only report the ranges'),
    },
  },
  {
    name: 'auto_color',
    where: 'renderer',
    description: 'Automatic basic correction of a clip from the frame under the playhead (or its middle): sets exposure, whites, blacks and white balance.',
    shape: { clip_id: z.string() },
  },
  {
    name: 'split_clip',
    where: 'renderer',
    description: 'Razor cut at a timeline time. With clip_id splits that clip (and its linked partners); with track splits that track; with neither splits every unlocked track.',
    shape: { time: time(), clip_id: z.string().optional(), track: track().optional() },
  },
  {
    name: 'delete_clips',
    where: 'renderer',
    description: 'Delete clips. ripple=true closes the resulting gaps by shifting later clips left on those tracks.',
    shape: { clip_ids: z.array(z.string()), ripple: z.boolean().optional(), include_linked: z.boolean().optional().describe('default true') },
  },
  {
    name: 'ripple_delete_range',
    where: 'renderer',
    description:
      'Cut a time range out of the sequence: removes everything between start and end on the given tracks (default all unlocked tracks) and pulls later material left. Ideal for removing silences, mistakes, or tightening.',
    shape: { start: time(), end: time(), tracks: z.array(track()).optional() },
  },
  {
    name: 'ripple_delete_ranges',
    where: 'renderer',
    description: 'Same as ripple_delete_range for many ranges at once (given in ORIGINAL timeline times; handled back-to-front so the times stay valid). One undo step.',
    shape: { ranges: z.array(z.object({ start: z.number(), end: z.number() })), tracks: z.array(track()).optional() },
  },
  {
    name: 'close_gaps',
    where: 'renderer',
    description: 'Remove empty space between clips on the given tracks (default all) by shifting clips left.',
    shape: { tracks: z.array(track()).optional() },
  },
  {
    name: 'set_clip_properties',
    where: 'renderer',
    description:
      'Change properties of one or more clips: name, speed, volume, pan, fades, slip, transform (position/scale/rotation/opacity), basic color effects, a full color grade (exposure, highlights/shadows/whites/blacks, vibrance, colour wheels, RGB curves), a creative look, crop, blend mode, text content/style, matte color, chroma key. Only the given fields change. Check colour work with capture_frame.',
    shape: { clip_ids: z.array(z.string()), properties: clipProperties },
  },
  {
    name: 'add_transition',
    where: 'renderer',
    description:
      'Add a transition at a clip edge. edge="in" transitions from the previous adjacent clip on the same track (or from nothing); "out" transitions to nothing (e.g. fade to black at the end). Types: ' + TRANSITIONS.join(', '),
    shape: {
      clip_ids: z.array(z.string()),
      edge: z.enum(['in', 'out', 'both']).optional().describe('default in'),
      type: z.enum(TRANSITIONS).optional().describe('default cross-dissolve'),
      duration: z.number().optional().describe('Seconds, default 1'),
    },
  },
  {
    name: 'remove_transition',
    where: 'renderer',
    description: 'Remove transitions from clip edges.',
    shape: { clip_ids: z.array(z.string()), edge: z.enum(['in', 'out', 'both']).optional() },
  },
  {
    name: 'set_keyframes',
    where: 'renderer',
    description:
      'Animate a clip property with keyframes (linear/eased interpolation). Times are TIMELINE seconds. Properties: x, y, scale, rotation, opacity, volume (dB). Pass an empty list to remove animation.',
    shape: {
      clip_id: z.string(),
      property: z.enum(['x', 'y', 'scale', 'rotation', 'opacity', 'volume']),
      keyframes: z.array(z.object({ time: z.number(), value: z.number(), ease: z.enum(['linear', 'ease', 'hold']).optional() })),
    },
  },
  {
    name: 'manage_tracks',
    where: 'renderer',
    description: 'Add or remove tracks, or set track flags (mute, solo, lock, hide, volume).',
    shape: {
      action: z.enum(['add', 'remove', 'set']),
      kind: z.enum(['video', 'audio']).optional().describe('For add'),
      track: track().optional().describe('For remove / set'),
      muted: z.boolean().optional(),
      solo: z.boolean().optional(),
      locked: z.boolean().optional(),
      hidden: z.boolean().optional(),
      volume_db: z.number().optional(),
    },
  },
  {
    name: 'markers',
    where: 'renderer',
    description: 'Add, update or remove timeline markers (useful for notes, beats, chapters).',
    shape: {
      action: z.enum(['add', 'remove', 'clear']),
      time: z.number().optional(),
      name: z.string().optional(),
      color: z.string().optional(),
      note: z.string().optional(),
      marker_id: z.string().optional(),
    },
  },
  {
    name: 'set_playhead',
    where: 'renderer',
    description: 'Move the playhead (the user sees the program monitor jump there). Optionally set the sequence in/out points used for export ranges.',
    shape: { time: z.number().optional(), in_point: z.number().nullable().optional(), out_point: z.number().nullable().optional() },
  },
  {
    name: 'select_clips',
    where: 'renderer',
    description: 'Select/highlight clips in the timeline so the user can see what you are referring to.',
    shape: { clip_ids: z.array(z.string()) },
  },
  {
    name: 'set_sequence_settings',
    where: 'renderer',
    description: 'Change sequence resolution, frame rate, background color or name (e.g. 1080x1920 for vertical/shorts).',
    shape: { width: z.number().optional(), height: z.number().optional(), fps: z.number().optional(), background: z.string().optional(), name: z.string().optional() },
  },
  {
    name: 'capture_frame',
    where: 'renderer',
    description: 'Render the program output (the composited timeline) at a time and return it as an image so you can SEE the edit. Use it to verify visual changes.',
    shape: { time: z.number().optional().describe('Default: playhead'), width: z.number().optional().describe('Image width px, default 960') },
  },
  {
    name: 'capture_contact_sheet',
    where: 'renderer',
    description: 'Render a grid of evenly spaced frames of the program output (or of a single source media item) as one image, with timestamps. Lets you skim footage/the edit visually.',
    shape: {
      start: z.number().optional(),
      end: z.number().optional(),
      count: z.number().optional().describe('Number of frames, default 12, max 30'),
      media_id: z.string().optional().describe('Skim a bin media item instead of the sequence (times are then source times)'),
    },
  },
  {
    name: 'screenshot_editor',
    where: 'main',
    description: 'Screenshot the whole IngrainedCut window (timeline, monitors, panels) exactly as the user sees it.',
    shape: {},
  },
  {
    name: 'detect_silence',
    where: 'main',
    description:
      'Find silent parts in a media item or timeline clip. Returns ranges in source time and, for clips, in timeline time (ready for ripple_delete_ranges).',
    shape: {
      media_id: z.string().optional(),
      clip_id: z.string().optional(),
      threshold_db: z.number().optional().describe('Noise floor, default -35'),
      min_duration: z.number().optional().describe('Minimum silence length (s), default 0.5'),
    },
  },
  {
    name: 'detect_scenes',
    where: 'main',
    description: 'Detect shot changes / scene cuts in a video media item or clip. Returns cut times (source, and timeline for clips).',
    shape: { media_id: z.string().optional(), clip_id: z.string().optional(), threshold: z.number().optional().describe('0-1, default 0.3') },
  },
  {
    name: 'transcribe',
    where: 'main',
    description:
      'Speech-to-text with timestamps for a media item or clip (Whisper via ffmpeg). Use it for cutting by what is said, finding quotes, making captions.',
    shape: { media_id: z.string().optional(), clip_id: z.string().optional(), language: z.string().optional().describe('e.g. "en", default auto') },
  },
  {
    name: 'analyze_loudness',
    where: 'main',
    description: 'Measure integrated loudness (LUFS) and true peak of a media item, e.g. to normalise dialogue with volume_db.',
    shape: { media_id: z.string() },
  },
  {
    name: 'add_captions',
    where: 'renderer',
    description: 'Create caption text clips from timed segments (e.g. from transcribe) on a dedicated top video track. Times are TIMELINE seconds.',
    shape: {
      segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })),
      style: textStyle.optional(),
      y: z.number().optional().describe('Vertical offset from center, default 35% of height (lower third)'),
    },
  },
  {
    name: 'render_composition',
    where: 'main',
    description:
      'Render a HyperFrames composition project (a folder with index.html, built with the hyperframes skills) and put the result in the editor. format "webm" renders with transparency for overlays (titles, lower thirds, captions over footage); "mp4" for full-frame pieces. By default the render is imported and placed on the timeline at `start` (default: playhead) on a free video track. To revise a composition already in the edit, pass replace_media_id: every clip using that media updates in place.',
    shape: {
      project_dir: z.string().describe('Composition folder (absolute, or relative to your working directory, e.g. "compositions/intro-title")'),
      format: z.enum(['mp4', 'webm', 'mov']).optional().describe('Default mp4; webm/mov carry alpha'),
      quality: z.enum(['draft', 'looks', 'delivery']).optional().describe('Default looks'),
      name: z.string().optional().describe('Name for the media in the bin'),
      place: z.boolean().optional().describe('Place on the timeline (default true unless replace_media_id)'),
      start: z.number().optional().describe('Timeline start in seconds (default playhead)'),
      track: track().optional().describe('Video track, or "auto" (default) for the lowest free track over that time'),
      include_audio: z.boolean().optional().describe('Place the composition audio too (default true)'),
      replace_media_id: z.string().optional().describe('Re-render: swap this media item to the new render, updating its clips in place'),
    },
  },
  {
    name: 'relink_media',
    where: 'renderer',
    description: 'Point a media item at a different file (e.g. a re-rendered version or a moved/missing file). All clips using it update.',
    shape: { media_id: z.string(), path: z.string().describe('Absolute file path') },
  },
  {
    name: 'undo',
    where: 'renderer',
    description: 'Undo the last edit(s), exactly like Ctrl+Z.',
    shape: { steps: z.number().optional() },
  },
  {
    name: 'redo',
    where: 'renderer',
    description: 'Redo edits.',
    shape: { steps: z.number().optional() },
  },
  {
    name: 'batch',
    where: 'renderer',
    description:
      'Run several editing tools in order as ONE undo step, e.g. [{"tool":"split_clip","args":{...}}, ...]. Use for multi-step edits. Results of each step are returned.',
    shape: { operations: z.array(z.object({ tool: z.string(), args: z.record(z.string(), z.any()) })) },
  },
  {
    name: 'export_video',
    where: 'renderer',
    description: 'Render the sequence to a file. Shows progress to the user and returns when finished.',
    shape: {
      path: z.string().describe('Absolute output path'),
      format: z.enum(['mp4-h264', 'mp4-h265', 'mov-prores', 'webm-vp9', 'gif', 'mp3', 'wav']).optional(),
      quality: z.number().optional().describe('CRF-like, lower = better, default 18'),
      range: z.enum(['all', 'in-out']).optional(),
      scale: z.number().optional().describe('Resolution multiplier, e.g. 0.5'),
    },
  },
  {
    name: 'save_project',
    where: 'renderer',
    description: 'Save the project (.icut). Without a path saves to the current file (or asks the user).',
    shape: { path: z.string().optional() },
  },
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

export const SERVER_INSTRUCTIONS = `IngrainedCut is a non-linear video editor (Premiere Pro style) running on the user's computer. These tools read and edit its open project live; the user watches the timeline and program monitor update as you work.
Conventions: all times are seconds (floats); tracks are named V1, V2… (V1 is the bottom video layer, higher numbers draw on top) and A1, A2…; clip ids look like "c12", media ids like "m3". A video clip and its audio are "linked" (same link id) and move/trim/split together.
Workflow: read state (get_project_state), make edits (prefer batch / ripple_delete_ranges for many changes), then verify visually with capture_frame or capture_contact_sheet. Every tool call is one undo step for the user.
Common jobs: cut out dead air with remove_silence (dry_run first to see the ranges); line up multicam / external-mic recordings with sync_clips (method "audio"); split at shot changes with detect_scenes + split_clip; grade with set_clip_properties → color_grade (exposure, highlights/shadows/whites/blacks, vibrance, wheels, curves), effects.temperature/tint/contrast/saturation and look (built-in LUTs), or auto_color as a starting point — grade one clip, then apply the same properties to matching clips, and check with capture_frame.`;
