export type MediaType = 'video' | 'audio' | 'image';

export interface Sprite {
  url: string;
  tiles: number;
  tileW: number;
  tileH: number;
  interval: number;
}

export interface MediaItem {
  id: string;
  name: string;
  path: string;
  url: string;
  type: MediaType;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  size?: number;
  thumb?: string;
  sprite?: Sprite | null;
  peaks?: number[];
  audioUrl?: string;
  status: 'loading' | 'ready' | 'error' | 'missing';
  /** HyperFrames composition folder this media was rendered from */
  composition?: string;
  /**
   * Other copies of the same file (website editor): `disk` on the user's computer (used with the helper) and `browser`
   * in this browser's storage (used without it). `path` is whichever one the editor is using now.
   */
  copies?: { disk?: string; browser?: string };
  error?: string;
}

export type ClipKind = 'video' | 'audio' | 'image' | 'text' | 'color' | 'adjustment';

export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface Effects {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  temperature: number;
  tint: number;
  blur: number;
  grayscale: number;
  sepia: number;
  invert: number;
  vignette: number;
}

/** A color wheel: x/y is the colour push (inside the unit disc), luma brightens or darkens that range (-100..100). */
export interface ColorWheel {
  x: number;
  y: number;
  luma: number;
}

/** Curve control points in 0..1 (input, output); the ends default to (0,0) and (1,1). */
export type CurvePoint = [number, number];

/**
 * A colour grade, rendered on the GPU after the basic effects. Every field is optional; missing means neutral.
 * Temperature and tint stay in `fx` (they render in the same pass).
 */
export interface ColorGrade {
  enabled?: boolean;
  /** stops, -5..5 */
  exposure?: number;
  /** -100..100 */
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  vibrance?: number;
  /** lift / gamma / gain */
  wheels?: { shadows?: ColorWheel; midtones?: ColorWheel; highlights?: ColorWheel };
  curves?: { master?: CurvePoint[]; r?: CurvePoint[]; g?: CurvePoint[]; b?: CurvePoint[] };
  /** a 3D LUT from project.luts (built-in look or imported .cube), mixed in by intensity 0..100 */
  lut?: { id: string; intensity: number };
}

/** A 3D LUT: size³ RGB entries (red fastest), 8 bits per channel, base64. */
export interface Lut {
  name: string;
  size: number;
  data: string;
}

export interface TextStyle {
  content: string;
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
  shadow: boolean;
}

export type TransitionType =
  | 'cross-dissolve'
  | 'dip-to-black'
  | 'dip-to-white'
  | 'wipe-left'
  | 'wipe-right'
  | 'slide-left'
  | 'slide-right'
  | 'push-left'
  | 'zoom-in'
  | 'blur-dissolve';

export interface Transition {
  type: TransitionType;
  duration: number;
}

export type KeyProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';
export interface Keyframe {
  t: number; // clip-relative seconds
  v: number;
  ease?: 'linear' | 'ease' | 'hold';
}

export interface ChromaKey {
  enabled: boolean;
  color: string;
  tolerance: number;
  softness: number;
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'add' | 'difference';

export interface Crop {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  mediaId?: string;
  name: string;
  start: number;
  duration: number;
  in: number;
  speed: number;
  enabled: boolean;
  linkId?: string | null;
  label?: string;
  transform: Transform;
  fx: Effects;
  crop: Crop;
  blend: BlendMode;
  volume: number; // dB
  pan: number;
  fadeIn: number;
  fadeOut: number;
  transitionIn?: Transition | null;
  transitionOut?: Transition | null;
  text?: TextStyle;
  color?: string;
  keyframes?: Partial<Record<KeyProp, Keyframe[]>>;
  chromaKey?: ChromaKey;
  grade?: ColorGrade;
}

export interface Track {
  id: string;
  kind: 'video' | 'audio';
  muted: boolean;
  solo: boolean;
  locked: boolean;
  hidden: boolean;
  volume: number; // dB
  height: number;
  name?: string;
}

export interface Marker {
  id: string;
  time: number;
  name: string;
  color: string;
  note?: string;
}

export interface SequenceSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
  background: string;
}

export interface Project {
  version: 1;
  name: string;
  path?: string | null;
  settings: SequenceSettings;
  media: MediaItem[];
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  inPoint: number | null;
  outPoint: number | null;
  nextId: number;
  /** LUTs used by clip grades, by id */
  luts?: Record<string, Lut>;
}

export type ToolId = 'select' | 'trackfwd' | 'ripple' | 'rolling' | 'rate' | 'razor' | 'slip' | 'slide' | 'hand' | 'type';

export interface CallToolResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
}
