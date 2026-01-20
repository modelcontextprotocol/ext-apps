#!/usr/bin/env uv run
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mcp @ git+https://github.com/modelcontextprotocol/python-sdk@main",
#     "qrcode[pil]>=8.0",
#     "uvicorn>=0.34.0",
#     "starlette>=0.46.0",
# ]
# ///
"""
QR Code MCP Server - Generates QR codes from text
"""
import os
import sys
import io
import base64
from pathlib import Path

import qrcode
import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp import types
from starlette.middleware.cors import CORSMiddleware

WIDGET_URI = "ui://qr-server/widget.html"
HOST = os.environ.get("HOST", "0.0.0.0")  # 0.0.0.0 for Docker compatibility
PORT = int(os.environ.get("PORT", "3108"))

mcp = FastMCP("QR Code Server")


@mcp.tool(meta={
    "ui":{"resourceUri": WIDGET_URI},
    "ui/resourceUri": WIDGET_URI, # legacy support
})
def generate_qr(
    text: str = "https://modelcontextprotocol.io",
    box_size: int = 10,
    border: int = 4,
    error_correction: str = "M",
    fill_color: str = "black",
    back_color: str = "white",
) -> list[types.ImageContent]:
    """Generate a QR code from text.

    Args:
        text: The text/URL to encode
        box_size: Size of each box in pixels (default: 10)
        border: Border size in boxes (default: 4)
        error_correction: Error correction level - L(7%), M(15%), Q(25%), H(30%)
        fill_color: Foreground color (hex like #FF0000 or name like red)
        back_color: Background color (hex like #FFFFFF or name like white)
    """
    error_levels = {
        "L": qrcode.constants.ERROR_CORRECT_L,
        "M": qrcode.constants.ERROR_CORRECT_M,
        "Q": qrcode.constants.ERROR_CORRECT_Q,
        "H": qrcode.constants.ERROR_CORRECT_H,
    }

    qr = qrcode.QRCode(
        version=1,
        error_correction=error_levels.get(error_correction.upper(), qrcode.constants.ERROR_CORRECT_M),
        box_size=box_size,
        border=border,
    )
    qr.add_data(text)
    qr.make(fit=True)

    img = qr.make_image(fill_color=fill_color, back_color=back_color)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    b64 = base64.b64encode(buffer.getvalue()).decode()
    return [types.ImageContent(type="image", data=b64, mimeType="image/png")]


# IMPORTANT: all the external domains used by app must be listed
# in the meta.ui.csp.resourceDomains - otherwise they will be blocked by CSP policy
@mcp.resource(
    WIDGET_URI,
    mime_type="text/html;profile=mcp-app",
    meta={"ui": {"csp": {"resourceDomains": ["https://unpkg.com"]}}},
)
def widget() -> str:
    """Widget HTML resource with CSP metadata for external dependencies."""
    return Path(__file__).parent.joinpath("widget.html").read_text()

if __name__ == "__main__":
    if "--stdio" in sys.argv:
        # Claude Desktop mode
        mcp.run(transport="stdio")
    else:
        # HTTP mode for basic-host (default) - with CORS
        app = mcp.streamable_http_app(stateless_http=True)
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
        print(f"QR Code Server listening on http://{HOST}:{PORT}/mcp")
        uvicorn.run(app, host=HOST, port=PORT)
