---
name: fraggedin-documentary-editor
description: Use when Ben asks to plan, script, edit or review a FraggedIn gaming documentary (8–12 min) or any gaming video essay — scandal, glitch, esports, community drama — to build in IngrainedCut: hooks, real footage, pacing, music, sound, graphics.
---

# FraggedIn Documentary Editor

Turns a gaming story (a scandal, glitch, esports incident, community drama, a record, a forgotten piece of history) into a finished 8–12 minute documentary for Ben's FraggedIn channel, assembled in IngrainedCut through its `ingrainedcut` MCP tools.

Everything here comes from a study of three gaming documentaries that worked (1.8–4.7M views each): full transcripts with timings, frames sampled every 10 s throughout and every second in key sections, and loudness measured second by second while they played. The numbers in the references are measurements, not guesses:

| ID | Video | Length | What it teaches |
|---|---|---|---|
| V1 | Greylin — *The Apex Legends Tournament That Got Hacked Live* (Short, 2026) | 0:29 vertical | Premise in one sentence, relentless visual change, twist ending |
| V2 | Will Miss It — *The Falador Massacre \| RuneScape Documentary* (2022) | 60:27, 7 chapters | Character-driven chronicle, archival authenticity, game OST, humour, open loops |
| V3 | Wirtual — *The Biggest Cheating Scandal in Trackmania History* (2021) | 20:29 | Investigation structure, evidence on screen, letting the raw clip play, credibility |

The style FraggedIn is after: **real footage over decoration, story over facts, sound that moves with the edit, graphics so plain nobody notices them.**

## Contents
1. What to deliver
2. Workflow, stage by stage
3. Assembling in IngrainedCut
4. Reference A — The three model documentaries, timestamped
5. Reference B — Hooks
6. Reference C — Script and retention devices
7. Reference D — Footage: sourcing order and visual vocabulary
8. Reference E — Pacing numbers
9. Reference F — Music, sound and transitions
10. Reference G — Graphics that don't look AI-made
11. Reference H — Templates (beat sheet, EDL, cue sheet)
12. Reference I — QA checklist before export

---

## 1. What to deliver

