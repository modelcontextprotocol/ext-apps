import type { ListProjectsData } from "../types";

interface ProjectListProps {
  data: ListProjectsData;
  onCallTool: (name: string, args: Record<string, unknown>) => Promise<void>;
}

export default function ProjectList({ data, onCallTool }: ProjectListProps) {
  const { projects } = data;

  const handleProjectClick = (projectName: string) => {
    const projectId = projectName.replace("projects/", "");
    void onCallTool("list-screens", { projectId });
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

  if (projects.length === 0) {
    return (
      <div className="view-container">
        <div className="view-header">
          <h2>Projects</h2>
        </div>
        <div className="empty-state">
          <h3>No projects found</h3>
          <p>Create a new project in Stitch to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Projects</h2>
        <span className="badge">{projects.length}</span>
      </div>
      <div className="project-grid">
        {projects.map((project) => {
          const screenCount = project.screenInstances?.length ?? 0;
          return (
            <button
              key={project.name}
              className="project-card"
              onClick={() => handleProjectClick(project.name)}
            >
              <div className="project-card-thumb">
                {project.thumbnailScreenshot?.downloadUrl ? (
                  <img
                    src={project.thumbnailScreenshot.downloadUrl}
                    alt={project.title}
                    loading="lazy"
                  />
                ) : (
                  <div className="project-thumb-placeholder">
                    <span>{project.title?.charAt(0) || "P"}</span>
                  </div>
                )}
              </div>
              <div className="project-card-content">
                <h3>{project.title || "Untitled Project"}</h3>
                <div className="project-card-badges">
                  {project.deviceType && (
                    <span className="device-badge">{project.deviceType}</span>
                  )}
                  {project.designTheme && (
                    <span
                      className="theme-dot"
                      style={{
                        backgroundColor: project.designTheme.customColor,
                      }}
                      title={`${project.designTheme.colorMode} / ${project.designTheme.font}`}
                    />
                  )}
                  {screenCount > 0 && (
                    <span className="badge">
                      {screenCount} screen{screenCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div className="project-card-meta">
                  <span>Updated {formatDate(project.updateTime)}</span>
                </div>
              </div>
              <div className="project-card-arrow">&rsaquo;</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
