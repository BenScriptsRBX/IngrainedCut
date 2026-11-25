# Publishing the IngrainedCut extension on the Chrome Web Store

Until it's listed, people get the extension from the GitHub release (`IngrainedCut-Chrome-Extension.zip`) and add it with
**Load unpacked**. Once it's on the store, adding it takes one click.

## Submit it

1. Register a Chrome Web Store developer account at https://chrome.google.com/webstore/devconsole. Google charges a
   one-time $5 fee.
2. Build the package: `node scripts/pack-extension.mjs`. It writes `../IngrainedCut-extension/IngrainedCut-Chrome-Extension-store.zip`,
   with the files at the zip's root as the store requires.
   The store zip leaves out the video downloader (`ytdlp/`, yt-dlp in the browser) and the permissions it needs
   (all sites, declarativeNetRequest): the Chrome Web Store doesn't allow extensions that download YouTube videos. The
   downloader is only in `IngrainedCut-Chrome-Extension.zip` from the GitHub release.
3. In the developer console, click **New item** and upload that zip.
4. Fill in the listing, privacy and permission fields with the text below. Add at least one 1280×800 screenshot, such as
   the editor with the ChatGPT chat open.
5. Submit for review. Google's review usually takes a few days.
6. Once it's published, put its store URL in `EXTENSION_STORE` in `src/chatgptExtension.ts` and `web/lib/helper.ts`, then
   rebuild and deploy the site. The editor and the download page then link to the store instead of the zip.
7. For each update, bump the version, run the pack script and upload the new store zip under **Package**.

## Store listing

**Name:** IngrainedCut

**Summary** (132 characters max):
Edit videos on ingrainedcut.com with ChatGPT on your own ChatGPT plan. Nothing else to install.

**Category:** Productivity → Tools

**Language:** English

**Description:**

IngrainedCut is a free, open-source video editor that runs in your browser at ingrainedcut.com. This extension adds AI
editing: describe the edit you want, and ChatGPT cuts, trims, titles, grades and arranges your timeline for you.

• Runs on your own ChatGPT plan (Plus or Pro): click Continue with ChatGPT in the editor and sign in on OpenAI's page.
• Nothing else to install: no app, no command line.
• Your footage stays on your computer. The chat sees a text description of your timeline and, if you choose, frames
  from your edit.
• Your ChatGPT sign-in stays in the extension in your browser and goes only to OpenAI. It never passes through
  IngrainedCut's servers.

How to use it: add the extension, open the editor at https://www.ingrainedcut.com, pick ChatGPT in the AI panel and click
Continue with ChatGPT.

Transcription, silence detection and a few export formats need the free IngrainedCut helper on your computer. See
https://www.ingrainedcut.com/download.

Source code (AGPL-3.0): https://github.com/BenScriptsRBX/IngrainedCut

**Website:** https://www.ingrainedcut.com
**Support:** ingrainedcut@proton.me

## Privacy tab

**Single purpose:**
Lets the IngrainedCut video editor at ingrainedcut.com use the user's ChatGPT plan: it signs the user in with ChatGPT and
sends the editor's ChatGPT requests to OpenAI.

**Permission justifications:**
- `storage`: keeps the user's ChatGPT sign-in tokens and this install's ID in the extension's own storage.
- Host permission `https://auth.openai.com/*`: signs in with ChatGPT and renews the sign-in (OpenAI's OAuth endpoints).
- Host permission `https://api.openai.com/*`: sends the editor's ChatGPT requests and lists the models the user's plan offers.
- Host permission `http://127.0.0.1:1455/*`: this is the sign-in redirect address OpenAI allows for apps that run on
  the user's computer. The extension reads the sign-in code from the tab's address when OpenAI redirects there, then
  closes the tab. Nothing is fetched from that address.
- Content script on `ingrainedcut.com`: tells the editor the extension is installed and relays the editor's requests to
  the extension.

**Remote code:** No, the extension doesn't use remote code.

**Data usage** (check these boxes):
- Personally identifiable information: the email address OpenAI returns at sign-in, shown in the editor.
- Authentication information: the ChatGPT sign-in tokens.
- Website content: the user's chat messages and a text description of their timeline, sent to OpenAI to answer them.

Certify all three statements: no selling of data, no use unrelated to the single purpose, no use for creditworthiness.

**Privacy policy URL:** https://www.ingrainedcut.com/privacy
