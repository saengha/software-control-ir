"""Entry point for kritarunner: `kritarunner -s scir_runner`.

Starts the localhost PyKrita TCP bridge and runs the Qt event loop until shutdown.
"""

from __future__ import annotations

import os
import sys

from PyQt5.QtNetwork import QHostAddress
from PyQt5.QtWidgets import QApplication


def __main__(*args: str) -> None:
    port = None
    argv = list(args) if args else sys.argv[1:]
    if "--port" in argv:
        port = argv[argv.index("--port") + 1]
    if port is None:
        port = os.environ.get("SCIR_KRITA_PORT")
    if not port:
        raise RuntimeError("SCIR_KRITA_PORT or --port is required")

    log_path = os.environ.get("SCIR_KRITA_LOG")
    # Import after kritarunner has initialized PyKrita.
    from scir_bridge import LineServer  # noqa: WPS433

    server = LineServer()
    ok = server.listen(QHostAddress.LocalHost, int(port))
    if log_path:
        with open(log_path, "w", encoding="utf-8") as handle:
            handle.write(f"listen={ok} port={port} error={server.errorString()}\n")
    if not ok:
        raise RuntimeError(f"BRIDGE_ERROR: cannot listen on 127.0.0.1:{port}")

    app = QApplication.instance()
    if app is None:
        raise RuntimeError("PROCESS_ERROR: kritarunner did not create a QApplication")
    # Keep a reference so the server is not GC'd while exec is running.
    app.setProperty("scirBridgeServer", server)
    app.exec_()
