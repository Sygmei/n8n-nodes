# n8n-nodes-rsync

Run rsync pull and push operations from n8n.

## Requirements

The `rsync` binary must be installed in the n8n container. If using SSH transport, `ssh` must also be available and the configured key file must be readable by the n8n user.

## Credentials

Create an **Rsync SSH** credential with:

- **Host**: Remote hostname or IP address.
- **User**: SSH username.
- **Port**: SSH port.
- **Identity File**: Optional path to an SSH private key.
- **Strict Host Key Checking**: SSH host key behavior.
- **Additional SSH Options**: Optional extra `-o KEY=VALUE` lines.

## Nodes

- **Rsync Pull**: Syncs `remote -> local`.
- **Rsync Push**: Syncs `local -> remote`.

Both nodes expose common rsync options such as archive mode, compression, deletion, dry run, excludes, timeout, binary path, and additional arguments.
