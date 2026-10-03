import {
  AtSignIcon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  BriefcaseIcon,
  CalculatorIcon,
  CameraIcon,
  ChartLineIcon,
  CodeIcon,
  DatabaseIcon,
  FilmIcon,
  FlaskConicalIcon,
  FolderIcon,
  Gamepad2Icon,
  GlobeIcon,
  GraduationCapIcon,
  HeartIcon,
  HouseIcon,
  InboxIcon,
  LeafIcon,
  MusicIcon,
  NotebookPenIcon,
  PaletteIcon,
  PenToolIcon,
  PlaneIcon,
  RocketIcon,
  ServerIcon,
  ShoppingBagIcon,
  SmartphoneIcon,
  SparklesIcon,
  StarIcon,
  TerminalIcon,
  WrenchIcon,
} from "@lucide/vue";
import type { Component } from "vue";
import {
  isTemporaryWorkspace,
  type PineProject,
  type ProjectIcon,
} from "@/shared/projects";

export const PROJECT_ICON_COMPONENTS: Record<ProjectIcon, Component> = {
  inbox: InboxIcon,
  folder: FolderIcon,
  code: CodeIcon,
  terminal: TerminalIcon,
  database: DatabaseIcon,
  server: ServerIcon,
  globe: GlobeIcon,
  smartphone: SmartphoneIcon,
  rocket: RocketIcon,
  bot: BotIcon,
  brain: BrainIcon,
  "flask-conical": FlaskConicalIcon,
  "book-open": BookOpenIcon,
  "notebook-pen": NotebookPenIcon,
  "graduation-cap": GraduationCapIcon,
  briefcase: BriefcaseIcon,
  "chart-line": ChartLineIcon,
  calculator: CalculatorIcon,
  palette: PaletteIcon,
  "pen-tool": PenToolIcon,
  camera: CameraIcon,
  film: FilmIcon,
  music: MusicIcon,
  "gamepad-2": Gamepad2Icon,
  house: HouseIcon,
  heart: HeartIcon,
  leaf: LeafIcon,
  plane: PlaneIcon,
  "shopping-bag": ShoppingBagIcon,
  wrench: WrenchIcon,
  star: StarIcon,
  sparkles: SparklesIcon,
};

/**
 * The icon a project shows. No Project shows "@", the key that chooses a
 * project in the composer.
 */
export function projectIconComponent(
  project: Pick<PineProject, "id" | "projectIcon"> | null | undefined,
): Component {
  if (!project) return InboxIcon;
  if (isTemporaryWorkspace(project.id)) return AtSignIcon;
  return PROJECT_ICON_COMPONENTS[project.projectIcon ?? "inbox"] ?? InboxIcon;
}
