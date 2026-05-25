import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ICredentialDataDecryptedObject, IDataObject, INodeProperties } from 'n8n-workflow';

export type SshPrivateKeyCredentials = ICredentialDataDecryptedObject & {
  host?: string;
  username?: string;
  port?: number;
  privateKey?: string;
  passphrase?: string;
};

export type TemporaryPrivateKey = {
  path: string;
  cleanup: () => void;
};

export type RsyncResult = {
  exitCode: number;
  spawnError?: string;
  spawnErrorCode?: string;
  stdoutLines: string[];
  stderrLines: string[];
  omittedStdoutLineCount: number;
  omittedStderrLineCount: number;
  timedOut: boolean;
};

const maxStoredLines = 250;

export const commonRsyncProperties: INodeProperties[] = [
  {
    displayName: 'Strict Host Key Checking',
    name: 'strictHostKeyChecking',
    type: 'options',
    options: [
      {
        name: 'Accept New',
        value: 'accept-new',
      },
      {
        name: 'Yes',
        value: 'yes',
      },
      {
        name: 'No',
        value: 'no',
      },
    ],
    default: 'accept-new',
    description: 'SSH StrictHostKeyChecking value',
  },
  {
    displayName: 'Additional SSH Options',
    name: 'additionalSshOptions',
    type: 'string',
    typeOptions: {
      rows: 4,
    },
    default: '',
    placeholder: 'UserKnownHostsFile=/home/node/.ssh/known_hosts',
    description: 'Optional SSH -o KEY=VALUE lines',
  },
  {
    displayName: 'Archive Mode',
    name: 'archiveMode',
    type: 'boolean',
    default: true,
    description: 'Whether to pass -a to rsync',
  },
  {
    displayName: 'Compress',
    name: 'compress',
    type: 'boolean',
    default: true,
    description: 'Whether to pass -z to rsync',
  },
  {
    displayName: 'Delete Extra Files',
    name: 'deleteExtraFiles',
    type: 'boolean',
    default: false,
    description: 'Whether to delete files at the destination that do not exist at the source',
  },
  {
    displayName: 'Dry Run',
    name: 'dryRun',
    type: 'boolean',
    default: false,
    description: 'Whether to pass --dry-run to rsync',
  },
  {
    displayName: 'Exclude Patterns',
    name: 'excludePatterns',
    type: 'string',
    typeOptions: {
      rows: 4,
    },
    default: '',
    placeholder: '*.tmp\nnode_modules',
    description: 'Optional rsync exclude patterns, one per line',
  },
  {
    displayName: 'Rsync Binary',
    name: 'rsyncBinary',
    type: 'string',
    default: 'rsync',
    description: 'rsync binary name or absolute path',
  },
  {
    displayName: 'Command Timeout',
    name: 'commandTimeoutSeconds',
    type: 'number',
    default: 3600,
    typeOptions: {
      minValue: 1,
      maxValue: 86400,
    },
    description: 'Maximum number of seconds the rsync command may run',
  },
  {
    displayName: 'Additional Arguments',
    name: 'additionalArguments',
    type: 'string',
    typeOptions: {
      rows: 2,
    },
    default: '',
    placeholder: '--partial --info=progress2',
    description: 'Optional extra arguments passed directly to rsync',
  },
];

export function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function splitCommandLine(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const char of value) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += '\\';
  }

  if (quote) {
    throw new Error('Additional arguments contain an unterminated quoted string.');
  }

  if (current) {
    args.push(current);
  }

  return args;
}

export function buildRemotePath(credentials: SshPrivateKeyCredentials, remotePath: string): string {
  const host = String(credentials.host ?? '').trim();
  const user = String(credentials.username ?? '').trim();
  const path = remotePath.trim();

  if (!host) {
    throw new Error('Rsync SSH credential is missing a host.');
  }

  if (!user) {
    throw new Error('SSH Private Key credential is missing a username.');
  }

  if (!path) {
    throw new Error('Remote path is required.');
  }

  return `${user}@${host}:${path}`;
}

function formatPrivateKey(privateKey: string): string {
  let formattedPrivateKey = privateKey
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  const oneLineKeyMatch = formattedPrivateKey.match(
    /^(-----BEGIN [^-]+PRIVATE KEY-----)\s*([A-Za-z0-9+/=\s]+?)\s*(-----END [^-]+PRIVATE KEY-----)$/s,
  );

  if (oneLineKeyMatch) {
    const [, header, body, footer] = oneLineKeyMatch;
    const bodyLines = body.replace(/\s+/g, '').match(/.{1,70}/g) ?? [];
    formattedPrivateKey = [header, ...bodyLines, footer].join('\n');
  }

  return `${formattedPrivateKey}\n`;
}

