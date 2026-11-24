declare module '*.css';
declare module '*.svg' {
  const src: string;
  export default src;
}
// the editor tool registry and guide, shared with the desktop app (the browser ChatGPT chat uses them)
declare module '*/electron/tools.mjs' {
  export const TOOL_DEFS: { name: string; description: string; where: 'renderer' | 'main'; shape?: Record<string, import('zod').ZodType> }[];
  export const TOOL_NAMES: string[];
  export const SERVER_INSTRUCTIONS: string;
}
declare module '*/electron/guide.mjs' {
  export const EDITOR_GUIDE: string;
}
