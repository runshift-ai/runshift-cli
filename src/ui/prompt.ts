import * as readline from "node:readline";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(answer.trim());
    });
  });
}

export async function confirm(question: string): Promise<boolean> {
  const answer = await ask(question);
  const normalized = answer.toLowerCase();
  return normalized === "y" || normalized === "yes";
}

export async function promptChoice(question: string): Promise<"y" | "a" | "n"> {
  const answer = await ask(question);
  const normalized = answer.toLowerCase();
  if (normalized === "a" || normalized === "add") return "a";
  if (normalized === "y" || normalized === "yes") return "y";
  return "n";
}

export async function promptFilePath(question: string): Promise<string> {
  return ask(question);
}

export async function promptFileSelection(question: string): Promise<"a" | "s" | "n"> {
  const answer = await ask(question);
  const normalized = answer.toLowerCase();
  if (normalized === "a" || normalized === "accept") return "a";
  if (normalized === "s" || normalized === "select") return "s";
  return "n";
}

export function promptPreview(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(message);

    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (key: Buffer) => {
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);

      const ch = key.toString();

      // ctrl-c
      if (ch === "\x03") {
        console.log();
        process.exit(0);
      }

      if (ch.toLowerCase() === "o") {
        console.log("o\n");
        resolve(true);
      } else {
        console.log("\n");
        resolve(false);
      }
    };

    process.stdin.on("data", onData);
  });
}
