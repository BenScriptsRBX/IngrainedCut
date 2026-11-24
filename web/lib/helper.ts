// The helper's one-line setup. scripts/pack-helper.mjs writes helper.json when it packs the tarball this site serves.
import helper from './helper.json';
import { SITE } from './site';

export const HELPER_VERSION = helper.version;
export const HELPER_COMMAND = `npx -y ${SITE.url}${helper.file}`;
/** Windows: the helper as an app with an installer (no command, no Node.js), from the latest GitHub release. */
export const HELPER_DOWNLOAD = 'https://github.com/BenScriptsRBX/IngrainedCut/releases/latest/download/IngrainedCut-Helper-Setup.exe';
/** The Chrome extension (ChatGPT in the browser, no helper): the zip on the latest GitHub release, until it is on the Chrome Web Store. */
export const EXTENSION_ZIP = 'https://github.com/BenScriptsRBX/IngrainedCut/releases/latest/download/IngrainedCut-Chrome-Extension.zip';
/** The Chrome Web Store page, once the extension is listed (then the site links there instead of the zip). */
export const EXTENSION_STORE = '';
