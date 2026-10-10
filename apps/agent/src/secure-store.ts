import { spawn } from "node:child_process";

export interface CredentialStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  input?: string,
) => Promise<CommandResult>;

const runCommand: CommandRunner = (command, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });

function safeAccount(account: string): string {
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(account)) throw new Error("INVALID_CREDENTIAL_ACCOUNT");
  return account;
}

const windowsScript = {
  set: `
    $account=$args[0];
    $dir=Join-Path $env:LOCALAPPDATA 'PowerMesh\\credentials';
    New-Item -ItemType Directory -Force -Path $dir | Out-Null;
    $secret=[Console]::In.ReadToEnd();
    $bytes=[Text.Encoding]::UTF8.GetBytes($secret);
    $protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);
    [IO.File]::WriteAllBytes((Join-Path $dir $account),$protected);
  `,
  get: `
    $path=Join-Path (Join-Path $env:LOCALAPPDATA 'PowerMesh\\credentials') $args[0];
    if (!(Test-Path $path)) { exit 2 };
    $protected=[IO.File]::ReadAllBytes($path);
    $bytes=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes));
  `,
  delete: `
    $path=Join-Path (Join-Path $env:LOCALAPPDATA 'PowerMesh\\credentials') $args[0];
    if (Test-Path $path) { Remove-Item -Force $path }
  `,
};

export class SystemCredentialStore implements CredentialStore {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly runner: CommandRunner = runCommand,
  ) {}

  async get(account: string): Promise<string | null> {
    const key = safeAccount(account);
    let result: CommandResult;
    if (this.platform === "darwin") {
      result = await this.runner("security", [
        "find-generic-password",
        "-s",
        "PowerMesh",
        "-a",
        key,
        "-w",
      ]);
    } else if (this.platform === "win32") {
      result = await this.runner("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsScript.get,
        key,
      ]);
    } else if (this.platform === "linux") {
      result = await this.runner("secret-tool", ["lookup", "service", "PowerMesh", "account", key]);
    } else {
      throw new Error("UNSUPPORTED_CREDENTIAL_STORE");
    }
    if (result.code === 2 || (this.platform === "darwin" && result.code === 44)) return null;
    if (result.code !== 0) throw new Error("CREDENTIAL_STORE_UNAVAILABLE");
    return result.stdout.trimEnd();
  }

  async set(account: string, secret: string): Promise<void> {
    const key = safeAccount(account);
    let result: CommandResult;
    if (this.platform === "darwin") {
      result = await this.runner("security", [
        "add-generic-password",
        "-U",
        "-s",
        "PowerMesh",
        "-a",
        key,
        "-w",
        secret,
      ]);
    } else if (this.platform === "win32") {
      result = await this.runner(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", windowsScript.set, key],
        secret,
      );
    } else if (this.platform === "linux") {
      result = await this.runner(
        "secret-tool",
        ["store", "--label=PowerMesh", "service", "PowerMesh", "account", key],
        secret,
      );
    } else {
      throw new Error("UNSUPPORTED_CREDENTIAL_STORE");
    }
    if (result.code !== 0) throw new Error("CREDENTIAL_STORE_UNAVAILABLE");
  }

  async delete(account: string): Promise<void> {
    const key = safeAccount(account);
    let result: CommandResult;
    if (this.platform === "darwin") {
      result = await this.runner("security", [
        "delete-generic-password",
        "-s",
        "PowerMesh",
        "-a",
        key,
      ]);
    } else if (this.platform === "win32") {
      result = await this.runner("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsScript.delete,
        key,
      ]);
    } else if (this.platform === "linux") {
      result = await this.runner("secret-tool", ["clear", "service", "PowerMesh", "account", key]);
    } else {
      throw new Error("UNSUPPORTED_CREDENTIAL_STORE");
    }
    if (result.code !== 0 && result.code !== 1 && result.code !== 44) {
      throw new Error("CREDENTIAL_STORE_UNAVAILABLE");
    }
  }
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly secrets = new Map<string, string>();
  async get(account: string) {
    return this.secrets.get(account) ?? null;
  }
  async set(account: string, secret: string) {
    this.secrets.set(account, secret);
  }
  async delete(account: string) {
    this.secrets.delete(account);
  }
}
