import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class ResticRepository implements ICredentialType {
  name = 'resticRepository';
  displayName = 'Restic Repository';
  documentationUrl = 'https://restic.readthedocs.io/';

  properties: INodeProperties[] = [
    {
      displayName: 'Repository',
      name: 'repository',
      type: 'string',
      default: '',
      required: true,
      placeholder: '/backups/restic-repo',
      description: 'Restic repository location passed as RESTIC_REPOSITORY',
    },
    {
      displayName: 'Password',
      name: 'password',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      description: 'Restic repository password passed as RESTIC_PASSWORD',
    },
    {
      displayName: 'Password File',
      name: 'passwordFile',
      type: 'string',
      default: '',
      description: 'Path to a file containing the repository password, passed as RESTIC_PASSWORD_FILE',
    },
    {
      displayName: 'SFTP Command',
      name: 'sftpCommand',
      type: 'string',
      typeOptions: {
        rows: 3,
      },
      default: '',
      placeholder:
        'ssh -i /hostdata/services/restic/ssh/restic-ssh-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new restic@sygnas.local -s sftp',
      description: 'Optional SSH command passed to Restic as -o sftp.command=...',
    },
    {
      displayName: 'Environment Variables',
      name: 'environmentVariables',
      type: 'string',
      typeOptions: {
        rows: 5,
        password: true,
      },
      default: '',
      placeholder: 'AWS_ACCESS_KEY_ID=...\nAWS_SECRET_ACCESS_KEY=...',
      description: 'Optional KEY=VALUE lines added to the Restic process environment',
    },
  ];
}
