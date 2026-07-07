from datasette import hookimpl
from markupsafe import escape

from .routes import lint_view


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
