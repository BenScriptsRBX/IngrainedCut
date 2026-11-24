// The helper's one-line setup. scripts/pack-helper.mjs writes helper.json when it packs the tarball this site serves.
import helper from './helper.json';
import { SITE } from './site';

export const HELPER_VERSION = helper.version;
export const HELPER_COMMAND = `npx -y ${SITE.url}${helper.file}`;
/** Windows: the helper as an app with an installer (no command, no Node.js), from the latest GitHub release. */
export const HELPER_DOWNLOAD = 'https://github.com/BenScriptsRBX/IngrainedCut/releases/latest/download/IngrainedCut-Helper-Setup.exe';
