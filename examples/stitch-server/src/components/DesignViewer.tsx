import { useState } from "react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { DesignViewerData } from "../types";

interface DesignViewerProps {
  data: DesignViewerData;
  app: App;
  onCallTool: (name: string, args: Record<string, unknown>) => Promise<void>;
}

type TabId = "code" | "tokens";

export default function DesignViewer({
  data,
  app,
  onCallTool,
}: DesignViewerProps) {
  const { screen, imageData, codeData, designContext } = data;
  const [activeTab, setActiveTab] = useState<TabId>("code");
  const [copied, setCopied] = useState(false);

  const screenName = screen.title || "Untitled Screen";

  // Extract project/screen IDs from screen.name (projects/{pid}/screens/{sid})
  const nameParts = screen.name?.split("/") || [];
  const projectId = nameParts[1] || "";

  const handleCopyCode = async () => {
    const code =
      activeTab === "code"
        ? `<!-- HTML -->\n${codeData.html}\n\n/* CSS */\n${codeData.css}`
        : JSON.stringify(designContext, null, 2);

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may not be available in sandboxed iframe
    }
  };

  const handleOpenInStitch = () => {
    if (screen.name) {
      void app.openLink({
        url: `https://stitch.google.com/${screen.name}`,
      });
    }
  };

  const handleBackToScreens = () => {
    void onCallTool("list-screens", { projectId });
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleBackToScreens}
        >
          &larr; Screens
        </button>
        <h2>{screenName}</h2>
        <div className="view-header-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleOpenInStitch}
          >
            Open in Stitch
          </button>
        </div>
      </div>

      <div className="design-viewer-layout">
        {/* Left: Image Preview */}
        <div className="preview-panel">
          {imageData ? (
            <img
              src={imageData}
              alt={screenName}
              className="preview-image"
            />
          ) : (
            <div className="preview-placeholder">
              <span>No preview available</span>
            </div>
          )}
          {screen.deviceType && (
            <div className="device-info">
              <span className="device-badge">{screen.deviceType}</span>
            </div>
          )}
        </div>

        {/* Right: Code & Tokens */}
        <div className="detail-panel">
          <div className="tab-bar">
            <button
              className={`tab ${activeTab === "code" ? "active" : ""}`}
              onClick={() => setActiveTab("code")}
            >
              Code
            </button>
            <button
              className={`tab ${activeTab === "tokens" ? "active" : ""}`}
              onClick={() => setActiveTab("tokens")}
            >
              Design Tokens
            </button>
            <button
              className="btn btn-sm copy-btn"
              onClick={handleCopyCode}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          <div className="tab-content">
            {activeTab === "code" ? (
              <div className="code-panel">
                {codeData.html && (
                  <div className="code-section">
                    <h4>HTML</h4>
                    <pre className="code-block">{codeData.html}</pre>
                  </div>
                )}
                {codeData.css && (
                  <div className="code-section">
                    <h4>CSS</h4>
                    <pre className="code-block">{codeData.css}</pre>
                  </div>
                )}
                {!codeData.html && !codeData.css && (
                  <div className="empty-state">
                    <p>No code available for this screen.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="tokens-panel">
                {/* Colors */}
                {designContext.colors.length > 0 && (
                  <div className="token-section">
                    <h4>Colors</h4>
                    <div className="color-grid">
                      {designContext.colors.map((color, i) => (
                        <div key={i} className="color-swatch">
                          <div
                            className="swatch-preview"
                            style={{ backgroundColor: color.hex }}
                          />
                          <span className="swatch-value">{color.hex}</span>
                          <span className="swatch-name">{color.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fonts */}
                {designContext.fonts.length > 0 && (
                  <div className="token-section">
                    <h4>Typography</h4>
                    <div className="font-list">
                      {designContext.fonts.map((font, i) => (
                        <div key={i} className="font-item">
                          <span
                            className="font-sample"
                            style={{
                              fontFamily: font.family,
                              fontWeight: font.weight,
                              fontSize: font.size,
                            }}
                          >
                            Aa
                          </span>
                          <div className="font-details">
                            <span className="font-family">{font.family}</span>
                            <span className="font-meta">
                              {font.weight} &middot; {font.size}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Spacing */}
                {designContext.spacing.length > 0 && (
                  <div className="token-section">
                    <h4>Spacing</h4>
                    <div className="spacing-list">
                      {designContext.spacing.map((space, i) => (
                        <div key={i} className="spacing-item">
                          <span className="spacing-name">{space.name}</span>
                          <div className="spacing-bar-container">
                            <div
                              className="spacing-bar"
                              style={{ width: space.value }}
                            />
                          </div>
                          <span className="spacing-value">{space.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Layouts */}
                {designContext.layouts.length > 0 && (
                  <div className="token-section">
                    <h4>Layout Patterns</h4>
                    <div className="layout-list">
                      {designContext.layouts.map((layout, i) => (
                        <div key={i} className="layout-item">
                          <span className="layout-type">{layout.type}</span>
                          <span className="layout-desc">
                            {layout.description}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {designContext.colors.length === 0 &&
                  designContext.fonts.length === 0 &&
                  designContext.spacing.length === 0 &&
                  designContext.layouts.length === 0 && (
                    <div className="empty-state">
                      <p>No design tokens extracted.</p>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
