import json
import mimetypes
import os

import syntaqlite as _syntaqlite
from datasette import Response, hookimpl
from markupsafe import escape
from pydantic import BaseModel

_syntaqlite_instance = _syntaqlite.Syntaqlite()


STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


class SyntaqliteDiagnostics(BaseModel):
    severity: str
    message: str
    start_offset: int
    end_offset: int


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


class LintRequest(BaseModel):
    sql: str
    database: str | None = None


async def _lint_view(request, datasette):
    """POST /-/syntaqlite-lint — validate SQL and return diagnostics."""

    try:
        raw = await request.post_body()
        payload = LintRequest.model_validate_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        return Response.json({"error": f"Bad JSON: {exc}"}, status=400)

    sql = payload.sql
    db_name = payload.database

    try:
        db = datasette.get_database(db_name if db_name else None)
    except Exception:
        return Response.json({"error": f"Database {db_name!r} not found"}, status=404)

    try:
        table_names = await db.table_names()
        view_names = await db.view_names()

        tables = []
        for table_name in table_names:
            try:
                cols = await db.table_column_details(table_name)
                col_names = [col.name for col in cols]
            except Exception:
                col_names = None  # syntaqlite accepts None → unknown columns
            tables.append(_syntaqlite.Table(table_name, col_names))

        views = []
        for view_name in view_names:
            try:
                cols = await db.table_column_details(view_name)
                col_names = [col.name for col in cols]
            except Exception:
                col_names = None
            views.append(_syntaqlite.View(view_name, col_names))

    except Exception as exc:
        return Response.json(
            {"error": f"Failed to introspect database: {exc}"}, status=500
        )

    try:
        schema = _syntaqlite.Schema(tables=tables, views=views)
        result = _syntaqlite_instance.analyze(sql, schema)
        diagnostics = [
            SyntaqliteDiagnostics(
                severity=d.severity,
                message=d.message,
                start_offset=d.start_offset,
                end_offset=d.end_offset,
            )
            for d in result.diagnostics
        ]
        return Response.json({"diagnostics": [d.model_dump() for d in diagnostics]})
    except Exception as exc:
        return Response.json({"error": f"Validation error: {exc}"}, status=500)


async def lint_view(request, datasette):
    return await _lint_view(request, datasette)


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
