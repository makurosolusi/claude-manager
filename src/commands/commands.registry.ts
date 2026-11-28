import type { Command } from "./command.types.ts";
import { dashboardCommand } from "./dashboard.command.ts";
import { doctorCommand } from "./doctor.command.ts";
import { installCommand } from "./install.command.ts";
import { policyCommand } from "./policy.command.ts";
import { rolesCommand } from "./roles.command.ts";
import { statsCommand } from "./stats.command.ts";
import { syncCommand } from "./sync.command.ts";
import { tierCommand } from "./tier.command.ts";
import { uninstallCommand } from "./uninstall.command.ts";
import { updateCommand } from "./update.command.ts";

export const commands: Command[] = [
  installCommand,
  uninstallCommand,
  rolesCommand,
  tierCommand,
  policyCommand,
  syncCommand,
  statsCommand,
  dashboardCommand,
  doctorCommand,
  updateCommand,
];
