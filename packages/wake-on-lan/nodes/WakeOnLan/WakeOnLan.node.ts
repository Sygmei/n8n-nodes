import { createSocket } from 'node:dgram';
import { isIP } from 'node:net';
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

function normalizeMacAddress(macAddress: string): string {
  const compact = macAddress.replace(/[^a-fA-F0-9]/g, '').toUpperCase();

  if (!/^[A-F0-9]{12}$/.test(compact)) {
    throw new Error('MAC address must contain exactly 12 hexadecimal characters.');
  }

  return compact.match(/.{1,2}/g)?.join(':') ?? compact;
}

function createMagicPacket(macAddress: string): Buffer {
  const compact = normalizeMacAddress(macAddress).replace(/:/g, '');
  const macBuffer = Buffer.from(compact, 'hex');
  const packet = Buffer.alloc(6 + 16 * macBuffer.length, 0xff);

  for (let index = 0; index < 16; index += 1) {
    macBuffer.copy(packet, 6 + index * macBuffer.length);
  }

  return packet;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function sendPacket(packet: Buffer, address: string, port: number): Promise<void> {
  const socket = createSocket('udp4');

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(packet, port, address, (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    });
  } finally {
    socket.close();
  }
}

export class WakeOnLan implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Wake-on-LAN',
    name: 'wakeOnLan',
    icon: 'file:wakeOnLan.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["macAddress"]}}',
    description: 'Send a Wake-on-LAN magic packet',
    defaults: {
      name: 'Wake-on-LAN',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    properties: [
      {
        displayName: 'MAC Address',
        name: 'macAddress',
        type: 'string',
        default: '',
        placeholder: '00:11:22:33:44:55',
        required: true,
        description: 'MAC address of the network adapter to wake',
      },
      {
        displayName: 'Broadcast Address',
        name: 'broadcastAddress',
        type: 'string',
        default: '255.255.255.255',
        description: 'IPv4 broadcast address for the target network',
      },
      {
        displayName: 'Port',
        name: 'port',
        type: 'number',
        default: 9,
        typeOptions: {
          minValue: 1,
          maxValue: 65535,
        },
        description: 'UDP destination port. Ports 7 and 9 are commonly used for Wake-on-LAN.',
      },
      {
        displayName: 'Repeat Count',
        name: 'repeatCount',
        type: 'number',
        default: 1,
        typeOptions: {
          minValue: 1,
          maxValue: 20,
        },
        description: 'Number of magic packets to send',
      },
      {
        displayName: 'Delay Between Packets',
        name: 'delayBetweenPackets',
        type: 'number',
        default: 100,
        typeOptions: {
          minValue: 0,
          maxValue: 10000,
        },
        description: 'Delay in milliseconds between repeated packets',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const macAddress = this.getNodeParameter('macAddress', itemIndex) as string;
      const broadcastAddress = this.getNodeParameter('broadcastAddress', itemIndex) as string;
      const port = this.getNodeParameter('port', itemIndex) as number;
      const repeatCount = this.getNodeParameter('repeatCount', itemIndex) as number;
      const delayBetweenPackets = this.getNodeParameter('delayBetweenPackets', itemIndex) as number;

      try {
        if (isIP(broadcastAddress) !== 4) {
          throw new Error('Broadcast address must be a valid IPv4 address.');
        }

        const normalizedMacAddress = normalizeMacAddress(macAddress);
        const packet = createMagicPacket(normalizedMacAddress);

        for (let packetIndex = 0; packetIndex < repeatCount; packetIndex += 1) {
          if (packetIndex > 0 && delayBetweenPackets > 0) {
            await wait(delayBetweenPackets);
          }

          await sendPacket(packet, broadcastAddress, port);
        }

        returnData.push({
          json: {
            ...items[itemIndex].json,
            wakeOnLan: {
              macAddress: normalizedMacAddress,
              broadcastAddress,
              port,
              packetsSent: repeatCount,
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
