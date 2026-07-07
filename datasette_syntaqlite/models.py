from pydantic import BaseModel


class LintRequest(BaseModel):
    sql: str
    database: str | None = None


class SyntaqliteDiagnostics(BaseModel):
    severity: str
    message: str
    start_offset: int
    end_offset: int
