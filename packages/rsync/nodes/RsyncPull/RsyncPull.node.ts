import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
  buildBaseArgs,
  buildRemotePath,
  buildSshCommand,
  commonRsyncProperties,
  resultToJson,
  runRsync,
  splitCommandLine,
  splitLines,
  type RsyncSshCredentials,
} from '../shared/rsync';

export class RsyncPull implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Rsync Pull',
    name: 'rsyncPull',
    icon: 'file:rsyncPull.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["remotePath"] + " -> " + $parameter["localPath"]}}',
    description: 'Pull files from a remote host using rsync over SSH',
    defaults: {
      name: 'Rsync Pull',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: 'rsyncSsh',
        required: true,
      },
    ],
    usableAsTool: true,
    properties: [
      {
        displayName: 'Remote Path',
        name: 'remotePath',
        type: 'string',
        default: '',
        placeholder: '/remote/path/',
        required: true,
        description: 'Remote source path. Add a trailing slash to copy the contents of a directory.',
      },
      {
        displayName: 'Local Path',
        name: 'localPath',
        type: 'string',
        default: '',
        placeholder: '/local/path/',
        required: true,
        description: 'Local destination path visible to the n8n container',
      },
      ...commonRsyncProperties,
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      try {
        const credentials = await this.getCredentials<RsyncSshCredentials>('rsyncSsh', itemIndex);
        const remotePath = this.getNodeParameter('remotePath', itemIndex) as string;
        const localPath = (this.getNodeParameter('localPath', itemIndex) as string).trim();
        const rsyncBinary = (this.getNodeParameter('rsyncBinary', itemIndex) as string).trim();
        const commandTimeoutSeconds = this.getNodeParameter('commandTimeoutSeconds', itemIndex) as number;
        const source = buildRemotePath(credentials, remotePath);

        if (!localPath) {
          throw new Error('Local path is required.');
        }

        if (!rsyncBinary) {
          throw new Error('Rsync binary is required.');
        }

        const args = buildBaseArgs(
          this.getNodeParameter('archiveMode', itemIndex) as boolean,
          this.getNodeParameter('compress', itemIndex) as boolean,
          this.getNodeParameter('deleteExtraFiles', itemIndex) as boolean,
          this.getNodeParameter('dryRun', itemIndex) as boolean,
          splitLines(this.getNodeParameter('excludePatterns', itemIndex) as string),
          splitCommandLine(this.getNodeParameter('additionalArguments', itemIndex) as string),
        );

        args.push('-e', buildSshCommand(credentials), source, localPath);

        const result = await runRsync(rsyncBinary, args, commandTimeoutSeconds * 1000);

        if (result.exitCode !== 0) {
          throw new Error(
            `rsync pull failed with exit code ${result.exitCode}.${result.stderrLines.length > 0 ? ` ${result.stderrLines.join('\n')}` : ''}`,
          );
        }

        returnData.push({
          json: {
            rsyncPull: resultToJson('pull', rsyncBinary, args, source, localPath, result),
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
