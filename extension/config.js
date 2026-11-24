// Where the extension signs in and sends ChatGPT requests. scripts/pack-extension.mjs --dev rewrites this file for local
// testing (a stand-in OpenAI server); the published extension always uses OpenAI.
export const CONFIG = {
  auth: 'https://auth.openai.com',
  apiBase: 'https://api.openai.com/v1',
};
