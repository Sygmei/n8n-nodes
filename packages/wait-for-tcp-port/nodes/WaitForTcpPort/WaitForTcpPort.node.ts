import { Socket } from 'node:net';
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type PortCheckResult = {
  reachable: boolean;
  attempts: number;
  elapsedMs: number;
  lastError?: string;
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function canConnect(host: string, port: number, connectionTimeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new Socket();

    function cleanup() {
      socket.removeAllListeners();
      socket.destroy();
    }

    socket.setTimeout(connectionTimeoutMs);

    socket.once('connect', () => {
      cleanup();
      resolve();
    });

    socket.once('timeout', () => {
      cleanup();
      reject(new Error(`Connection attempt timed out after ${connectionTimeoutMs} ms.`));
    });

    socket.once('error', (error) => {
      cleanup();
      reject(error);
    });

    socket.connect(port, host);
  });
}

async function waitForTcpPort(
  host: string,
  port: number,
  timeoutMs: number,
  retryIntervalMs: number,
  connectionTimeoutMs: number,
): Promise<PortCheckResult> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let attempts = 0;
  let lastError: string | undefined;

  do {
    attempts += 1;

    try {
      await canConnect(host, port, connectionTimeoutMs);

      return {
        reachable: true,
        attempts,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) {
      break;
    }

    await wait(Math.min(retryIntervalMs, remainingMs));
  } while (Date.now() <= deadline);

  return {
    reachable: false,
    attempts,
    elapsedMs: Date.now() - startedAt,
    lastError,
  };
}

export class WaitForTcpPort implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Wait for TCP Port',
    name: 'waitForTcpPort',
    icon: 'file:waitForTcpPort.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["host"] + ":" + $parameter["port"]}}',
    description: 'Wait until a TCP port accepts connections',
    defaults: {
      name: 'Wait for TCP Port',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    properties: [
      {
        displayName: 'Host',
        name: 'host',
        type: 'string',
        default: '',
        placeholder: '192.168.1.20',
        required: true,
        description: 'DNS name or IP address to connect to',
      },
      {
        displayName: 'Port',
        name: 'port',
        type: 'number',
        default: 22,
        typeOptions: {
          minValue: 1,
          maxValue: 65535,
        },
        description: 'TCP port to check',
      },
      {
        displayName: 'Timeout',
        name: 'timeoutSeconds',
        type: 'number',
        default: 120,
        typeOptions: {
          minValue: 1,
          maxValue: 86400,
        },
        description: 'Maximum number of seconds to wait before timing out',
      },
      {
        displayName: 'Retry Interval',
        name: 'retryIntervalMs',
        type: 'number',
        default: 1000,
        typeOptions: {
          minValue: 100,
          maxValue: 60000,
        },
        description: 'Delay in milliseconds between connection attempts',
      },
      {
        displayName: 'Connection Timeout',
        name: 'connectionTimeoutMs',
        type: 'number',
        default: 1000,
        typeOptions: {
          minValue: 100,
          maxValue: 60000,
        },
        description: 'Milliseconds to wait before one connection attempt is considered failed',
      },
      {
        displayName: 'Timeout Behavior',
        name: 'timeoutBehavior',
        type: 'options',
        options: [
          {
            name: 'Throw Error',
            value: 'throw',
          },
          {
            name: 'Return Timeout Status',
            value: 'returnStatus',
          },
        ],
        default: 'throw',
        description: 'What to do if the port does not become reachable before the timeout',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const host = this.getNodeParameter('host', itemIndex) as string;
      const port = this.getNodeParameter('port', itemIndex) as number;
      const timeoutSeconds = this.getNodeParameter('timeoutSeconds', itemIndex) as number;
      const retryIntervalMs = this.getNodeParameter('retryIntervalMs', itemIndex) as number;
      const connectionTimeoutMs = this.getNodeParameter('connectionTimeoutMs', itemIndex) as number;
      const timeoutBehavior = this.getNodeParameter('timeoutBehavior', itemIndex) as string;

      try {
        const result = await waitForTcpPort(
          host.trim(),
          port,
          timeoutSeconds * 1000,
          retryIntervalMs,
          connectionTimeoutMs,
        );

        if (!result.reachable && timeoutBehavior === 'throw') {
          throw new Error(
            `TCP port ${host}:${port} did not become reachable within ${timeoutSeconds} seconds.`,
          );
        }

        returnData.push({
          json: {
            ...items[itemIndex].json,
            waitForTcpPort: {
              host,
              port,
              status: result.reachable ? 'reachable' : 'timeout',
              reachable: result.reachable,
              attempts: result.attempts,
              elapsedMs: result.elapsedMs,
              lastError: result.lastError,
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
              ...items[itemIndex].json,
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
