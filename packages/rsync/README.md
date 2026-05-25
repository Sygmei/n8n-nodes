# n8n-nodes-rsync

Run rsync pull and push operations from n8n.

## Requirements

The `rsync` binary must be installed in the n8n container. If using SSH transport, `ssh` must also be available and the configured key file must be readable by the n8n user.

## Credentials

Use n8n's built-in **SSH Private Key** credential. Password-based SSH is not supported because native `rsync`/`ssh` cannot use a password non-interactively without extra tools such as `sshpass`.

The private key is written to a temporary file while rsync runs, then removed. Passphrase-protected keys are not supported by this node; use an unencrypted deploy key with limited permissions.

## Nodes

- **Rsync Pull**: Syncs `remote -> local`.
- **Rsync Push**: Syncs `local -> remote`.

Both nodes expose common rsync options such as archive mode, compression, deletion, dry run, excludes, timeout, binary path, and additional arguments.