Keep one project folder per video (in Ben's connected FraggedIn folder if there is one, otherwise the workspace, sent to him at the end):

| File | Contents |
|---|---|
| `01_research.md` | Fact log: every claim with its source link/date and confidence; exact quotes with clip timecodes; open questions |
| `02_beats.md` | Logline, spine, beat sheet with a time budget (Reference H) |
| `03_script.md` | Narration with `[CLIP]` `[BEAT]` `[CARD]` `[MUSIC]` `[SFX]` markers, word count, estimated runtime |
| `04_edl.csv` | Edit decision list — one row per shot (Reference H) |
| `05_cues.csv` | Music and sound cue sheet (Reference H) |
| `06_graphics.md` | Every on-screen text/graphic, its wording, style and duration |
| `07_qa.md` | Checklist results and fixes (Reference I) |
| `08_publish.md` | Title options, description with chapters, sources and credits |
| `<slug>.icut` | The IngrainedCut project, saved after every build pass |

Show Ben the beat sheet and the script before building the timeline — they are cheap to change, a cut is not.

Partial requests are normal: if Ben asks only for a hook, a script, a music plan or a review of a cut, do that stage with its reference and skip the rest. For a review, measure the cut (Reference I) and answer with timestamps and concrete fixes.

Keep one channel-wide `FraggedIn/style.md` next to the projects: typeface, accent colour, card layouts, signature sting, preferred music sources and licences. Create it on the first project (ask Ben once, or propose one following Reference G) and reuse it, so every video looks like the same channel.

## 2. Workflow

### Stage 0 — Intake
Settle these before research, asking at most two questions and taking the default for the rest:
- Topic and angle (what the video argues or reveals). No default — this one has to come from Ben or be proposed as 2–3 options.
- Runtime: default 10:00 (range 8–12).
- Narration: default is Ben recording the script himself; ask if it isn't clear.
- Footage on hand: Ben's own captures, VODs, folders. Look in the connected folders before asking.
- Music: default is a licensed library bed plus the game's own soundtrack where the publisher's video policy allows it.

### Stage 1 — Research and evidence log
- Go to primary sources first: original recordings, VODs, patch notes, official posts, archived forum threads (Wayback Machine), leaderboards, court/tournament rulings, the people involved. Use secondary coverage to find leads, and show it on screen when you cite it (V2 puts an earlier explainer video on screen while summarising the community's theories, 19:00).
- Log every fact with its source and date. Never invent a quote or fill a gap with a plausible detail — say it's unknown on screen (V2 32:41 and V3 11:23 both openly admit what isn't known, and it reads as trustworthy rather than weak).
- Find the **money footage**: the 1–3 authentic clips that prove or embody the story (V1: the pro reacting mid-match; V2: the original 2006 massacre recordings; V3: the input displays and the accused's own stream). Build the structure around them.
- Let IngrainedCut do the heavy reading of long sources: `import_media` the VODs and interviews, `transcribe` them to pull exact quotes with timecodes for `01_research.md`, and skim them with `capture_contact_sheet` (pass `media_id`) and `detect_scenes` to find the money moments without watching hours of footage.
- Find **what's new**: an interview, a document, a dataset, a timeline nobody assembled. V2 opens by admitting the event is the most documented in the game's history and then promises the full story from months of work with the developer (V2 0:55–1:39). If there is nothing new, choose a sharper angle (one person's view, the consequences, the mechanism).
- Decide the naming policy for real people (V3 2:02: real gamertags, plus an explicit don't-harass request) and how to handle sensitive words (V2 55:38 explains the developer's care about the word "massacre").

### Stage 2 — Story
1. Write the logline: *who* did *what* in *which game*, and *what it cost*.
2. Pick a spine:
   - **Chronicle** (V2): protagonist(s) → rising stakes → the event in present tense → emergency response → aftermath and legacy.
   - **Investigation** (V3): universal claim → rules of the world → discovery → alternative explanations ruled out → method → evidence → corroboration → verdict → escalation of scale → the accused's response → resolution.
   - **Incident** (V1, for tight topics or Shorts cut from the doc): premise → beat-by-beat → twist.
3. Fill the beat sheet with the time budget in Reference H. Two rules matter most:
   - Explain mechanics only after the viewer cares — after the inciting incident, never in the opening (V2 puts the bug explanation at 18:41, after the party has already gone wrong).
   - Land the climax or verdict between ~45% and 70% of runtime (V3's verdict at 49%, V2's raw climax footage at 61%) and give the aftermath real time (V2's aftermath is ~25% of runtime, V3's response section ~24%).
4. Plan 2–3 open loops and where each pays off (Reference C).

### Stage 3 — Script
- Write for the ear: short sentences, concrete numbers, names, dates. The long docs carry 170–180 words per minute of runtime (V2: 10,300 words in 60 min; V3: 3,700 in 20 min); the Short runs ~215. For FraggedIn, plan ~170 wpm of narration plus 60–90 s of raw clips, music beats and cards per 10 minutes: about 1,500 words for 10:00, 1,200–1,800 across the 8–12 min range.
- Give the viewer a new question, turn or payoff at least every 45–90 seconds.
- Mark what isn't narration: `[CLIP: source, in–out, what is said]`, `[BEAT 1s]` (deliberate silence), `[CARD: text]`, `[MUSIC: cue id]`, `[SFX: what]`.
- Run the device list in Reference C and the hook checks in Reference B before showing Ben.

### Stage 4 — Footage plan
- For every line of script, decide what is on screen, following the sourcing order in Reference D. Something relevant to the sentence should be on screen; generic "gameplay wallpaper" is the fallback, not the plan.
- Write a capture list for anything Ben has to record himself: in-game recreations (location, camera, time of day, length, settings), screen recordings of web pages and leaderboards (slow scroll, 1080p+), replays.
- Keep a credits list as you go.

### Stage 5 — Edit decision list
Fill `04_edl.csv` (Reference H) using the pacing targets in Reference E. Mark the deliberate long holds (raw clips, chapter cards) so QA doesn't flag them.

### Stage 6 — Music and sound
Fill `05_cues.csv` using Reference F: one music cue per section, changes on structural boundaries, silence before the big clip, the clip's own audio carrying its moment.

### Stage 7 — Graphics
List every text element in `06_graphics.md` using the rules in Reference G. Count them — fewer is better.

### Stage 8 — Assemble in IngrainedCut
See section 3.

### Stage 9 — QA and publish
Run Reference I on a full draft render, fix, render the final, then write `08_publish.md`: 3 title options, a description with chapters (V2 lists its chapters with timestamps), every source link, music and art credits (V2 credits its OST source and outro artist, V3 credits its editors and links the full report and replay playlists so viewers can check the evidence).

Offer one 30–45 s vertical Short cut from the finished doc using the V1 template (premise in the first sentence, beat-by-beat, twist last) — it is the cheapest promotion the documentary can get.

---

## 3. Assembling in IngrainedCut

IngrainedCut is Ben's Premiere-style editor. Its MCP server (`ingrainedcut`, installed in `~/.ingrainedcut/mcp-server` on his Windows PC) edits the open project live while Ben watches the timeline. It reaches the running app through `~/.ingrainedcut/bridge.json`, so the app has to be open.

### Connect
- Tool names carry a client prefix (`mcp__ingrainedcut__add_clip` in Claude Code; something like `mcp__remote-devices__<server>__add_clip` when a cloud session is linked to Ben's PC). Match on the part after the last `__`; if tools are deferred, search for `get_project_state`.
- Start with `get_project_state` (`detail: "summary"`). If it answers that IngrainedCut is not running, ask Ben to open the app and retry. If there are no IngrainedCut tools at all, the server isn't connected to this conversation: say so in one line and deliver the EDL and cue sheet as a manual assembly pack.
- IngrainedCut only imports files that are on Ben's PC. Keep all media in the project folder there and pass absolute Windows paths to `import_media`. In a cloud session, write anything you made (cards, renders, audio) into his connected folder first.
- Server conventions: times in seconds; V1 is the bottom video layer; clip ids look like `c12`, media ids like `m3`; a video clip and its audio are linked and move, trim and split together. Every call is one undo step: group a pass with `batch`, use `undo` when a step goes wrong, and `save_project` after every pass.
- If Ben asks you to take prompts from IngrainedCut's chat panel, follow the server's `wait_for_prompt` → edit → `send_reply` loop and keep applying this skill to every request that arrives there.

### Tool map
| Job | Tools |
|---|---|
| Read the edit | `get_project_state` (summary or full) |
| Sequence and tracks | `set_sequence_settings`, `manage_tracks` (add/remove; mute, solo, lock, track `volume_db`) |
| Media | `import_media`, `relink_media` |
| Place, move, trim | `add_clip` (media_id, start, track, audio_track, source_in/out, include_audio/include_video, overwrite or insert), `move_clip`, `trim_clip`, `split_clip`, `delete_clips`, `ripple_delete_range(s)`, `close_gaps` |
| Look, motion, level | `set_clip_properties` (volume_db, fade_in/out, transform, crop, effects incl. blur, color_grade, look, text style), `set_keyframes` (x, y, scale, rotation, opacity, volume in dB), `auto_color` |
| Transitions | `add_transition` (cross-dissolve, dip-to-black, dip-to-white, wipes, slides, push, zoom-in, blur-dissolve), `remove_transition` |
| Text and graphics | `add_text`, `add_color_matte`, `add_adjustment_layer`, `add_captions`, `render_composition` (HyperFrames HTML compositions) |
| Navigate, show Ben | `markers`, `set_playhead` (also sets export in/out), `select_clips`, `screenshot_editor` |
| Analyse | `transcribe`, `detect_silence`, `detect_scenes`, `analyze_loudness` (media items only), `capture_frame`, `capture_contact_sheet` (up to 30 frames) |
| Output | `export_video`, `save_project` |

### Track layout
`add_clip` puts a video clip's linked audio on the audio track with the same number, and audio-only media defaults to A1, so the layout follows that rule:
- V1 footage (its sound lands on A1) · V2 evidence panels and overlays (sound, if any, on A2) · V3 adjustment layers that blur and darken the footage behind cards · V4 text and cards · captions on their own top track (`add_captions` creates it).
- A1 clip audio · A2 overlay audio · A3 narration · A4 music · A5 SFX and ambience. Always pass `track` for narration, music and SFX.

### Build in passes
Run `get_project_state` and `save_project` after each pass.
1. **Setup** — `set_sequence_settings` (1920×1080, the frame rate of most of the footage, the video's name); `manage_tracks` to add tracks until V1–V4 and A1–A5 exist; `import_media` everything in the EDL and cue sheet and keep the media ids; first `save_project` with a path in the project folder (`<slug>.icut`).
2. **Radio edit** — narration takes on A3 in script order; each `[CLIP]` placed with its picture on V1 at its EDL time (its sound lands on A1); leave the `[BEAT]` gaps. Check the runtime (8–12 min) before anything else and trim script, not beats. To tighten Ben's takes, run `detect_silence` on the narration clips and cut only the overlong pauses with `trim_clip` or `ripple_delete_ranges`. Don't use `remove_silence` once picture is laid: it ripple-deletes across every track and eats deliberate beats.
3. **Picture** — EDL rows in order with `add_clip` (source in/out, start, V1 or V2) inside `batch` calls. Screenshots and documents go on V2, sized with `set_clip_properties` transform (scale 70–85 over related footage, or full frame) and moved with `set_keyframes` on `scale` 100→104 with `ease` across the shot, or on `y` for a slow scroll. Transitions: plain cuts by default, `cross-dissolve` 0.5 s into documents, `dip-to-black` 0.5 s into chapter cards. Leave archival footage ungraded (no `look` on originals); `auto_color` is only a starting point for Ben's own recreations.
4. **Music** — cues on A4 with `fade_in`/`fade_out`. Set the bed by numbers rather than by ear: run `analyze_loudness` on the narration media and on each music file, then `volume_db = (narration LUFS − music LUFS) − 15` puts the bed about 15 dB under the voice. IngrainedCut has no sidechain ducking, so shape the bed with `set_keyframes` on `volume` (0.3–0.5 s ramps): up to the narration's level in narration-free windows such as the title moment (`(narration − music) + 0`), 4–6 dB above it for spectacle footage without speech (`+4` to `+6`), down to −60 dB under raw clips with speech, and a 1–3 s fade to near-silence into every chapter card, with the next cue starting after the card.
5. **Sound** — SFX (sounds from the game itself) on A5; ambience under recreations at a low level. J/L-cuts: place picture and sound separately (`add_clip` with `include_audio: false`, then again with `include_video: false` on the clip-audio track), starting the sound 0.25–0.5 s before its picture for a J-cut or running it past the cut for an L-cut. Match raw-clip dialogue to the narration: `analyze_loudness` on the clip's media, then set its `volume_db` to `narration LUFS − clip LUFS`.
6. **Graphics** — cards with `add_text` on V4 using the style sheet (`font`, `size`, `color`, `bold`, `stroke_color`/`stroke_width`, `shadow`, `align`) and 0.3–0.5 s `fade_in`/`fade_out`. Blurred, darkened backdrop: `add_adjustment_layer` on V3 for the card's duration with effects `{blur: 12–20, brightness: -30}`; cards on black: `add_color_matte` in black. Name and date supers: `add_text` with a `transform` y offset into the lower third. Put a `markers` entry (name = chapter title) on every chapter card. Captions only for raw clips with unclear speech: `transcribe` the clip, then `add_captions` with a plain style. The one data graphic, if the story needs it: `render_composition` of a HyperFrames composition as transparent `webm`, kept to Reference G's look.
7. **Review** — run Reference I, fix from the list, then export.

Final export: `export_video` with `format: "mp4-h264"`, `quality` 16–18, `sample_rate` 48000, `audio_kbps` 320, at the sequence resolution (or `height: 2160` for a 4K upload, which YouTube encodes at a higher bitrate).

Short: `save_project` to a new path first, then `set_sequence_settings` 1080×1920 and build the Short in that copy (V1 template).

---

## Reference A — The three model documentaries

### A1. V1 — Greylin, Apex tournament hack (Short, 0:29, ~104 words ≈ 215 wpm)
- 0:00–0:03 The entire premise in one sentence: a hacker forced cheats onto two pros in the middle of a live tournament. No intro, no context first.
- 0:03–0:13 Player one: when and what (wallhack), what he did (hands off the controller, told his team, left).
- 0:13–0:19 Player two: the aimbot, his reaction.
- 0:19–0:24 Consequence: the match abandoned, the finals postponed.
- 0:24–0:29 Kicker: the hacker's name and his claim he did it for fun. The twist is saved for the last line.
- Visual: unrelated parkour gameplay fills the whole frame as filler; a 16:9 story panel sits in the upper third; one bold white caption word at a time mid-screen. The panel changes every 1–2 s: streamer facecam reactions, the tournament broadcast, the in-game leave-match prompt, aimbot footage, the official announcement and news screenshots — padded with a stock hooded-hacker image and meme reaction faces.
- Lesson for FraggedIn: this is the density of a cold open, and the template for Shorts cut from each documentary. Its strongest beats are the real ones (the pro's reaction, the prompt, the official post); the stock and meme images are filler that FraggedIn replaces with real artifacts. It is not the look for the long-form doc.

### A2. V2 — Will Miss It, The Falador Massacre (60:27; chapters 0:00 · 2:21 · 12:41 · 18:41 · 25:40 · 41:11 · 45:15)
- 0:00–0:10 Black screen with one small line of text while sound plays — the loudest stretch of the whole film is this cold open (0:20–0:35).
- 0:10–0:33 Cold open built from *other people's voices*: a developer describing the first report, a player reacting, the event named — cut in 1–4 s shots alternating original 2006 footage and interview clips. The narrator's first line comes at about 0:34; the date card fades in over an aerial game shot at 0:37.
- 0:34–1:49 The narrator admits the event is famous and already covered everywhere, then gives the reason to watch anyway: new information from months working with the developer. Ends on a game-flavoured "get ready" line.
- 1:49–2:34 ~45 s with no narration: music-led title sequence and the title card.
- 2:34 Chapter 1 opens like a fairy tale about a 12-year-old in New Zealand: a person first, the game second. A recurring hand-drawn cartoon of the kid at his PC stands in for real-life moments no footage exists for (3:00, 5:00, 8:20, 10:40, 30:20).
- Dense, specific numbers throughout (the 254th player ever to max Magic, the real-money value of the gold he sold, exp totals of his rivals) — specificity is the authority.
- Humour as retention: a running "foreshadowing" gag that gets cut off earlier each time (11:17, 12:03, 13:53); the subscribe request smuggled into the story as a joke (12:20); a meme screenshot about maps leaving out New Zealand (13:00).
- 12:41 Chapter 2 settles a disputed fact (which day it happened, across time zones) with a primary source: the timestamp of the party invitation post.
- 14:42–14:58 Delayed reveal of the second protagonist: his real first name first, the infamous username last.
- ~17:55–18:05 and ~29:48–30:00 Narration stops for 10–12 s while the moment plays (the crowd being kicked out; the host's ban).
- 18:41 Chapter 3 (the bug) only after the party has gone wrong. 19:41 the narrator tells viewers to remember a developer's name because he comes back later — paid off at 43:11 with a hero introduction. 23:31 warns that it's about to get technical; 25:06 recaps the mechanism in one sentence; 25:22 explicitly leaves the technical part for the carnage.
- 25:40 Chapter 4 switches to present tense for the event itself. Mix of modern in-engine recreations and the original 2006 recordings (original chat box, right-click menus with the killer's name), a plain yellow circle to pick him out of a crowd (32:20), webcam-style interviews with former staff (27:20, 29:40).
- 36:03–36:39 Sets up the footage as some of the most infamous ever uploaded, then 36:39–37:05 lets ~26 s of the original 2006 recordings play without narration — several different players' recordings cut together in 3–8 s shots, no text — while the music swells to the film's second-loudest point with about 9 dB more bass.
- 39:44 / 40:13 The climax ends on a physical image (the "train" stopping, the character turning to dust), not a summary.
- 41:11 Chapter 5 card over a real photo of the developer's office; 2000s office archive footage for the night shift (42:00–44:40). 43:11–43:30 the payoff of the developer's introduction gets ~13 s without narration.
- 44:49 Rule-of-three closer for the night, then a one-line resolution.
- 45:15 Aftermath: a late emotional twist (a friend betrays the killer over the stolen item, 46:26), the origin of the event's name, consequences, an empathy line to the viewer (51:38), a fake-out ending that keeps going (53:43), responsible handling of the word "massacre" (55:38), and the trivia payoff about the song everyone associates with the footage (56:41).
- 58:53 Final beat is an irony that doubles as the theme (the original bug was never actually found, only walled off), then a short sign-off; credits on black; commissioned outro art.
- Music: the whole score is the game's own soundtrack, credited in the description.

### A3. V3 — Wirtual, Trackmania cheating scandal (20:29)
- 0:00–0:09 A universal thesis about cheaters in every competition over one slow, wide establishing shot (~9 s hold).
- 0:09–0:17 The picture wakes up: rapid gameplay, a new angle about every second.
- 0:14–0:36 Onboarding for people who've never played: what the game is, the goal, leaderboards, hundredths of a second.
- 0:44–1:34 Community naivety, then the stakes: the biggest suspected cheating case in the game's history, months of investigation, thousands of replays, results final.
- 1:34–2:14 Ethics and credibility: read the full report, not about drama, opinions are his own, real gamertags, do not contact the players — as white text cards over blurred gameplay.
- 2:14–4:01 The rules of the world (replay files store inputs; deterministic physics) with a concrete example.
- 4:01 Inciting incident and the accused's name ~4 minutes in. 4:21–5:23 Every innocent explanation tested and ruled out before the cheating hypothesis (5:34).
- 6:16 Says he'll skip most technical detail and points to the report. 6:20 chapter card on black (~7 s). 6:38–6:53 one minimal white-on-black line graph explaining the metric.
- 7:39 Hard numbers (record count, average metric). 7:55 The decisive contrast: offline runs vs runs on stream.
- 8:45–9:39 Corroboration: other top players confess to the same method. 9:39–10:08 The verdict, at ~49% of runtime.
- 10:08–11:08 Escalation of scale across games and years; 11:08 invites viewers to check the data themselves (playlists linked).
- 11:16 The motive question, answered with an outside expert's well-known line on a quote card over that creator's channel page (11:40).
- 12:10 "The Livestream" chapter card (~4 s); 12:22 flags that the next part is his personal response, not the investigation.
- 13:41–14:19 The accused's own stream plays **uncut for ~38 s**, full screen with chat, framed by ~1 s near-silence on both sides. 14:22 he admits his own message could have been better worded; 14:26 a real photo of the two of them together shows they were friends.
- 15:14 Reframe: hundreds of instances across a decade, not a teenage mistake. 17:04–18:19 his own track record against cheating (credibility).
- 18:26–19:55 Resolution: what the community must accept, read the report, credit and support the investigator, future videos will celebrate legitimate players. 20:08 short music outro.
- Visual vocabulary: gameplay with an input-display overlay (the core evidence image), screen captures of real artifacts (report pages, leaderboards, Windows Explorer's Replays folder, in-game menus, Discord DMs, the Twitch VOD), real photos, plain text cards. One graph, one timeline, no flashy templates.

### A4. What all three share
1. The opening states the most extreme true fact, fast (V1 in 3 s; V2 names the event in its first spoken line at 0:10; V3 states the scale of the scandal by 1:25).
2. Authentic material is the spine; illustration and recreation only fill gaps where no footage can exist.
3. The best real clip is given room — 26–38 s with no narration in the long docs.
4. Mechanics are explained just in time, signposted, and recapped in one sentence.
5. The narrator is a trustworthy person: admits unknowns, separates fact from opinion, owns mistakes.
6. The ending lands on a theme or twist, then gets out within ~30 s.

---

## Reference B — Hooks (first 30–60 s of an 8–12 min doc)

By 0:30 the viewer must know **what happened (or the central question), how big it is, and why this video**; by 1:00 a non-player must know what the game is.

Pick one shape:
- **The one-sentence premise** (V1): open on the money clip with one sentence stating the most extreme true fact. Next line: when and where. Hold the twist for later.
- **Voices from the day** (V2): 15–30 s of real quotes from people involved (clips, VOD audio, interview lines) over the most striking footage, then the narrator names the event and promises what's new.
- **Universal thesis** (V3): one sentence about human nature or competition over a slow establishing shot, then a hard cut into energy and the specific case. Good when the game is niche.

Then, before 1:00:
- One line of onboarding for non-players (what the game is, what "winning" means there).
- The scale (first/biggest/only, a number, a date).
- The reason to trust this telling (new source, primary evidence, inside access).
- A title card of no more than 3–5 s, or a short music-led title moment (V2 uses ~45 s, but that only works at 60 min — keep it under 10 s at 8–12 min).

Hook failures to avoid: starting with "In this video…", channel intros, a minute of background before the event, explaining mechanics first, a generic montage with no claim over it.

---

## Reference C — Script and retention devices

Use 6–10 of these per video, matched to the story. Timestamps point to the model use.
- **Open loop with a named payoff** — tell viewers a person or detail will matter later; pay it off on screen (V2 19:41 → 43:11).
- **Delayed name reveal** — introduce the person by their real-life identity, reveal the infamous handle last (V2 14:42–14:58).
- **Running gag** that escalates or gets cut shorter each time (V2 11:17 / 12:03 / 13:53). One per video.
- **Signpost → recap → exit** around technical sections (V2 23:31 / 25:06 / 25:22; V3 6:16 pointing to the report).
- **Present tense for the climax** (V2 25:42).
- **Rhetorical question chain** to voice what the audience is wondering (V2 9:25; V3 11:16).
- **Admit unknowns** plainly (V2 32:41; V3 11:23).
- **Rule out the innocent explanations** before the accusation (V3 4:21–5:23).
- **Corroboration** from independent sources or confessions (V3 8:45).
- **Outside voice** — an expert or respected creator's view, credited on screen (V3 11:28).
- **Fact vs opinion label** before a personal section (V3 12:22).
- **Own the narrator's mistake** (V3 14:22).
- **Empathy line** putting the viewer in a victim's place (V2 51:38).
- **Rule of three** for an emotional close (V2 44:49).
- **False ending** that keeps going (V2 53:43).
- **Subscribe ask hidden in the story** as a joke, never as a separate segment (V2 12:20).
- **Closing irony / theme line** that recasts the whole story (V2 58:53).
- **Responsible framing** when the topic touches real harm or real people (V2 55:38; V3 2:02).

Pacing of turns: if 90 s pass without a new question, reveal, number or joke, add one or cut the passage.

---

## Reference D — Footage: sourcing order and visual vocabulary

Use the highest level available for each line:
1. **Original recordings of the event** — VODs, clips, stream captures, original-era videos with their UI and chat intact (V2's 2006 recordings, V3's stream VOD). Keep their original audio available.
2. **Primary artifacts on screen** — the forum post, tweet, patch note, leaderboard, report page, DM, ban message, news article, file folder. Record them as real screen captures with a slow scroll or gentle push (≤5% zoom over the shot), shown either full screen or as a panel floating over related gameplay (V3 0:53, 1:09).
3. **Interviews** with people involved (V2's webcam-style interviews with former staff, 27:20 and 29:40), and real photos of people and places (V3 14:26; V2 41:20).
4. **In-game recreation** of what happened, captured by Ben in the actual game: same location, plausible gear, cinematic but restrained camera (V2's recreations throughout chapters 3–4; V3 replaying the actual runs with an input display).
5. **Era b-roll** — period office footage, events, hardware from the time (V2 42:00–44:40).
6. **Hand-made illustration** only for moments no footage can exist for (a person's bedroom in 2002), with one consistent character design reused each time (V2's cartoon). Commission or draw it; don't generate it.
7. **Generic gameplay** of the same game as the last resort.

Rules of use:
- The image under a sentence should be about that sentence. If the line names a person, show that person (photo, avatar, clip). If it names a number, show where the number comes from.
- Point at things with the simplest mark possible — one circle or underline (V2 32:20), not arrows and emoji.
- Explain abstract mechanics *inside the game world* when possible (V2 puts labels and numbers over characters' heads and on in-world signs, 20:20 and 24:20) rather than with abstract motion graphics.
- Credit borrowed footage on screen (small source line) and in the description. Use short excerpts with commentary, not long re-uploads, and check the publisher's video policy for game footage and music.
- Raw clips with hard-to-hear speech get plain subtitles.

---

## Reference E — Pacing numbers

Measured:
- Words per minute of runtime: V2 171, V3 180, V1 ~215.
- Opening rhythm in V3: one ~9 s establishing hold, then a new shot about every second for ~8 s, then evidence panels held 5–9 s. V2's cold open cuts every 1–4 s.
- V1 changes its story panel every 1–2 s for its whole 29 s.
- Deliberate no-narration windows in V2: ~45 s title sequence, 10–13 s pauses at three key moments, ~26 s of archival footage at the climax. V3: the accused's clip uncut for ~38 s.
- Chapter cards held ~4–7 s (V3 6:20, 12:10). Still screenshots held up to ~10 s (V3 12:50), always while narration explains them.
- Only ~5% of V3's runtime is a fully still image, and only 0.6% of V2's (just the end credits): screenshots and documents get a slow push or pan, so something is always moving.

Targets for an 8–12 minute FraggedIn doc:
- Narration: ~170 wpm; 1,200–1,800 words total (≈1,500 for 10:00).
- Shots: 2–5 s typical; 1–2 s bursts only for the cold open and the climax build; evidence screens 5–10 s with a slow push or scroll.
- Allow 1–3 deliberate long holds (a raw clip of 10–40 s, a 3–5 s card) — mark them in the EDL.
- No stretch over ~20 s without a visual change unless it's one of those marked holds.
- A new question, reveal, number or joke at least every 45–90 s.
- Section lengths: see the beat sheet in Reference H.

---

## Reference F — Music, sound and transitions

Measured:
- V3 keeps one steady narration-over-bed mix: median loudness −20 dBFS, and the middle half of all seconds sits inside a ~6 dB window. The quietest seconds (mostly pauses between sentences, where only the bed is left) sit ~13 dB under the median, so the bed runs at least that far under the voice.
- V3 drops to near-silence for ~1 s right before and right after the accused's raw clip (13:41, 14:19) and before section changes (2:14, 17:03), then lands a noticeable hit when a chapter card appears (6:22, 12:10) or the music comes back (14:20).
- Under V3's personal-response section (12:10–16:40) the music's low end repeatedly drops away, so the voices and the raw clip carry it.
- V2 scores the entire film with the game's own soundtrack, credited in the description, which makes the nostalgia part of the storytelling.
- V2 fades every chapter change into ~2–3 s of near-silence (2:22, 12:44, 18:43, 25:41, 41:14, 45:16) — the chapter card sits in a breath, then the new chapter's sound starts. It does the same for 2 s right after the climax ends (40:27).
- V2's two loudest moments are the cold open (~6 dB above the narrated median) and the raw climax footage (~4–5 dB above, with ~9 dB more bass). The music only swells where nobody is talking and real footage carries the moment.
- In V2's title sequence, with no narration, the music sits at the same loudness as the narrated sections (about −20 dBFS); everywhere else it is pulled down under the voice. Chapter loudness stays within ~3 dB across the whole hour.

Rules for FraggedIn:
- **One cue per section, changes on boundaries.** New chapter, new act, or a big turn = new cue. Don't change music mid-thought.
- **Choose music by function, not genre:** curiosity/investigation (sparse pulse, piano/synth), build (rising rhythm), event/climax (fuller, or the game's own track), aftermath (thin, warm, slower), outro (the channel's signature sting). Instrumental only under narration.
- **Game soundtrack where it fits and is allowed** — it's the most authentic choice for nostalgia stories. Otherwise use a licensed library; keep track of licences in `05_cues.csv`.
- **Bed level:** sit music 12–18 dB under the narration and keep the narration level steady from start to finish (both models stay within ~3–4 dB section to section).
- **Two ways to score the money clip:** if the clip's own sound matters (speech, reactions, chat), drop the music to nothing and let the clip play (V3). If it's spectacle without speech, let the score swell 4–6 dB above the narration level with more low end (V2). Either way, narration stops.
- **Silence is a tool:** fade the outgoing cue over 1–3 s into ~1–3 s of near-silence under each chapter card, then start the new cue (V2, every chapter). Put ~1 s of silence before and after the money clip (V3), and after the climax's last beat (V2 40:27). Nowhere else — silence at every cut stops meaning anything.
- **Music up only when nobody talks:** title moments and narration-free stretches can play the music at full program level (V2's title sequence matches the narrated loudness); under the voice it always goes back down.
- **Natural transitions:** cut music on a downbeat or phrase end; 0.5–1 s fades in, 1–2 s fades out; J-cuts (next shot's audio starts 6–15 frames early) into clips and interviews, L-cuts (audio tails over the next picture) out of them; keep game ambience under recreations at low level so the world never goes fully dead.
- **SFX:** sourced from the game itself where possible (UI clicks, notifications, level-up and death sounds) for text cards and panel pop-ins; one soft whoosh at most for a slide-in. No stock "riser + boom" on every card.
- **Mix:** narration consistent and intelligible (light compression, de-ess, high-pass ~80 Hz); master around −14 LUFS integrated with true peak at or below −1 dBTP, the level YouTube normalizes playback to — louder uploads are just turned down.

---

## Reference G — Graphics that don't look AI-made

What the models use, and all FraggedIn needs:
- **Text cards:** white, bold, clean sans (or one serif for dates), centred, 2–6 words, over blurred or darkened real footage or plain black. V3: the disclaimer, a one-line correction of a misconception, a list of three possibilities. V2: date and amount cards.
- **Chapter cards:** chapter name (and number) over black or over a real photo of the place (V2 41:20), held 3–5 s.
- **Name and date supers** placed *in* the footage, not in a template box (V3 1:18–1:25: a big year, then the person's name with one small accent).
- **Quote cards:** the quote in plain text over the speaker's own page or footage, with attribution.
- **Data:** a single minimal line graph or timeline, white strokes on black, animated simply (V3 6:38, 10:50).
- **Maps and calendars** only when location or date order is the point (V2 17:00, 21:20).
- **Annotation:** one circle or underline in a single accent colour.

Keep a FraggedIn style sheet once chosen (one typeface family, white plus one accent colour, the same card layout every time) and reuse it.

Avoid, because they read as AI or template:
- Generated images of people, events, or "cinematic" scenes; generated "screenshots" or documents; fake UIs. If a picture didn't exist, use an illustration made by a person or a recreation in the game.
- Glossy 3D text, lens flares, light leaks, glitch packs, floating particles, stock "news" lower-thirds, emoji, typewriter text on every line, kinetic captions over long-form narration.
- Text that only repeats the narration word for word. Text should add a date, a number, a name, a source, or a correction.

---

## Reference H — Templates

### Beat sheet for a 10:00 documentary (scale ±20% for 8–12 min)
| Time | Beat | Purpose |
|---|---|---|
| 0:00–0:30 | Cold open | Money clip or voices from the day + one-sentence premise |
| 0:30–1:00 | Promise and stakes | Scale, why this telling, non-player onboarding, title ≤5 s |
| 1:00–2:30 | World and people | Rules of the game in plain terms; protagonist(s) as people |
| 2:30–4:30 | Inciting incident → escalation | What happened, evidence on screen, first open loop |
| 4:30–5:30 | Mechanism (if needed) | Signpost, explain in-world, one-sentence recap, exit |
| 5:30–7:30 | Climax | Present tense; silence then the raw clip, 10–40 s uncut |
| 7:30–9:15 | Aftermath and response | Consequences, reactions, late twist, the other side |
| 9:15–10:00 | Legacy and close | Theme or irony line; sign-off ≤15 s; end screen |

### `04_edl.csv` columns
`id, timeline_in, timeline_out, section, narration_line, visual_type, source_file_or_url, source_in, source_out, on_screen_text, motion, transition_in, clip_audio_db, music_cue, sfx, credit, deliberate_hold, notes`
- `visual_type`: original_clip · artifact · interview · photo · recreation · era_broll · illustration · gameplay · card
- `motion`: none · push_in_3pct · slow_scroll · pan
- `transition_in`: cut · dissolve_0.5s · dip_to_black_0.5s · j_cut · l_cut

### `05_cues.csv` columns
`cue_id, timeline_in, timeline_out, type, track_title, source_and_licence, function, level_vs_narration_db, entry, exit, notes`
- `type`: music · silence · sfx · ambience · clip_audio
- `entry`/`exit`: hard_on_downbeat · fade_0.5s · fade_1s · fade_2s · cut_on_phrase

Example rows:
```
M1,0:00,0:30,music,"(game OST track)","OST, policy checked",tension under cold open,-15,fade_0.5s,cut_on_phrase,stops dead before title
S1,0:30,0:31,silence,,,"beat before title",,,,
M2,0:31,2:30,music,"(library track)","Library licence #...",curiosity bed,-18,hard_on_downbeat,fade_2s,
X1,6:10,6:48,clip_audio,"(original VOD)","Credit: channel name",the money clip,0,j_cut,l_cut,music muted under clip
```

---

## Reference I — QA checklist before export

Measure the draft instead of eyeballing it. With IngrainedCut connected:
- **Look at it** — `capture_contact_sheet` across the whole sequence (30 frames per call, e.g. 0–300 s and 300–600 s), a dense sheet for 0–30 s (one frame per second) and one around the climax; `capture_frame` on every card to check it reads.
- **Mix** — `export_video` the audio alone (`format: "wav"`) into a QA folder and `import_media` it (bin only, don't place it). Then `analyze_loudness` gives integrated LUFS and true peak, `detect_silence` with `threshold_db: -45` and `min_duration: 0.4` lists every silence, and `transcribe` gives the word count (words per minute, every script line present).
- **Cuts** — `export_video` a 720p proxy (`height: 720`, `quality: 28`), import it, then `detect_scenes` (`threshold: 0.3`) gives cut times, from which you get shot lengths and the longest holds.
- **Loudness off target?** Raise or lower every track by the difference with `manage_tracks` (`action: "set"`, `volume_db`), as long as true peak stays at or below −1 dBTP — the peak limit wins.

Without IngrainedCut, run ffmpeg on a render in the workspace (stage a 720p proxy from Ben's PC if the full file is too big):
```bash
# integrated loudness and true peak (summary at the end)
ffmpeg -hide_banner -i draft.mp4 -filter_complex ebur128=peak=true -f null - 2>&1 | tail -12
# silences: should only appear under chapter cards and around the money clip
ffmpeg -hide_banner -i draft.mp4 -af silencedetect=noise=-45dB:d=0.4 -f null - 2>&1 | grep silence_
# hard cuts -> shot lengths and the longest holds
ffmpeg -hide_banner -i draft.mp4 -vf "select='gt(scene,0.3)',showinfo" -an -f null - 2>&1 | grep -o 'pts_time:[0-9.]*'
```
Scene detection misses dissolves and over-counts fast gameplay; treat its shot lengths as a guide and check the flagged spots by eye.

Story
- [ ] By 0:30: what happened, how big, why this video. By 1:00: what the game is for a non-player.
- [ ] Climax or verdict at ~45–70% of runtime; aftermath gets at least 15%.
- [ ] Every open loop is paid off on screen.
- [ ] No 90 s stretch without a new question, reveal, number or joke.
- [ ] Ending lands on a theme or twist; sign-off ≤15 s.

Truth
- [ ] Every factual claim traces to `01_research.md`; quotes are verbatim with sources; unknowns are stated as unknown.
- [ ] Opinion is labelled as opinion; real people are handled fairly and named per the agreed policy.

Picture
- [ ] Every shot relates to the line it sits under; the money clips are used and given room.
- [ ] No unmarked stretch over ~20 s without visual change; holds over 10 s are deliberate.
- [ ] All on-screen text follows Reference G; nothing generated passes as real.
- [ ] Borrowed footage and music are credited on screen or in the description.

Sound
- [ ] Narration intelligible over music everywhere (listen at low volume and on phone speakers).
- [ ] Music changes only on section boundaries; no abrupt cuts mid-phrase; no music under raw dialogue.
- [ ] Silences sit only under chapter cards and around the money clip — no accidental gaps between clips.
- [ ] Master ≈ −14 LUFS integrated, true peak ≤ −1 dBTP; no clipping.

Delivery
- [ ] Runtime 8:00–12:00. 1080p or higher, frame rate matching the footage.
- [ ] `08_publish.md` has chapters, sources, music and art credits.
