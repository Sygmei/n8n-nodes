import { spawn } from 'node:child_process';
import type {
  ICredentialDataDecryptedObject,
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type ResticCredentials = ICredentialDataDecryptedObject & {
  repository?: string;
  password?: string;
  passwordFile?: string;
  sftpCommand?: string;
  environmentVariables?: string;
};

type ResticCommandResult = {
  exitCode: number;
  stderr: string;
  timedOut: boolean;
  messages: IDataObject[];
  unparsedLines: string[];
  latestStatus?: IDataObject;
  summary?: IDataObject;
  omittedMessageCount: number;
};

const maxStoredMessages = 250;

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitList(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCommandLine(value: string): string[] {
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

function parseEnvironmentVariables(value: string): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const line of splitLines(value)) {
    const separatorIndex = line.indexOf('=');

    if (separatorIndex <= 0) {
      throw new Error(`Invalid environment variable "${line}". Expected KEY=VALUE.`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const variableValue = line.slice(separatorIndex + 1);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name "${key}".`);
    }

    environment[key] = variableValue;
  }

  return environment;
}

function runRestic(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<ResticCommandResult> {
  return new Promise((resolve) => {
    const messages: IDataObject[] = [];
    const unparsedLines: string[] = [];
    const stderrLines: string[] = [];
    let latestStatus: IDataObject | undefined;
    let summary: IDataObject | undefined;
    let omittedMessageCount = 0;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;
    let timedOut = false;

    const child = spawn(binary, args, {
      env,
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    function storeMessage(message: IDataObject) {
      if (message.message_type === 'status') {
        latestStatus = message;
      }

      if (message.message_type === 'summary') {
        summary = message;
      }

      if (messages.length < maxStoredMessages) {
        messages.push(message);
        return;
      }

      omittedMessageCount += 1;
    }

    function handleStdoutLine(line: string) {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return;
      }

      try {
        storeMessage(JSON.parse(trimmedLine) as IDataObject);
      } catch {
        unparsedLines.push(trimmedLine);
      }
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        handleStdoutLine(line);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.trim()) {
          stderrLines.push(line.trim());
        }
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
        stderr: error.message,
        timedOut,
        messages,
        unparsedLines,
        latestStatus,
        summary,
        omittedMessageCount,
      });
    });

    child.once('close', (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      handleStdoutLine(stdoutBuffer);

      if (stderrBuffer.trim()) {
        stderrLines.push(stderrBuffer.trim());
      }

      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        stderr: stderrLines.join('\n'),
        timedOut,
        messages,
        unparsedLines,
        latestStatus,
        summary,
        omittedMessageCount,
      });
    });
  });
}

export class ResticBackup implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Restic Backup',
    name: 'resticBackup',
    icon: 'file:resticBackup.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["paths"]}}',
    description: 'Run a Restic backup command',
    defaults: {
      name: 'Restic Backup',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: 'resticRepository',
        required: true,
      },
    ],
    usableAsTool: true,
    properties: [
      {
        displayName: 'Paths',
        name: 'paths',
        type: 'string',
        typeOptions: {
          rows: 4,
        },
        default: '',
        placeholder: '/data\n/home/node/.n8n',
        required: true,
        description: 'Local paths to back up, one per line',
      },
      {
        displayName: 'Tags',
        name: 'tags',
        type: 'string',
        typeOptions: {
          rows: 2,
        },
        default: '',
        placeholder: 'n8n, daily',
        description: 'Optional comma or newline-separated Restic tags',
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
        description: 'Optional Restic exclude patterns, one per line',
      },
      {
        displayName: 'Hostname',
        name: 'hostname',
        type: 'string',
        default: '',
        description: 'Optional Restic host override passed with --host',
      },
      {
        displayName: 'Restic Binary',
        name: 'resticBinary',
        type: 'string',
        default: 'restic',
        description: 'Restic binary name or absolute path',
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
        description: 'Maximum number of seconds the backup command may run',
      },
      {
        displayName: 'Additional Arguments',
        name: 'additionalArguments',
        type: 'string',
        typeOptions: {
          rows: 2,
        },
        default: '',
        placeholder: '--one-file-system --compression max',
        description: 'Optional extra arguments passed directly to restic backup',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const paths = splitLines(this.getNodeParameter('paths', itemIndex) as string);
      const tags = splitList(this.getNodeParameter('tags', itemIndex) as string);
      const excludePatterns = splitLines(this.getNodeParameter('excludePatterns', itemIndex) as string);
      const hostname = (this.getNodeParameter('hostname', itemIndex) as string).trim();
      const resticBinary = (this.getNodeParameter('resticBinary', itemIndex) as string).trim();
      const commandTimeoutSeconds = this.getNodeParameter('commandTimeoutSeconds', itemIndex) as number;
      const additionalArguments = splitCommandLine(
        this.getNodeParameter('additionalArguments', itemIndex) as string,
      );

      try {
        if (paths.length === 0) {
          throw new Error('At least one backup path is required.');
        }

        if (!resticBinary) {
          throw new Error('Restic binary is required.');
        }

        const credentials = await this.getCredentials<ResticCredentials>('resticRepository', itemIndex);
        const repository = String(credentials.repository ?? '').trim();
        const password = String(credentials.password ?? '');
        const passwordFile = String(credentials.passwordFile ?? '').trim();
        const sftpCommand = String(credentials.sftpCommand ?? '').trim();

        if (!repository) {
          throw new Error('Restic repository credential is missing a repository.');
        }

        if (!password && !passwordFile) {
          throw new Error('Restic repository credential must provide a password or password file.');
        }

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          ...parseEnvironmentVariables(String(credentials.environmentVariables ?? '')),
          RESTIC_REPOSITORY: repository,
        };

        if (passwordFile) {
          env.RESTIC_PASSWORD_FILE = passwordFile;
        } else {
          env.RESTIC_PASSWORD = password;
        }

        const args = [];

        if (sftpCommand) {
          args.push('-o', `sftp.command=${sftpCommand}`);
        }

        args.push('backup', '--json');

        for (const tag of tags) {
          args.push('--tag', tag);
        }

        for (const excludePattern of excludePatterns) {
          args.push('--exclude', excludePattern);
        }

        if (hostname) {
          args.push('--host', hostname);
        }

        args.push(...additionalArguments, ...paths);

        const result = await runRestic(
          resticBinary,
          args,
          env,
          commandTimeoutSeconds * 1000,
        );

        if (result.exitCode !== 0) {
          const details = [
            result.stderr.trim(),
            result.unparsedLines.length > 0
              ? `stdout: ${result.unparsedLines.join('\n')}`
              : '',
            result.latestStatus
              ? `latest status: ${JSON.stringify(result.latestStatus)}`
              : '',
          ]
            .filter(Boolean)
            .join('\n');

          throw new Error(
            `restic backup failed with exit code ${result.exitCode}.${details ? ` ${details}` : ''}`,
          );
        }

        returnData.push({
          json: {
            resticBackup: {
              status: 'completed',
              repository,
              paths,
              tags,
              excludes: excludePatterns,
              hostname: hostname || undefined,
              command: resticBinary,
              arguments: args,
              sftpCommand: sftpCommand || undefined,
              summary: result.summary,
              latestStatus: result.latestStatus,
              messages: result.messages,
              omittedMessageCount: result.omittedMessageCount || undefined,
              unparsedOutput: result.unparsedLines.length > 0
                ? result.unparsedLines
                : undefined,
              stderr: result.stderr.trim() || undefined,
              timedOut: result.timedOut,
            },
          },
          pairedItem: {
            item: itemIndex,
          },
        });
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: {
              error: error instanceof Error ? error.message : String(error),
            },
            pairedItem: {
              item: itemIndex,
            },
          });
          continue;
        }

        throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
      }
    }

    return [returnData];
  }
}
