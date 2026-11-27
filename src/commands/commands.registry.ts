import type { Command } from "./command.types.ts";
import { doctorCommand } from "./doctor.command.ts";
import { installCommand } from "./install.command.ts";
import { rolesCommand } from "./roles.command.ts";
import { tierCommand } from "./tier.command.ts";
import { uninstallCommand } from "./uninstall.command.ts";

export const commands: Command[] = [installCommand, uninstallCommand, rolesCommand, tierCommand, doctorCommand];
