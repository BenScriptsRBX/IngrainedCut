# yt-dlp inside the IngrainedCut extension (Pyodide, Python compiled to WebAssembly).
# ytdlp.js loads this module and registers `icut_host`, the browser side of it:
#   icut_host.fetch(url, method, headers, body, timeout) -> {status, url, headers: [[name, value]], read(), cancel()}
#   icut_host.solve(script) -> what the script printed (YouTube's JS challenges, run in a sandboxed page)
#   icut_host.progress(job, json)                       -> download progress for the editor
# Python can wait on those promises (pyodide.ffi.run_sync) because the calls into this module are made with
# JS Promise Integration (callPromising).
import io
import json
import os
import shutil

import icut_host
from pyodide.ffi import run_sync, to_js
import js

import yt_dlp
from yt_dlp.networking import common as _net
from yt_dlp.networking.common import RequestHandler, Response, register_preference, register_rh
from yt_dlp.networking.exceptions import HTTPError, TransportError
from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
from yt_dlp.extractor.youtube.jsc.provider import (
    JsChallengeProviderError,
    register_preference as register_jsc_preference,
    register_provider as register_jsc_provider,
)
from yt_dlp.extractor.youtube.pot._provider import BuiltinIEContentProvider


# ---------- HTTP through the browser ----------
class _Body(io.RawIOBase):
    """A fetch response body, read as it streams in."""

    def __init__(self, res):
        self._res = res
        self._buf = bytearray()
        self._eof = False

    def readable(self):
        return True

    def _pull(self):
        chunk = run_sync(self._res.read())
        if chunk is None or not hasattr(chunk, 'to_bytes'):  # undefined or null: the end
            self._eof = True
        else:
            self._buf += chunk.to_bytes()

    def read(self, amt=-1):
        if amt is None or amt < 0:
            while not self._eof:
                self._pull()
            out = bytes(self._buf)
            self._buf.clear()
            return out
        while len(self._buf) < amt and not self._eof:
            self._pull()
        out = bytes(self._buf[:amt])
        del self._buf[:amt]
        return out

    def close(self):
        if not self.closed and not self._eof:
            try:
                self._res.cancel()
            except Exception:
                pass
        super().close()


class _Headers(list):
    def items(self):
        return self


@register_rh
class BrowserFetchRH(RequestHandler):
    RH_NAME = 'browser'
    _SUPPORTED_URL_SCHEMES = ('http', 'https')
    _SUPPORTED_PROXY_SCHEMES = ()
    _SUPPORTED_FEATURES = ()

    def _check_extensions(self, extensions):
        super()._check_extensions(extensions)
        for k in ('cookiejar', 'timeout', 'legacy_ssl', 'keep_header_casing'):
            extensions.pop(k, None)

    def _send(self, request):
        headers = self._get_headers(request)
        cookie = self._get_cookiejar(request).get_cookie_header(request.url)
        if cookie:
            headers['Cookie'] = cookie
        data = request.data
        if data is not None and not isinstance(data, (bytes, bytearray)):
            data = data.read() if hasattr(data, 'read') else b''.join(data)
        try:
            res = run_sync(icut_host.fetch(
                request.url, request.method,
                to_js(headers, dict_converter=js.Object.fromEntries),
                to_js(bytes(data)) if data else None,
                self._calculate_timeout(request)))
        except Exception as e:
            raise TransportError(cause=e) from e
        response = Response(_Body(res), url=str(res.url), headers=_Headers(res.headers.to_py()), status=int(res.status))
        if not 200 <= response.status < 300:
            raise HTTPError(response, redirect_loop=False)
        return response


@register_preference(BrowserFetchRH)
def _browser_first(rh, request):
    return 1000


# the other handlers open sockets, which a browser can't
for _key in list(_net._REQUEST_HANDLERS):
    if _key != BrowserFetchRH.RH_KEY:
        del _net._REQUEST_HANDLERS[_key]


