import json

import syntaqlite
from datasette import Response
from syntaqlite import Analysis

from .models import LintRequest, SyntaqliteDiagnostics

syntaqlite_instance = syntaqlite.Syntaqlite()


async def lint_view(request, datasette):
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
            tables.append(syntaqlite.Table(table_name, col_names))

        views = []
        for view_name in view_names:
            try:
                cols = await db.table_column_details(view_name)
                col_names = [col.name for col in cols]
            except Exception:
                col_names = None
            views.append(syntaqlite.View(view_name, col_names))

    except Exception as exc:
        return Response.json(
            {"error": f"Failed to introspect database: {exc}"}, status=500
        )

    try:
        schema = syntaqlite.Schema(tables=tables, views=views)
        result = syntaqlite_instance.analyze(sql, schema)
        if isinstance(result, Analysis):
            diagnostics = [
                SyntaqliteDiagnostics(
                    severity=d.severity,
                    message=d.message,
                    start_offset=d.start_offset,
                    end_offset=d.end_offset,
                )
                for d in result.diagnostics
            ]
        else:
            diagnostics = [
                SyntaqliteDiagnostics(
                    severity="fallback", message=result, start_offset=0, end_offset=1
                )
            ]

        return Response.json({"diagnostics": [d.model_dump() for d in diagnostics]})
    except Exception as exc:
        return Response.json({"error": f"Validation error: {exc}"}, status=500)