function assertPrivateKeyLooksValid(privateKey: string) {
  if (!/-----BEGIN [^-]+PRIVATE KEY-----/.test(privateKey)) {
    throw new Error(
      'SSH Private Key credential does not contain a private key block. Expected a value like "-----BEGIN OPENSSH PRIVATE KEY-----".',
    );
  }

  if (!/-----END [^-]+PRIVATE KEY-----/.test(privateKey)) {
    throw new Error('SSH Private Key credential is missing the private key footer.');
  }
}

export function createTemporaryPrivateKey(credentials: SshPrivateKeyCredentials): TemporaryPrivateKey {
  const privateKey = formatPrivateKey(String(credentials.privateKey ?? ''));
  const passphrase = String(credentials.passphrase ?? '');

  if (!privateKey.trim()) {
    throw new Error('SSH Private Key credential is missing a private key.');
  }

  assertPrivateKeyLooksValid(privateKey);

  if (passphrase) {
    throw new Error('Passphrase-protected SSH keys are not supported by the rsync nodes.');
  }

  const directory = mkdtempSync(join(tmpdir(), 'n8n-rsync-'));
  const path = join(directory, 'id_key');

  writeFileSync(path, privateKey, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);

  return {
    path,
    cleanup: () => {
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

export function buildSshCommand(
  credentials: SshPrivateKeyCredentials,
  identityFile: string,
  strictHostKeyChecking: string,
  additionalSshOptions: string,
): string {
  const args = ['ssh'];
  const port = Number(credentials.port ?? 22);
  const normalizedStrictHostKeyChecking = strictHostKeyChecking.trim();

  args.push('-p', String(port));
  args.push('-i', identityFile, '-o', 'IdentitiesOnly=yes');

  if (normalizedStrictHostKeyChecking) {
    args.push('-o', `StrictHostKeyChecking=${normalizedStrictHostKeyChecking}`);
  }

  for (const option of splitLines(additionalSshOptions)) {
    args.push('-o', option);
  }

  return args.join(' ');
}

export function buildBaseArgs(
  archiveMode: boolean,
  compress: boolean,
  deleteExtraFiles: boolean,
  dryRun: boolean,
  excludePatterns: string[],
  additionalArguments: string[],
): string[] {
  const args = ['--human-readable', '--itemize-changes', '--stats'];

  if (archiveMode) {
    args.push('-a');
  }

  if (compress) {
    args.push('-z');
  }

  if (deleteExtraFiles) {
    args.push('--delete');
  }

  if (dryRun) {
    args.push('--dry-run');
  }

  for (const pattern of excludePatterns) {
    args.push('--exclude', pattern);
  }

  args.push(...additionalArguments);

  return args;
}

export function runRsync(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<RsyncResult> {
  return new Promise((resolve) => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let omittedStdoutLineCount = 0;
    let omittedStderrLineCount = 0;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(binary, args, {
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    function storeLine(lines: string[], line: string, incrementOmitted: () => void) {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return;
      }

      if (lines.length < maxStoredLines) {
        lines.push(trimmedLine);
        return;
      }

      incrementOmitted();
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        storeLine(stdoutLines, line, () => {
          omittedStdoutLineCount += 1;
        });
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';

      for (const line of lines) {
        storeLine(stderrLines, line, () => {
          omittedStderrLineCount += 1;
        });
      }
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: 1,
        spawnError: error.message,
        spawnErrorCode: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
        stdoutLines,
        stderrLines: [...stderrLines, error.message],
        omittedStdoutLineCount,
        omittedStderrLineCount,
        timedOut,
      });
    });

    child.once('close', (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      storeLine(stdoutLines, stdoutBuffer, () => {
        omittedStdoutLineCount += 1;
      });
      storeLine(stderrLines, stderrBuffer, () => {
        omittedStderrLineCount += 1;
      });

      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        stdoutLines,
        stderrLines,
        omittedStdoutLineCount,
        omittedStderrLineCount,
        timedOut,
      });
    });
  });
}

export function resultToJson(
  operation: 'pull' | 'push',
  command: string,
  args: string[],
  source: string,
  destination: string,
  result: RsyncResult,
): IDataObject {
  return {
    operation,
    status: 'completed',
    command,
    arguments: args,
    spawnError: result.spawnError,
    spawnErrorCode: result.spawnErrorCode,
    source,
    destination,
    stdout: result.stdoutLines,
    stderr: result.stderrLines.length > 0 ? result.stderrLines : undefined,
    omittedStdoutLineCount: result.omittedStdoutLineCount || undefined,
    omittedStderrLineCount: result.omittedStderrLineCount || undefined,
    timedOut: result.timedOut,
  };
}
