// Tool definitions for documentary editing (see electron/docTools.mjs and src/docTools.ts). Kept apart from
// tools.mjs so the general editing tools stay readable.

export const DOC_INSTRUCTIONS = `
Documentary editing: project_template("doc") sets the tracks (V1 Footage · V2 Overlays · V3 Text; A1 Narration · A2 Clip audio · A3 Music · A4 SFX / Ambience) and every tool also finds tracks by those names. Build from the plan files with import_edl (04_edl.csv) and import_cues (05_cues.csv), compare with check_edl, list with get_timeline. Polish with set_motion, j_cut / l_cut, add_text_card, add_panel; audio with duck, breath, mute_music_under, fade, beat_grid / snap_to_beat, ambience_fill, normalize. Check your cut with qa_report (it runs analyze_loudness, detect_silence, detect_cuts, detect_freezes and transcribe against the targets) and capture_contact_sheet; deliver with export_video presets, export_chapters, export_credits, make_short. snapshot before big changes, restore to go back. Every write tool takes dry_run.`;

/** @param {{ z: typeof import('zod').z, n: () => any, track: () => any, time: (w?: string) => any, TRANSITIONS: string[] }} h */
export function docTools({ z, track }) {
  const presets = ['chapter_card', 'date_card', 'quote_card', 'name_super', 'list_card'];
  return [
    // ---------- P1: build the timeline ----------
    {
      name: 'get_timeline',
      where: 'renderer',
      description:
        'Every clip in timeline order, compactly: id, track, src (bin name) / media_id, src_in/src_out, start/end, gain_db, effects, motion, transitions, fades, and the EDL / cue id, credit and role it came with. Also the tracks and markers. Lighter than get_project_state.',
      shape: { track: track().optional().describe('Only this track') },
    },
    {
      name: 'import_edl',
      where: 'main',
      description:
        'Build the timeline from an EDL CSV (04_edl.csv). Columns (case-insensitive): id, timeline_in, timeline_out, visual_type, source, source_in, source_out, on_screen_text, motion, transition_in, clip_audio_db, music_cue, sfx, credit, deliberate_hold. Times: seconds, m:ss, h:mm:ss or h:mm:ss:ff. visual_type: footage / raw / recreation / image → V1 Footage; panel / screenshot / document → floating panel on Overlays; chapter_card, date_card, quote_card, name_super, list_card → text card (blurred footage behind); black → nothing. source: a bin item, or a file (relative to the CSV), imported if needed. on_screen_text: "main | subtitle", or "preset: main | subtitle" over footage (default name_super). motion: push_in 3%, pull_out, pan left|right, slow_scroll. transition_in: cut, dissolve 0.5, dip_to_black 1. clip_audio_db: a number puts the clip sound on A2 Clip audio at that gain; empty or "mute" leaves it off. sfx: a file (optionally file.wav@-6) placed on SFX. credit and deliberate_hold are kept for export_credits / qa_report. Re-importing replaces the clips of the same row ids. Returns the clips made per row and the rows it skipped and why.',
      shape: {
        path: z.string().describe('The CSV file'),
        replace: z.boolean().optional().describe('Remove clips from earlier imports of the same row ids first (default true)'),
        template: z.boolean().optional().describe('Apply the doc track layout first (default true)'),
        style_path: z.string().optional().describe('Card style (default: FraggedIn/style.md found next to the CSV or the project, else built-in)'),
      },
    },
    {
      name: 'import_cues',
      where: 'main',
      description:
        'Place the sound plan from a cue CSV (05_cues.csv). Columns: id, type (music / silence / sfx / ambience / clip_audio), timeline_in, timeline_out, source, source_in, gain_db, fade_in, fade_out, duck (yes = duck under the narration), duck_depth_db, loop, snap (downbeat / phrase / beat: start the music on its next one), credit. music → A3 Music (another Music track when cues overlap), sfx / ambience → A4, clip_audio with a source → A2, clip_audio without one sets the gain of the clip audio in that range, silence → the music fades out and back in around it. Re-importing replaces the same cue ids.',
      shape: {
        path: z.string().describe('The CSV file'),
        replace: z.boolean().optional().describe('default true'),
        template: z.boolean().optional().describe('default true'),
      },
    },
    {
      name: 'check_edl',
      where: 'main',
      description: 'Compare the timeline with an EDL CSV: rows with no clip, clips that moved, have the wrong length or were slipped, and clips from row ids the file no longer has.',
      shape: { path: z.string(), tolerance_frames: z.number().optional().describe('default 1') },
    },
    {
      name: 'project_template',
      where: 'renderer',
      description: 'Set up the documentary track layout: V1 Footage, V2 Overlays/panels, V3 Text; A1 Narration, A2 Clip audio, A3 Music, A4 SFX / Ambience (names tracks, adds missing ones, keeps clips).',
      shape: { template: z.enum(['doc']).optional() },
    },
    {
      name: 'set_motion',
      where: 'renderer',
      description: 'A smooth camera move over the whole clip (scale/position keyframes, no zoompan jitter): push_in, pull_out, pan (direction left|right|up|down), slow_scroll (fills the width and travels down a tall screenshot), none (removes it).',
      shape: {
        clip_id: z.string().optional(),
        clip_ids: z.array(z.string()).optional(),
        type: z.enum(['push_in', 'pull_out', 'pan', 'slow_scroll', 'none']),
        amount_pct: z.number().optional().describe('How far, percent of scale, default 3'),
        ease: z.enum(['inOut', 'linear']).optional().describe('default inOut'),
        direction: z.enum(['left', 'right', 'up', 'down']).optional(),
      },
    },
    {
      name: 'j_cut',
      where: 'renderer',
      description: "J-cut: the clip's linked sound starts `frames` before its picture (over the previous shot). frames is counted from the picture edge, so calling again changes it; 0 lines them up.",
      shape: { clip_id: z.string(), frames: z.number().optional().describe('default 10') },
    },
    {
      name: 'l_cut',
      where: 'renderer',
      description: "L-cut: the clip's linked sound carries on `frames` after its picture ends (under the next shot). 0 lines them up again.",
      shape: { clip_id: z.string(), frames: z.number().optional().describe('default 10') },
    },
    {
      name: 'add_text_card',
      where: 'main',
      description: `A text card from the channel style (FraggedIn/style.md: one font family, white + one accent colour): ${presets.join(', ')}. Cards other than name_super blur and darken the footage behind them (an adjustment layer). subtitle: chapter/date → small accent line, quote → attribution, name_super → role, list_card → heading. chapter_card also adds a chapter marker.`,
      shape: {
        preset: z.enum(presets),
        text: z.string().describe('Main text (list_card: items separated by ; or new lines)'),
        at: z.number().describe('Timeline start (s)'),
        dur: z.number().optional().describe('Seconds, default 4'),
        subtitle: z.string().optional(),
        chapter_marker: z.boolean().optional().describe('chapter_card: add a chapter marker (default true)'),
        style_path: z.string().optional().describe('style.md (default: FraggedIn/style.md near the project)'),
      },
    },
    {
      name: 'add_panel',
      where: 'renderer',
      description: 'Float a screenshot / document / tweet over the footage (Overlays track): scaled, positioned, faded in and out, with an optional slow push and a dimmed or blurred background.',
      shape: {
        src: z.string().describe('Bin media id or name, or a file path (imported)'),
        at: z.number(),
        dur: z.number().optional().describe('default 5'),
        position: z.enum(['center', 'left', 'right', 'top', 'bottom', 'top_left', 'top_right', 'bottom_left', 'bottom_right']).optional(),
        scale: z.number().optional().describe('Percent of fit-to-frame, default 70'),
        push_pct: z.number().optional().describe('Slow push-in amount, default 2, 0 = none'),
        dim: z.number().optional().describe('Darken the footage behind, 0-100'),
        blur: z.number().optional().describe('Blur the footage behind (px)'),
        source_in: z.number().optional().describe('Video panels: source time to start from'),
      },
    },
    // ---------- P2: audio ----------
    {
      name: 'duck',
      where: 'renderer',
      description:
        'Duck the music under the narration: volume keyframes on the music clips go down by depth_db wherever the key track has speech (found from its waveform), attack before and release after, short gaps bridged so it does not pump. Re-running replaces the earlier ducking; remove: true takes it off. Envelopes from duck / breath / mute_music_under add up with the clip\'s own volume keyframes.',
      shape: {
        music_track: track().optional().describe('default the Music track (A3)'),
        key_track: track().optional().describe('default the Narration track (A1)'),
        clip_ids: z.array(z.string()).optional().describe('Only these music clips'),
        depth_db: z.number().optional().describe('default 15'),
        attack_ms: z.number().optional().describe('default 150'),
        release_ms: z.number().optional().describe('default 600'),
        threshold_db: z.number().optional().describe('Speech threshold, default -40'),
        hold_s: z.number().optional().describe('Bridge gaps shorter than attack + release + this, default 0.3'),
        remove: z.boolean().optional(),
      },
    },
    {
      name: 'breath',
      where: 'renderer',
      description: 'A breath: every audio track fades to near-silence at `at` (over fade_out_s before it), stays down for dur, then comes back over release_s. Use under chapter cards. remove: true with the same at removes it.',
      shape: {
        at: z.number(),
        dur: z.number().optional().describe('default 2.5'),
        fade_out_s: z.number().optional().describe('default 2'),
        release_s: z.number().optional().describe('default 1.5'),
        depth_db: z.number().optional().describe('default 40'),
        tracks: z.array(track()).optional().describe('default all audio tracks'),
        except: z.array(track()).optional(),
        remove: z.boolean().optional(),
      },
    },
    {
      name: 'mute_music_under',
      where: 'renderer',
      description: 'Take the music bed out while a raw clip with speech plays (fades down just before it, back up just after). Pass the clip, or start and end.',
      shape: {
        clip_id: z.string().optional(),
        start: z.number().optional(),
        end: z.number().optional(),
        fade_s: z.number().optional().describe('default 0.5'),
        depth_db: z.number().optional().describe('default 60'),
        music_track: track().optional(),
        remove: z.boolean().optional(),
      },
    },
    {
      name: 'fade',
      where: 'renderer',
      description: 'Fade clips in and out. curve "exp" (audio): even in loudness (linear in dB) instead of a linear gain ramp. For volume points use set_keyframes with property volume (volume_keys).',
      shape: {
        clip_id: z.string().optional(),
        clip_ids: z.array(z.string()).optional(),
        in_s: z.number().optional(),
        out_s: z.number().optional(),
        curve: z.enum(['linear', 'exp']).optional(),
      },
    },
    {
      name: 'beat_grid',
      where: 'renderer',
      description: 'Find the tempo, beats, downbeats and 4-bar phrases of the music clips on a track (or one clip), in timeline seconds. markers adds beat markers for one of them.',
      shape: {
        track: track().optional().describe('default the Music track'),
        clip_id: z.string().optional(),
        markers: z.enum(['none', 'beat', 'downbeat', 'phrase']).optional(),
        detail: z.enum(['full', 'summary']).optional(),
      },
    },
    {
      name: 'snap_to_beat',
      where: 'renderer',
      description:
        'Snap to the music: a clip edge moves (mode move) or its cut rolls (mode roll) to the nearest beat / downbeat / phrase of the music track. For a music clip with target: the music moves so one of its downbeats lands on target (e.g. a cut).',
      shape: {
        clip_id: z.string(),
        grid: z.enum(['beat', 'downbeat', 'phrase']).optional().describe('default downbeat'),
        edge: z.enum(['start', 'end']).optional(),
        mode: z.enum(['move', 'roll']).optional().describe('default move'),
        target: z.number().optional().describe('Music clip: timeline time a downbeat should land on'),
        music_clip_id: z.string().optional(),
        track: track().optional().describe('Music track, default Music'),
        max_shift: z.number().optional().describe('Seconds, default 0.75'),
      },
    },
    {
      name: 'ambience_fill',
      where: 'renderer',
      description: 'Keep the bed from going dead: fill the gaps on the ambience track with a looping ambience file (faded at each gap) at level_db, over the whole edit, a range, or only under recreation clips.',
      shape: {
        src: z.string().optional().describe('Ambience file or bin item (default: the one already used on that track)'),
        track: track().optional().describe('default an "Ambience" track, else SFX / Ambience (A4)'),
        level_db: z.number().optional().describe('default -40'),
        start: z.number().optional(),
        end: z.number().optional(),
        only_under: z.enum(['all', 'recreation']).optional(),
        fade_s: z.number().optional().describe('default 1'),
        min_gap: z.number().optional().describe('Gaps shorter than this stay empty, default 1'),
      },
    },
    {
      name: 'normalize',
      where: 'renderer',
      description: 'Set the loudness target that export applies: two passes (measure the whole mix, gain to target, true-peak limit), like loudnorm. off: true turns it off. Check the result with analyze_loudness, or the loudness that export_video returns.',
      shape: {
        target_lufs: z.number().optional().describe('default -14'),
        true_peak: z.number().optional().describe('dBTP, default -1'),
        off: z.boolean().optional(),
      },
    },
    // ---------- P3: check the cut ----------
    {
      name: 'detect_cuts',
      where: 'main',
      description:
        'Cut times of the edit (where the picture changes clip) plus cuts inside the source footage (scene detection), shot lengths, average and median shot length, and the longest holds (flagged unless marked deliberate).',
      shape: {
        threshold: z.number().optional().describe('Scene-change threshold 0-100 for cuts inside footage, default 10'),
        scan_sources: z.boolean().optional().describe('Also look for cuts inside the footage (default true)'),
        hold_s: z.number().optional().describe('Holds longer than this are listed, default 20'),
        start: z.number().optional(),
        end: z.number().optional(),
      },
    },
    {
      name: 'detect_freezes',
      where: 'main',
      description: 'Unintended still frames: frozen stretches inside the footage on screen (FFmpeg freezedetect), stills without motion, and black gaps, each at least min_s long and not marked as a deliberate hold.',
      shape: {
        min_s: z.number().optional().describe('default 10'),
        noise_db: z.number().optional().describe('Freeze noise tolerance, default -60'),
        start: z.number().optional(),
        end: z.number().optional(),
      },
    },
    {
      name: 'qa_report',
      where: 'main',
      description:
        'Run the checks on the whole cut and compare them with the documentary targets: hook by 0:30, climax at 45–70% of the runtime (markers named Hook / Climax), silences only under chapter cards and around raw clips, no unmarked hold over 20 s, no frozen frames, -14 LUFS / -1 dBTP, words per minute, and with script_path the narration against the script; with edl_path also check_edl. Returns pass / fail per check and the issues with their times.',
      shape: {
        script_path: z.string().optional(),
        edl_path: z.string().optional(),
        target_lufs: z.number().optional().describe('default -14'),
        true_peak: z.number().optional().describe('default -1'),
        hook_by_s: z.number().optional().describe('default 30'),
        climax_range: z.array(z.number()).optional().describe('[from, to] fraction of runtime, default [0.45, 0.7]'),
        max_hold_s: z.number().optional().describe('default 20'),
        skip: z.array(z.enum(['loudness', 'silences', 'cuts', 'freezes', 'transcript', 'edl'])).optional(),
      },
    },
    // ---------- P4: deliver ----------
    {
      name: 'export_chapters',
      where: 'main',
      description: 'YouTube chapter list ("0:00 Intro …") from the chapter markers, checked against YouTube\'s rules (starts at 0:00, at least 3, each at least 10 s). path also writes it to a text file.',
      shape: { path: z.string().optional(), intro_title: z.string().optional().describe('Title for 0:00 when no chapter starts there, default "Intro"') },
    },
    {
      name: 'export_credits',
      where: 'main',
      description: 'Source / music / art credits from the clips (the EDL credit column, add_clip credit) and the music files used, in order of first appearance, with times. path also writes them to a text file.',
      shape: { path: z.string().optional(), with_times: z.boolean().optional().describe('default true') },
    },
    {
      name: 'make_short',
      where: 'main',
      description:
        'Make a 9:16 promo Short from a range of the documentary as a NEW project file (the open project is not changed): 1080x1920, layout panel_top (the 16:9 picture as a panel near the top over a blurred copy, captions below) or center, word-by-word or line captions from the narration, optional title. Open the file to review it, then export with preset short_9x16.',
      shape: {
        start: z.number(),
        end: z.number(),
        layout: z.enum(['panel_top', 'center']).optional(),
        captions: z.enum(['word', 'line', 'none']).optional().describe('default word (needs Whisper)'),
        caption_track: track().optional().describe('Track to caption, default Narration'),
        title: z.string().optional(),
        path: z.string().optional().describe('Where to write the .icut (default next to the project)'),
      },
    },
    {
      name: 'snapshot',
      where: 'main',
      description: 'Save a named version of the whole project state (kept next to the app data, per project). restore brings one back as an undoable step.',
      shape: { label: z.string().optional() },
    },
    {
      name: 'restore',
      where: 'main',
      description: 'Bring back a snapshot (one undo step). Without id: list the snapshots of this project.',
      shape: { id: z.string().optional() },
    },
  ];
}
