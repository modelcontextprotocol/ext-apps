import { useState } from "react";
import type { DesignContextData } from "../types";

interface DesignContextProps {
  data: DesignContextData;
}

export default function DesignContext({ data }: DesignContextProps) {
  const { colors, fonts, spacing, layouts } = data;
  const [copied, setCopied] = useState(false);

  const handleExportCSS = async () => {
    const lines: string[] = [":root {"];

    for (const color of colors) {
      lines.push(`  --${color.name}: ${color.hex};`);
    }
    for (const font of fonts) {
      const safeName = font.family.toLowerCase().replace(/\s+/g, "-");
      lines.push(`  --font-${safeName}: ${font.family};`);
    }
    for (const space of spacing) {
      const safeName = space.name.toLowerCase().replace(/\s+/g, "-");
      lines.push(`  --${safeName}: ${space.value};`);
    }

    lines.push("}");

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may not be available
    }
  };

  const hasAnyTokens =
    colors.length > 0 ||
    fonts.length > 0 ||
    spacing.length > 0 ||
    layouts.length > 0;

  if (!hasAnyTokens) {
    return (
      <div className="view-container">
        <div className="view-header">
          <h2>Design Context</h2>
        </div>
        <div className="empty-state">
          <h3>No design tokens found</h3>
          <p>This screen does not have extractable design tokens.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Design Context</h2>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleExportCSS}
        >
          {copied ? "Copied!" : "Export as CSS"}
        </button>
      </div>

      <div className="design-context-grid">
        {/* Colors */}
        {colors.length > 0 && (
          <div className="context-section">
            <h3>
              Colors <span className="badge">{colors.length}</span>
            </h3>
            <div className="color-grid">
              {colors.map((color, i) => (
                <div key={i} className="color-swatch-large">
                  <div
                    className="swatch-preview-large"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="swatch-info">
                    <span className="swatch-value">{color.hex}</span>
                    <span className="swatch-name">{color.name}</span>
                    {color.usage && (
                      <span className="swatch-usage">{color.usage}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Typography */}
        {fonts.length > 0 && (
          <div className="context-section">
            <h3>
              Typography <span className="badge">{fonts.length}</span>
            </h3>
            <div className="font-list">
              {fonts.map((font, i) => (
                <div key={i} className="font-item-large">
                  <div
                    className="font-preview"
                    style={{
                      fontFamily: font.family,
                      fontWeight: font.weight,
                      fontSize: font.size,
                    }}
                  >
                    The quick brown fox jumps over the lazy dog
                  </div>
                  <div className="font-details">
                    <span className="font-family">{font.family}</span>
                    <span className="font-meta">
                      Weight: {font.weight} &middot; Size: {font.size}
                    </span>
                    {font.usage && (
                      <span className="font-usage">{font.usage}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Spacing */}
        {spacing.length > 0 && (
          <div className="context-section">
            <h3>
              Spacing <span className="badge">{spacing.length}</span>
            </h3>
            <div className="spacing-list">
              {spacing.map((space, i) => (
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

        {/* Layout Patterns */}
        {layouts.length > 0 && (
          <div className="context-section">
            <h3>
              Layout Patterns <span className="badge">{layouts.length}</span>
            </h3>
            <div className="layout-list">
              {layouts.map((layout, i) => (
                <div key={i} className="layout-card">
                  <span className="layout-type">{layout.type}</span>
                  <span className="layout-desc">{layout.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
