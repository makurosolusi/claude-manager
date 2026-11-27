export interface Command {
  name: string;
  summary: string;
  usage: string;
  run(args: string[]): Promise<number> | number;
}
