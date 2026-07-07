import sqlite3

import pytest
from datasette.app import Datasette


@pytest.fixture
def ds(tmp_path):
    """Datasette instance backed by a tiny SQLite database with one table."""
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, salary REAL)"
    )
    conn.execute("INSERT INTO employees VALUES (1, 'Alice', 100.0)")
    conn.commit()
    conn.close()
    return Datasette([str(db_path)])


@pytest.mark.asyncio
async def test_plugin_is_installed():
    datasette = Datasette(memory=True)
    response = await datasette.client.get("/-/plugins.json")
    assert response.status_code == 200
    installed_plugins = {p["name"] for p in response.json()}
    assert "datasette-syntaqlite" in installed_plugins


@pytest.mark.asyncio
async def test_lint_valid_sql_returns_no_diagnostics(ds):
    response = await ds.client.post(
        "/-/syntaqlite-lint",
        content=b'{"sql": "SELECT id, name FROM employees", "database": "test"}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "diagnostics" in data
    assert data["diagnostics"] == []


@pytest.mark.asyncio
async def test_lint_unknown_column_returns_diagnostics(ds):
    response = await ds.client.post(
        "/-/syntaqlite-lint",
        content=b'{"sql": "SELECT nonexistent FROM employees", "database": "test"}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "diagnostics": [
            {
                "severity": "warning",
                "message": "unknown column 'nonexistent'",
                "start_offset": 7,
                "end_offset": 18,
            }
        ]
    }


@pytest.mark.asyncio
async def test_lint_bad_json_returns_400(ds):
    response = await ds.client.post(
        "/-/syntaqlite-lint",
        content=b"not json at all",
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": "Bad JSON: 1 validation error for LintRequest\n  Invalid JSON: expected ident at line 1 column 2 [type=json_invalid, input_value=b'not json at all', input_type=bytes]\n    For further information visit https://errors.pydantic.dev/2.12/v/json_invalid"
    }


@pytest.mark.asyncio
async def test_lint_unknown_database_returns_404(ds):
    response = await ds.client.post(
        "/-/syntaqlite-lint",
        content=b'{"sql": "SELECT 1", "database": "does_not_exist"}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 404
    assert response.json() == {"error": "Database 'does_not_exist' not found"}
