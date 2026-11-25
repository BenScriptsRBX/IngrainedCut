# The extension's video downloader: third-party software

This folder runs yt-dlp in the browser. It bundles, unchanged:

- **Pyodide** (`pyodide/`, from the `pyodide` npm package): Mozilla Public License 2.0. Source and license:
  https://github.com/pyodide/pyodide. It includes CPython and its standard library (`python_stdlib.zip`), under the
  Python Software Foundation License: https://docs.python.org/3/license.html.
- **yt-dlp** (`wheels/yt_dlp-*.whl`): The Unlicense. https://github.com/yt-dlp/yt-dlp. The wheel carries its LICENSE
  in `*.dist-info/`.
- **yt-dlp-ejs** (`wheels/yt_dlp_ejs-*.whl`), yt-dlp's YouTube challenge solver: The Unlicense, with meriyah (ISC) and
  astring (MIT). https://github.com/yt-dlp/ejs. The wheel carries its LICENSE in `*.dist-info/`.

Once a week the downloader checks PyPI for a newer yt-dlp; a newer wheel (and the yt-dlp-ejs version it asks for) is
downloaded from PyPI, checked against PyPI's SHA-256, and used from then on.