# ---------- YouTube's JS challenges ----------
@register_jsc_provider
class BrowserJCP(EJSBaseJCP, BuiltinIEContentProvider):
    PROVIDER_NAME = 'browser'
    JS_RUNTIME_NAME = 'browser'

    def is_available(self, /) -> bool:
        return self._available

    def _run_js_runtime(self, stdin: str, /) -> str:
        try:
            return str(run_sync(icut_host.solve(stdin)))
        except Exception as e:
            raise JsChallengeProviderError(f'The challenge solver failed: {e}') from e


@register_jsc_preference(BrowserJCP)
def _browser_jsc(provider, requests):
    return 1000


# ---------- downloading ----------
class _Logger:
    def __init__(self, job):
        self.job = job
        self.warnings = []

    def debug(self, msg):
        if not msg.startswith('[debug] '):
            self.info(msg)

    def info(self, msg):
        icut_host.progress(self.job, json.dumps({'line': msg[:300]}))

    def warning(self, msg):
        self.warnings.append(msg)

    def error(self, msg):
        pass


def _format(max_height, audio_only):
    if audio_only:
        return 'ba[acodec^=mp4a]/ba/b', []
    h = int(max_height or 1080)
    # H.264 and AAC first: the browser editor plays and exports them everywhere
    return 'bv*+ba/b', [f'res:{h}', 'vcodec:h264', 'acodec:aac', 'proto:https']


def download(job, url, options_json):
    """Download a link into /dl/<job>/. Returns JSON: title, id, and the files (one, or video + audio to combine)."""
    o = json.loads(options_json)
    out_dir = f'/dl/{job}'
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    logger = _Logger(job)
    fmt, sort = _format(o.get('max_height'), o.get('audio_only'))
    state = {'part': 0, 'parts': 1}

    def hook(d):
        if d.get('status') != 'downloading':
            return
        total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
        done = d.get('downloaded_bytes') or 0
        frac = (done / total) if total else 0
        cancelled = icut_host.progress(job, json.dumps({
            'progress': min(0.99, (state['part'] + frac) / state['parts']),
            'bytes': done, 'total': total, 'speed': d.get('speed') or 0,
        }))
        if cancelled:
            raise Exception('cancelled')

    opts = {
        'logger': logger,
        'quiet': True,
        'noprogress': True,
        'noplaylist': True,
        'format': fmt,
        'format_sort': sort,
        'progress_hooks': [hook],
        'cachedir': '/cache/yt-dlp',
        'fixup': 'never',
        'retries': 5,
        'fragment_retries': 10,
        'concurrent_fragment_downloads': 1,
        'socket_timeout': 30,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if info.get('_type') == 'playlist':
            entries = [e for e in (info.get('entries') or []) if e]
            if not entries:
                raise Exception('That link is a playlist with no videos in it')
            info = entries[0]
        formats = info.get('requested_formats') or [info]
        state['parts'] = len(formats)
        icut_host.progress(job, json.dumps({'title': info.get('title') or info.get('id') or 'video', 'progress': 0}))
        files = []
        for i, f in enumerate(formats):
            state['part'] = i
            part = dict(info)
            part.pop('requested_formats', None)
            part.update(f)
            kind = 'audio' if f.get('vcodec') == 'none' else 'video' if f.get('acodec') == 'none' else 'av'
            name = f'{out_dir}/{kind}.{part.get("ext") or "mp4"}'
            ok, _ = ydl.dl(name, part)
            if not ok or not os.path.exists(name):
                raise Exception(f'Could not download format {f.get("format_id")}')
            files.append({'path': name, 'kind': kind, 'ext': part.get('ext'), 'vcodec': f.get('vcodec'), 'acodec': f.get('acodec'), 'size': os.path.getsize(name)})
    return json.dumps({
        'title': info.get('title') or info.get('id') or 'video',
        'id': info.get('id'),
        'duration': info.get('duration'),
        'extractor': info.get('extractor_key'),
        'files': files,
        'warnings': logger.warnings[-5:],
    })


def version():
    return yt_dlp.version.__version__
