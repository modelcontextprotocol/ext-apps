import type { ListScreensData } from "../types";

interface ScreenListProps {
  data: ListScreensData;
  onCallTool: (name: string, args: Record<string, unknown>) => Promise<void>;
}

export default function ScreenList({ data, onCallTool }: ScreenListProps) {
  const { projectId, screens } = data;

  const handleScreenClick = (screenName: string) => {
    // Extract screen ID from "projects/{pid}/screens/{sid}"
    const parts = screenName.split("/");
    const screenId = parts[parts.length - 1] || "";
    void onCallTool("design-viewer", { projectId, screenId });
  };

  const handleBackClick = () => {
    void onCallTool("list-projects", {});
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleBackClick}
        >
          &larr; Projects
        </button>
        <h2>Screens</h2>
        <span className="badge">{screens.length}</span>
      </div>

      {screens.length === 0 ? (
        <div className="empty-state">
          <h3>No screens yet</h3>
          <p>Generate a new screen design to get started.</p>
        </div>
      ) : (
        <div className="screen-grid">
          {screens.map((screen) => (
            <button
              key={screen.name}
              className="screen-card"
              onClick={() => handleScreenClick(screen.name)}
            >
              <div className="screen-card-preview">
                {screen.screenshot?.downloadUrl ? (
                  <img
                    src={screen.screenshot.downloadUrl}
                    alt={screen.title || "Screen preview"}
                    loading="lazy"
                  />
                ) : (
                  <div className="screen-placeholder">
                    <span>No Preview</span>
                  </div>
                )}
              </div>
              <div className="screen-card-info">
                <h4>{screen.title || "Untitled Screen"}</h4>
                <div className="screen-card-meta">
                  {screen.deviceType && (
                    <span className="device-badge">{screen.deviceType}</span>
                  )}
                  {screen.createTime && (
                    <span>{formatDate(screen.createTime)}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
