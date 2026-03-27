import { spawn } from "node:child_process";
import process from "node:process";
import { type MenuItem, palette as c, selectMenu } from "./tui.js";

type Subcommand = "mc" | "loop" | "update" | "planner";

type SubcommandConfig = {
  key: Subcommand;
  label: string;
  file: string;
  aliases: string[];
  description: string;
};

const SUBCOMMANDS: SubcommandConfig[] = [
  {
    key: "mc",
    label: "Mission Control",
    file: "./scripts/ralph-mission-control.ts",
    aliases: ["mission-control", "ralph-mc"],
    description: "Inspect mission text and latest reports/plans.",
  },
  {
    key: "loop",
    label: "Execution Loop",
    file: "./scripts/ralph-loop.ts",
    aliases: ["ralph-loop"],
    description: "Run selected plans through the Codex execution loop.",
  },
  {
    key: "update",
    label: "Mission Update",
    file: "./scripts/ralph-update.ts",
    aliases: ["ralph-update", "ru"],
    description: "Update current-mission ordering in mission control.",
  },
  {
    key: "planner",
    label: "Plan Manager",
    file: "./scripts/ralph-planner.ts",
    aliases: ["ralph-planner"],
    description: "List and remove plan files from the plans directory.",
  },
];

function commandConfig(command: string): SubcommandConfig | undefined {
  const normalized = command.toLowerCase().replace(/^--/, "");
  return SUBCOMMANDS.find(
    (entry) => entry.key === normalized || entry.aliases.includes(normalized),
  );
}

async function runSubcommand(file: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", file, ...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal ? `${signal}` : `code ${code ?? 1}`;
      reject(new Error(`Command exited with ${reason}`));
    });
  });
}

function usage(): void {
  console.log(`\n${c.purpleBold}Ralph${c.reset} — mission runner toolkit\n`);
  console.log(`${c.dim}Usage:${c.reset}`);
  console.log(`  ${c.dim}pnpm run ralph -- <command> [args]${c.reset}`);
  console.log(`  ${c.dim}pnpm run ralph${c.reset}  ${c.dim}(interactive mode)${c.reset}\n`);
  console.log(`${c.dim}Commands:${c.reset}`);
  for (const command of SUBCOMMANDS) {
    const aliases = [command.key, ...command.aliases].sort().join(", ");
    console.log(`  ${c.magenta}${aliases}${c.reset}: ${command.description}`);
  }
}

async function promptForCommand(): Promise<SubcommandConfig | null> {
  const items: MenuItem[] = SUBCOMMANDS.map((cmd) => ({
    label: cmd.label,
    value: cmd.key,
    description: cmd.description,
  }));

  const selected = await selectMenu(items, { title: "Ralph" });
  if (selected === -1) return null;
  return SUBCOMMANDS[selected];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--"));
  if (args.length === 0) {
    const selection = await promptForCommand();
    if (!selection) {
      return;
    }
    await runSubcommand(selection.file, []);
    return;
  }

  if (args[0] === "-h" || args[0] === "--help") {
    usage();
    return;
  }

  const command = commandConfig(args[0]);
  if (!command) {
    console.error(`${c.red}Unknown command:${c.reset} ${args[0]}`);
    usage();
    process.exitCode = 1;
    return;
  }

  await runSubcommand(command.file, args.slice(1));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`${c.red}${message}${c.reset}`);
  process.exitCode = 1;
});
