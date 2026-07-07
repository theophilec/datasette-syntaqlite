import json
import mimetypes
import os

import syntaqlite as syntaqlite
from datasette import Response, hookimpl
from markupsafe import escape

from .routes import lint_view

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


async def _serve_static(request):
    """Serve a file from the plugin's static/ directory."""
    path = request.url_vars.get("path", "")
    # Prevent path traversal
    static_real = os.path.realpath(STATIC_DIR)
    full_path = os.path.realpath(os.path.join(STATIC_DIR, path))
    if not full_path.startswith(static_real + os.sep):
        return Response("Forbidden", status=403, content_type="text/plain")
    if not os.path.isfile(full_path):
        return Response("Not found", status=404, content_type="text/plain")
    mime, _ = mimetypes.guess_type(full_path)
    if mime is None:
        mime = "application/octet-stream"
    with open(full_path, "rb") as fh:
        body = fh.read()
    return Response(body.decode("utf-8"), status=200, content_type=mime)


@hookimpl
def register_routes(datasette):

    return [
        (r"^/-/syntaqlite-lint$", lint_view),
    ]


@hookimpl
def extra_body_script(request, **kwargs):
    """Inject a hidden csrftoken input and a <meta> tag into every page so
    that the JS can read the CSRF token from the DOM without an extra fetch.
    Calling request.scope["csrftoken"]() also triggers asgi-csrf to set the
    ds_csrftoken cookie in the response."""
    if request is None:
        return ""
    token = request.scope.get("csrftoken", lambda: "")()
    if not token:
        return ""

    safe_token = str(escape(token))
    return (
        "document.currentScript.insertAdjacentHTML('beforebegin',"
        f' \'<input type="hidden" name="csrftoken" id="syntaqlite-csrftoken"'
        f' value="{safe_token}">\');'
    )


@hookimpl
def extra_js_urls(datasette):
    return [
        {
            "url": datasette.urls.static_plugins(
                "datasette-syntaqlite", "syntaqlite-lint.js"
            ),
            "module": True,
        }
    ]


@hookimpl
def extra_css_urls(datasette):
    return [
        datasette.urls.static_plugins("datasette-syntaqlite", "syntaqlite-lint.css")
    ]
