from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.environ.get("PRJ_T_API_HOST", "0.0.0.0")
    port = int(os.environ.get("PRJ_T_API_PORT", "8000"))
    reload = os.environ.get("PRJ_T_API_RELOAD", "1") not in ("0", "false", "False")
    uvicorn.run("prj_t_backend.main:app", host=host, port=port, reload=reload)


if __name__ == "__main__":
    main()
