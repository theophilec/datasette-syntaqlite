# datasette-syntaqlite

[![PyPI](https://img.shields.io/pypi/v/datasette-syntaqlite.svg)](https://pypi.org/project/datasette-syntaqlite/)
[![Changelog](https://img.shields.io/github/v/release/theophilec/datasette-syntaqlite?include_prereleases&label=changelog)](https://github.com/theophilec/datasette-syntaqlite/releases)
[![Tests](https://github.com/theophilec/datasette-syntaqlite/actions/workflows/test.yml/badge.svg)](https://github.com/theophilec/datasette-syntaqlite/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://github.com/theophilec/datasette-syntaqlite/blob/main/LICENSE)

Lint Datasette queries with Syntaqlite

## Installation

Install this plugin in the same environment as Datasette.
```bash
datasette install datasette-syntaqlite
```
## Usage

This plugin uses [`syntaqlite`](https://docs.syntaqlite.com/main/) to lint SQL queries in Datasette. It monitors the input field and runs at each change.

## Development

To set up this plugin locally, first checkout the code. You can confirm it is available like this:
```bash
cd datasette-syntaqlite
# Confirm the plugin is visible
uv run datasette plugins
```
To run the tests:
```bash
uv run pytest
```
