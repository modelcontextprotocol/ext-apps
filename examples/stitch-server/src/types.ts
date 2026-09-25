// Stitch API types — matches real API response shapes

export interface DesignTheme {
  colorMode: string; // "DARK" | "LIGHT"
  font: string; // "INTER" | "MANROPE" | "LEXEND" etc.
  roundness: string; // "ROUND_EIGHT" | "ROUND_TWELVE" | "ROUND_FULL"
  customColor: string; // hex e.g. "#137fec"
  saturation: number; // 1-3
}

export interface FileReference {
  name: string;
  downloadUrl: string;
}

export type ThumbnailScreenshot = FileReference;

export interface ScreenInstance {
  id: string;
  sourceScreen: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface StitchProject {
  name: string; // "projects/{id}"
  title: string;
  visibility?: string; // "PRIVATE" | "PUBLIC"
  createTime: string;
  updateTime: string;
  projectType?: string; // "TEXT_TO_UI_PRO"
  deviceType?: string; // "MOBILE" | "DESKTOP"
  origin?: string; // "STITCH"
  thumbnailScreenshot?: ThumbnailScreenshot;
  designTheme?: DesignTheme;
  screenInstances?: ScreenInstance[];
  metadata?: { userRole?: string };
}

export interface StitchScreen {
  name: string; // "projects/{pid}/screens/{sid}"
  id?: string;
  title?: string; // API returns "title", not "displayName"
  screenshot?: FileReference; // API returns { name, downloadUrl }, not imageUri
  htmlCode?: FileReference; // API returns file reference, not inline string
  cssCode?: FileReference; // same pattern
  deviceType?: string;
  theme?: DesignTheme;
  prompt?: string;
  width?: string;
  height?: string;
  screenType?: string;
  generatedBy?: string;
  createTime?: string;
  updateTime?: string;
}

export interface ColorToken {
  name: string;
  hex: string;
  usage: string;
}

export interface FontToken {
  family: string;
  weight: string;
  size: string;
  usage: string;
}

export interface SpacingToken {
  name: string;
  value: string;
}

export interface LayoutInfo {
  type: string;
  description: string;
}

export interface DesignContextData {
  colors: ColorToken[];
  fonts: FontToken[];
  spacing: SpacingToken[];
  layouts: LayoutInfo[];
}

export interface CodeData {
  html: string;
  css: string;
}

// Tool result data types

export interface DesignViewerData {
  screen: StitchScreen;
  imageData: string;
  codeData: CodeData;
  designContext: DesignContextData;
}

export interface GenerateDesignData {
  screen: StitchScreen;
  allScreens?: StitchScreen[];
  imageData?: string;
  codeData?: CodeData;
  suggestions?: string[];
  prompt: string;
  autoCreatedProject?: boolean;
}

export interface CreateProjectData {
  project: StitchProject;
}

export interface ListProjectsData {
  projects: StitchProject[];
}

export interface ListScreensData {
  projectId: string;
  screens: StitchScreen[];
}

export type ToolResultData =
  | { type: "design_viewer"; data: DesignViewerData }
  | { type: "generate_design"; data: GenerateDesignData }
  | { type: "list_projects"; data: ListProjectsData }
  | { type: "list_screens"; data: ListScreensData }
  | { type: "design_context"; data: DesignContextData }
  | { type: "create_project"; data: CreateProjectData };
