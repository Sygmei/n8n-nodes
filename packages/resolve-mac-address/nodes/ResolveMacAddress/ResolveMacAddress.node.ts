import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type CommandResult = {
  stdout: string;
  stderr: string;
};

type NetworkDetails = {
  interfaceName: string;
  interfaceAddress: string;
  netmask: string;
  prefixLength: number;
  networkAddress: string;
  broadcastAddress: string;
};

const macAddressPattern = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i;

function ipv4ToNumber(ipAddress: string): number {
  return ipAddress
    .split('.')
    .reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
}

function numberToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function prefixLengthFromNetmask(netmask: string): number {
  const netmaskNumber = ipv4ToNumber(netmask);
  let prefixLength = 0;

  for (let bit = 31; bit >= 0; bit -= 1) {
    if ((netmaskNumber & (1 << bit)) === 0) {
      break;
    }

    prefixLength += 1;
  }

  return prefixLength;
}

function getNetworkDetails(ipAddress: string): NetworkDetails | undefined {
  const targetAddress = ipv4ToNumber(ipAddress);

  for (const [interfaceName, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) {
        continue;
      }

      const interfaceAddress = ipv4ToNumber(address.address);
      const netmask = ipv4ToNumber(address.netmask);
      const networkAddress = interfaceAddress & netmask;

      if ((targetAddress & netmask) !== networkAddress) {
        continue;
      }

      const broadcastAddress = networkAddress | (~netmask >>> 0);

      return {
        interfaceName,
        interfaceAddress: address.address,
        netmask: address.netmask,
        prefixLength: prefixLengthFromNetmask(address.netmask),
        networkAddress: numberToIpv4(networkAddress),
        broadcastAddress: numberToIpv4(broadcastAddress),
      };
    }
  }

  return undefined;
}

function normalizeMacAddress(macAddress: string): string {
  return macAddress.replace(/-/g, ':').toUpperCase();
}

function parseMacAddress(output: string): string | undefined {
  const match = output.match(macAddressPattern);

  return match ? normalizeMacAddress(match[0]) : undefined;
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

async function resolveIpv4Address(host: string): Promise<string> {
  const trimmedHost = host.trim();

  if (isIP(trimmedHost) === 4) {
    return trimmedHost;
  }

  const result = await lookup(trimmedHost, { family: 4 });

  return result.address;
}

async function probeHost(ipAddress: string, timeoutMs: number): Promise<void> {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));

  if (process.platform === 'win32') {
    await runCommand('ping', ['-n', '1', '-w', String(timeoutMs), ipAddress], timeoutMs + 1000);
    return;
  }

  await runCommand('ping', ['-c', '1', '-W', String(timeoutSeconds), ipAddress], timeoutMs + 1000);
}

async function readNeighborTable(ipAddress: string, timeoutMs: number): Promise<string> {
  const outputs: string[] = [];

  if (process.platform === 'win32') {
    const result = await runCommand('arp', ['-a', ipAddress], timeoutMs);
    return `${result.stdout}\n${result.stderr}`;
  }

  if (process.platform === 'linux') {
    try {
      const result = await runCommand('ip', ['neigh', 'show', ipAddress], timeoutMs);
      outputs.push(result.stdout, result.stderr);
    } catch {
      // Fall back to arp below.
    }
  }

  try {
    const result = await runCommand('arp', ['-n', ipAddress], timeoutMs);
    outputs.push(result.stdout, result.stderr);
  } catch {
    if (outputs.length === 0) {
      throw new Error('Unable to read the OS neighbor table with ip neigh or arp.');
    }
  }

  return outputs.join('\n');
}

export class ResolveMacAddress implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Resolve MAC Address',
    name: 'resolveMacAddress',
    icon: 'file:resolveMacAddress.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["host"]}}',
    description: 'Resolve a local-network hostname or IPv4 address to a MAC address',
    defaults: {
      name: 'Resolve MAC Address',
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
        placeholder: 'server.local or 192.168.1.20',
        required: true,
        description: 'Hostname or IPv4 address to resolve',
      },
      {
        displayName: 'Probe Host',
        name: 'probeHost',
        type: 'boolean',
        default: true,
        description: 'Whether to send one ping before reading the neighbor table',
      },
      {
        displayName: 'Probe Timeout',
        name: 'probeTimeoutMs',
        type: 'number',
        default: 1000,
        typeOptions: {
          minValue: 100,
          maxValue: 60000,
        },
        description: 'Milliseconds to wait for the probe command',
      },
      {
        displayName: 'Not Found Behavior',
        name: 'notFoundBehavior',
        type: 'options',
        options: [
          {
            name: 'Throw Error',
            value: 'throw',
          },
          {
            name: 'Return Not Found Status',
            value: 'returnStatus',
          },
        ],
        default: 'throw',
        description: 'What to do when the MAC address is not found in the neighbor table',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const host = this.getNodeParameter('host', itemIndex) as string;
      const shouldProbeHost = this.getNodeParameter('probeHost', itemIndex) as boolean;
      const probeTimeoutMs = this.getNodeParameter('probeTimeoutMs', itemIndex) as number;
      const notFoundBehavior = this.getNodeParameter('notFoundBehavior', itemIndex) as string;

      try {
        const ipAddress = await resolveIpv4Address(host);
        let probeError: string | undefined;

        if (shouldProbeHost) {
          try {
            await probeHost(ipAddress, probeTimeoutMs);
          } catch (error) {
            probeError = error instanceof Error ? error.message : String(error);
          }
        }

        const neighborTable = await readNeighborTable(ipAddress, probeTimeoutMs);
        const macAddress = parseMacAddress(neighborTable);
        const network = getNetworkDetails(ipAddress);

        if (!macAddress && notFoundBehavior === 'throw') {
          throw new Error(
            `No MAC address found for ${host} (${ipAddress}). The host must be visible on the same local network.`,
          );
        }

        returnData.push({
          json: {
            resolveMacAddress: {
              host,
              ipAddress,
              macAddress,
              status: macAddress ? 'resolved' : 'notFound',
              network,
              probeError,
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
