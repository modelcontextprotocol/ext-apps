import { useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { ToolResultData } from "./types";
import ProjectList from "./components/ProjectList";
import ScreenList from "./components/ScreenList";
import DesignViewer from "./components/DesignViewer";
import GenerateDesign from "./components/GenerateDesign";
import DesignContext from "./components/DesignContext";

export default function StitchApp() {
  const [currentView, setCurrentView] = useState<ToolResultData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { app, error: appError } = useApp({
    appInfo: {
      name: "Stitch Design",
      version: "1.0.0",
    },
    capabilities: {},
    onAppCreated: (createdApp) => {
      createdApp.ontoolresult = async (result) => {
        setLoading(false);

        if (result.content) {
          for (const item of result.content) {
            if (item.type === "text" && item.text) {
              try {
                const data = JSON.parse(item.text);
                if (data.type === "error") {
                  setError(data.data?.message || "An unknown error occurred");
                  return;
                }
                if (data.type && data.data) {
                  setCurrentView(data as ToolResultData);
                  setError(null);
                }
              } catch {
                // Non-JSON text, ignore
              }
            }
          }
        }
      };

      createdApp.ontoolinput = (_input) => {
        setLoading(true);
        setError(null);
      };

      createdApp.onerror = (err) => {
        console.error("App error:", err);
        setError(err.message || "An error occurred");
        setLoading(false);
      };

      createdApp.onhostcontextchanged = (context) => {
        if (context.theme) {
          document.documentElement.dataset.theme = context.theme;
        }
      };
    },
  });

  if (appError) {
    return (
      <div className="error-container">
        <h2>Connection Error</h2>
        <p>{appError.message}</p>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <p>Connecting to Stitch Design...</p>
      </div>
    );
  }

  const handleNavigate = (view: ToolResultData) => {
    setCurrentView(view);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={() => setError(null)}>
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="stitch-app">
      {renderView(currentView, app, handleNavigate, setLoading, setError)}
    </div>
  );
}

function renderView(
  view: ToolResultData | null,
  app: App,
  onNavigate: (view: ToolResultData) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string | null) => void,
) {
  if (!view) {
    return (
      <div className="empty-state">
        <h2>Stitch Design Agent</h2>
        <p>Waiting for a design command...</p>
        <p className="hint">
          Try asking to list projects, view a screen, or generate a new design.
        </p>
      </div>
    );
  }

  const callTool = async (name: string, args: Record<string, unknown>) => {
    setLoading(true);
    try {
      const result = await app.callServerTool({ name, arguments: args });
      const textContent = result.content?.find((c) => c.type === "text");
      if (textContent && textContent.type === "text" && textContent.text) {
        const data = JSON.parse(textContent.text);
        if (data.type === "error") {
          setError(data.data?.message || "An unknown error occurred");
          return;
        }
        if (data.type && data.data) {
          onNavigate(data as ToolResultData);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tool call failed");
    } finally {
      setLoading(false);
    }
  };

  switch (view.type) {
    case "list_projects":
      return <ProjectList data={view.data} onCallTool={callTool} />;
    case "list_screens":
      return <ScreenList data={view.data} onCallTool={callTool} />;
    case "design_viewer":
      return <DesignViewer data={view.data} app={app} onCallTool={callTool} />;
    case "generate_design":
      return (
        <GenerateDesign data={view.data} app={app} onCallTool={callTool} />
      );
    case "design_context":
      return <DesignContext data={view.data} />;
    case "create_project":
      return (
        <div className="view-container">
          <div className="view-header">
            <h2>Project Created</h2>
          </div>
          <div className="empty-state">
            <h3>{view.data.project.title}</h3>
            <p>
              Project created successfully. You can now generate screens in it.
            </p>
          </div>
        </div>
      );
    default:
      return <div className="empty-state">Unknown view</div>;
  }
}
