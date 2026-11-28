import {
  Activity, ArrowDown, ArrowRight, ArrowUp, Ban, BookOpen, Boxes, Bot, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft,
  ChevronsRight, ChevronsUpDown, CircleCheck, CircleHelp, CirclePause, CircleSlash, Clock, Code, Coins, Columns3, Compass, Copy,
  Cpu, DatabaseZap, Download, Ellipsis, Feather, FilePen, FilePlus, FileText, FolderGit2, FolderOpen, FolderSearch, FunnelX,
  Gauge, Gem, GitBranch, Globe, Group, Hammer, Inbox, Layers, LayoutDashboard, Leaf, ListFilter, ListTodo, LoaderCircle, Lock,
  MessageSquare, MessagesSquare, Monitor, Moon, NotebookPen, OctagonX, PenLine, Plug, Radio, RotateCcw, Rows3, Rows4, Scissors,
  Crown, Pencil, Search, SearchX, ShieldCheck, Shrink, SlidersHorizontal, SquareTerminal, Sun, Telescope, TextSearch, Timer, TriangleAlert, UserCog, UserRound, Users,
  WifiOff, Workflow, Wrench, X, Zap, type LucideIcon,
} from "lucide-react";
import type { ModelFamily, TierKey } from "./model.tier.ts";

/** Icon per model family. */
export const FAMILY_ICON: Record<ModelFamily, LucideIcon> = { opus: Gem, sonnet: Feather, haiku: Leaf, fable: BookOpen, other: Cpu };
/** Icon per tier (think/work/basic/other). */
export const TIER_ICON: Record<TierKey, LucideIcon> = { think: Brain, work: Hammer, basic: Zap, other: CircleHelp };
/** Icon per preset role. */
export const ROLE_ICON: Record<string, LucideIcon> = {
  manager: Workflow, architect: Compass, coder: Code, reviewer: ShieldCheck, researcher: Telescope, writer: PenLine,
  main: SquareTerminal, subagent: Bot,
};
/** Icon for any non-preset (custom or built-in) role. */
export const CUSTOM_ROLE_ICON: LucideIcon = UserRound;

/** Icon per session status. */
export const STATUS_ICON = { live: Radio, idle: CirclePause, ended: CircleCheck } satisfies Record<string, LucideIcon>;
/** Icon per context level. */
export const LEVEL_ICON = { ok: Gauge, warn: TriangleAlert, danger: OctagonX } satisfies Record<string, LucideIcon>;
/** Icon per stop reason; unknown reasons fall back to CircleSlash. */
export const STOP_ICON: Record<string, LucideIcon> = {
  end_turn: CircleCheck, tool_use: Wrench, max_tokens: Scissors, refusal: Ban, stop_sequence: CircleSlash, pause_turn: CirclePause,
};

/** Navigation icons. */
export const NAV_ICON = { overview: LayoutDashboard, projects: FolderGit2, sessions: MessagesSquare, agents: UserCog, roles: Users, live: Radio };
/** KPI card icons. */
export const KPI_ICON = { cost: Coins, requests: Activity, sessions: MessagesSquare, cache: DatabaseZap, tokens: Layers, agents: Bot };
/** Table-toolkit and generic UI icons. */
export const UI_ICON = {
  project: FolderOpen, branch: GitBranch, prompt: MessageSquare, compaction: Shrink, time: Clock, duration: Timer,
  search: Search, filter: ListFilter, group: Group, view: Columns3, densityCompact: Rows4, densityComfortable: Rows3, reset: FunnelX,
  first: ChevronsLeft, prev: ChevronLeft, next: ChevronRight, last: ChevronsRight, gap: Ellipsis,
  sortAsc: ArrowUp, sortDesc: ArrowDown, sortIdle: ChevronsUpDown, collapsed: ChevronRight, expanded: ChevronDown, check: Check, remove: X,
  empty: Inbox, noMatch: SearchX, error: TriangleAlert, retry: RotateCcw, offline: WifiOff, loading: LoaderCircle,
  themeSystem: Monitor, themeLight: Sun, themeDark: Moon,
  crown: Crown, edit: Pencil, lock: Lock, copy: Copy, viewAll: ArrowRight, unpriced: CircleHelp, model: Boxes, tier: SlidersHorizontal, back: ChevronLeft,
} satisfies Record<string, LucideIcon>;

const TOOL_ICON: Record<string, LucideIcon> = {
  Read: FileText, Edit: FilePen, MultiEdit: FilePen, Write: FilePlus, NotebookEdit: NotebookPen, Bash: SquareTerminal,
  Agent: Bot, Task: Bot, WebSearch: Globe, WebFetch: Download, Grep: TextSearch, Glob: FolderSearch, TodoWrite: ListTodo,
};
const MCP_PREFIX = "mcp__";

/** Icon for a tool name: exact match, `mcp__*` → Plug, anything else → Wrench. */
export function toolIcon(name: string): LucideIcon {
  return (Object.hasOwn(TOOL_ICON, name) ? TOOL_ICON[name] : undefined) ?? (name.startsWith(MCP_PREFIX) ? Plug : Wrench);
}
