// Tool definitions for documentary editing (see electron/docTools.mjs and src/docTools.ts). Kept apart from
// tools.mjs so the general editing tools stay readable.

export const DOC_INSTRUCTIONS = `
Documentary editing: project_template("doc") sets the tracks (V1 Footage · V2 Panels · V3 Adjustments · V4 Cards; A1 Clip audio · A2 Overlay audio · A3 Narration · A4 Music · A5 SFX / Ambience) and every tool also finds tracks by those names. Build from the plan files with import_edl (04_edl.csv) and import_cues (05_cues.csv), compare with check_edl, list with get_timeline. Polish with set_motion, jl_cut (or j_cut / l_cut), link_clips / unlink_clips, add_card (or add_text_card), add_panel; audio with duck_audio (or duck), breath, mute_music_under, fade, beat_grid / snap_to_beat, ambience_fill, normalize. Measure the program with analyze_loudness / detect_silence / detect_scenes and sequence: true; check the cut with qa_report (loudness, silences, cuts, frozen frames and narration pace against the targets) and capture_contact_sheet; deliver with export_video (presets, loudness_target), export_chapters, export_credits, make_short. snapshot before big changes, restore to go back. Every write tool takes dry_run.`;

/** @param {{ z: typeof import('zod').z, n: () => any, track: () => any, time: (w?: string) => any, TRANSITIONS: string[] }} h */
export function docTools({ z, track }) {
  const presets = ['chapter_card', 'date_card', 'quote_card', 'name_super', 'list_card'];
  const ids = () => z.array(z.string());
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
        'Build the timeline from the EDL CSV (04_edl.csv) in the documentary layout. Columns (the skill\'s Reference H): id, timeline_in, timeline_out, section, narration_line, visual_type, source_file_or_url, source_in, source_out, on_screen_text, motion, transition_in, clip_audio_db, music_cue, sfx, credit, deliberate_hold, notes (older names such as source still work). Times: seconds, m:ss, h:mm:ss or h:mm:ss:ff. visual_type: original_clip, interview, recreation, era_broll, gameplay → V1 Footage (its sound on A1); photo, illustration → V1 still with its motion; artifact → V2 panel (screenshot / document / screen recording); card → a text card on V4 over a blurred, darkened V3 adjustment layer (over the row\'s source if it has one, else black). source_file_or_url: a file relative to the CSV (imported if needed) or a bin item; URLs are reported (download them first). on_screen_text: "main | subtitle", optionally "chapter: …" / "date: …" / "quote: …" / "name: …" / "list: …"; on a card row the kind is guessed (quote marks → quote, a year or date → date, ; separated → list, else chapter — a chapter card adds a chapter marker); on other rows it is a lower-third super. motion: none, push_in_3pct, slow_scroll, pan. transition_in: cut, dissolve_0.5s, dip_to_black_0.5s, j_cut (this shot\'s sound starts 10 frames early), l_cut (the previous shot\'s sound runs 10 frames into this one). clip_audio_db: a number puts the clip sound on A1 at that gain; empty or "mute" leaves it off. sfx: a file (optionally file.wav@-6) on A5. deliberate_hold marks the row as a hold for qa_report; credit feeds export_credits. Re-importing replaces the clips of the same row ids. Returns the clips made per row and every row it could not place, with the reason.',
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
        'Place the sound plan from the cue CSV (05_cues.csv). Columns (the skill\'s Reference H): cue_id, timeline_in, timeline_out, type, track_title, source_and_licence, function, level_vs_narration_db, entry, exit, notes. type: music → A4 Music (another Music track when cues overlap), sfx / ambience → A5, clip_audio → sets the level of the clip sound (A1) in that range and takes the music out under it, silence → music and SFX fade to near-silence there. The file: track_title or source_and_licence when it names a file (relative to the CSV), else the media file in the CSV\'s folder (or below it) whose name matches track_title. level_vs_narration_db: the cue\'s loudness relative to the narration on A3, measured (−15 = 15 dB under the voice; clip_audio 0 = as loud as the narration). entry / exit: hard_on_downbeat (starts on the music\'s next downbeat), fade_0.5s / fade_1s / fade_2s, cut_on_phrase (ends on a phrase boundary), j_cut / l_cut (clip_audio). source_and_licence is kept as the credit. Re-importing replaces the same cue ids. Reports every row it could not place, and why.',
      shape: {
        path: z.string().describe('The CSV file'),
        duck: z.boolean().optional().describe('Music cues duck under the narration: the bed sits level_vs_narration_db under the voice while it speaks and rises to the narration level in the gaps (duck_audio with depth = -level). Default false: a steady bed'),
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
      description: 'Set up the documentary track layout: V1 Footage, V2 Panels, V3 Adjustments (blur / darken behind cards), V4 Cards; A1 Clip audio (the footage\'s own sound), A2 Overlay audio, A3 Narration, A4 Music, A5 SFX / Ambience (names tracks, adds missing ones, keeps clips). A project already set up with the 0.2.33 layout (A1 Narration) keeps it.',
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
      name: 'jl_cut',
      where: 'renderer',
      description:
        "J- or L-cut a clip's linked sound without unlinking it: audio_lead = seconds the sound starts before its picture (J), audio_tail = seconds it runs past the picture's end (L). Values snap to whole frames; 0 lines that edge up again; leave one out to keep that edge. Sound it overlaps on its track is trimmed back. Returns the offsets in seconds and frames.",
      shape: {
        clip_id: z.string().describe('The video clip (or its linked audio)'),
        audio_lead: z.number().optional().describe('Seconds, e.g. 0.33 (Reference F: 6–15 frames)'),
        audio_tail: z.number().optional().describe('Seconds'),
      },
    },
    {
      name: 'link_clips',
      where: 'renderer',
      description: 'Link clips (e.g. a picture and its separately placed sound) so they move, trim and split together.',
      shape: { clip_ids: ids().describe('Two or more clips') },
    },
    {
      name: 'unlink_clips',
      where: 'renderer',
      description: 'Unlink clips from their linked partners so they move and trim on their own.',
      shape: { clip_ids: ids() },
    },
    {
      name: 'add_card',
      where: 'main',
      description:
        'A text card in one undo step: the text (with fades) on the Cards track, over a blurred and darkened adjustment layer (backdrop blur) or a black matte (black) underneath it, or no backdrop (none). kind: chapter (adds a chapter marker), date, quote, name (a lower third, default backdrop none), list (items separated by ; or new lines). text "main | subtitle" adds the small line (chapter number, the date\'s place, the quote\'s attribution, the name\'s role, the list\'s heading). Style from style_path (JSON or Markdown: font, text colour, accent, card blur, card darken), else FraggedIn/style.md near the project, else the add_text defaults.',
      shape: {
        kind: z.enum(['chapter', 'date', 'quote', 'name', 'list']),
        text: z.string(),
        start: z.number().describe('Timeline start (s)'),
        duration: z.number().optional().describe('Seconds, default 4 (name 3)'),
        backdrop: z.enum(['blur', 'black', 'none']).optional().describe('default blur (name: none)'),
        style_path: z.string().optional().describe('A .json or .md style file'),
      },
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
      name: 'duck_audio',
      where: 'renderer',
      description:
        'Sidechain-style ducking written as volume keyframes (so it stays editable): wherever the key tracks have sound above threshold_db (read from their waveform), the target clips go down by depth_db, ramping over attack before and release after, held for hold after the sound stops; gaps shorter than attack + release + hold stay down so the bed does not pump. Re-running replaces the earlier ducking on those clips. Returns the keyframes written per clip.',
      shape: {
        target_tracks: z.array(track()).optional().describe('Tracks to duck, default ["A4"] (Music)'),
        key_tracks: z.array(track()).optional().describe('Tracks that trigger it, default ["A3"] (Narration)'),
        depth_db: z.number().optional().describe('default 15'),
        threshold_db: z.number().optional().describe('default -40'),
        attack: z.number().optional().describe('Seconds, default 0.15'),
        release: z.number().optional().describe('Seconds, default 0.6'),
        hold: z.number().optional().describe('Seconds, default 0.2'),
      },
    },
    {
      name: 'duck',
      where: 'renderer',
      description:
        'Duck the music under the narration: volume keyframes on the music clips go down by depth_db wherever the key track has speech (found from its waveform), attack before and release after, short gaps bridged so it does not pump. Re-running replaces the earlier ducking; remove: true takes it off. Envelopes from duck / breath / mute_music_under add up with the clip\'s own volume keyframes.',
      shape: {
        music_track: track().optional().describe('default the Music track (A4)'),
        key_track: track().optional().describe('default the Narration track (A3)'),
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
        'Measure the whole cut (sequence loudness, silences, scenes and holds, frozen or still frames, narration words per minute from transcribing A3 Narration) and compare it with the skill\'s Reference I targets: hook by 0:30 and climax at 45–70% of the runtime (markers named Hook / Climax, or of those kinds), −14 ±1 LUFS with true peak ≤ −1 dBTP, no unmarked hold over 20 s, silences only near chapter markers / chapter cards or marked holds; with script_path the narration against the script, with edl_path also check_edl. targets overrides any of them. Returns pass / fail per check and the issues with their timestamps.',
      shape: {
        targets: z
          .object({
            hook_by_s: z.number(),
            climax_range: z.array(z.number()).describe('[from, to] fraction of runtime'),
            lufs: z.number(),
            lufs_tolerance: z.number(),
            true_peak: z.number(),
            max_hold_s: z.number(),
            silence_near_s: z.number().describe('How close to a chapter marker / hold a silence may be, default 3'),
            wpm: z.array(z.number()).describe('[min, max] narration words per minute, default [130, 190]'),
            still_s: z.number().describe('Still / frozen picture longer than this is flagged, default 10'),
          })
          .partial()
          .optional(),
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
