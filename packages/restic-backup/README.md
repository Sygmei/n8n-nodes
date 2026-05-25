# n8n-nodes-restic-backup

Run Restic backups from n8n.

## Requirements

The `restic` binary must be installed in the n8n container or host environment where n8n runs.

## Credentials

Create a **Restic Repository** credential with:

- **Repository**: Restic repository location, for example `/backups/repo`, `sftp:user@host:/repo`, or `s3:s3.amazonaws.com/bucket`.
- **Password** or **Password File**: Repository password source.
- **SFTP Command**: Optional inner SSH command passed as `-o sftp.command=...`.
- **Environment Variables**: Optional `KEY=VALUE` lines for backends such as S3, B2, Azure, or rclone.

For example, set **SFTP Command** to:

```text
ssh -i /hostdata/services/restic/ssh/restic-ssh-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new restic@sygnas.local -s sftp
```

Do not include the outer `-o sftp.command="..."` wrapper in the credential field; the node adds that part.

## Parameters

- **Paths**: Local paths to back up, one per line.
- **Tags**: Optional comma or newline-separated Restic tags.
- **Exclude Patterns**: Optional exclude patterns, one per line.
- **Hostname**: Optional Restic host override.
- **Restic Binary**: Binary name or absolute path. Defaults to `restic`.
- **Command Timeout**: Maximum seconds the backup command may run.
- **Additional Arguments**: Optional extra arguments passed directly to `restic backup`.

The node runs `restic backup --json` and returns the parsed summary when Restic emits one. Long-running backups can emit many status messages, so the node stores the latest status, the summary, and up to 250 parsed JSON messages. If more messages are emitted, `omittedMessageCount` reports how many were skipped from the returned item.
