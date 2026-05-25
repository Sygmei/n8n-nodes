import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class RsyncSsh implements ICredentialType {
  name = 'rsyncSsh';
  displayName = 'Rsync SSH';
  documentationUrl = 'https://rsync.samba.org/documentation.html';

  properties: INodeProperties[] = [
    {
      displayName: 'Host',
      name: 'host',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'server.local',
      description: 'Remote SSH host used by rsync',
    },
    {
      displayName: 'User',
      name: 'user',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'backup',
      description: 'Remote SSH user',
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
      description: 'Remote SSH port',
    },
    {
      displayName: 'Identity File',
      name: 'identityFile',
      type: 'string',
      default: '',
      placeholder: '/home/node/.ssh/id_ed25519',
      description: 'Optional SSH private key file path',
    },
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
        password: true,
      },
      default: '',
      placeholder: 'UserKnownHostsFile=/home/node/.ssh/known_hosts\nIdentitiesOnly=yes',
      description: 'Optional SSH -o KEY=VALUE lines',
    },
  ];
}
