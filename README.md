# n8n-nodes

My collection of n8n community nodes.

## Repository layout

Each node is a standalone npm package under `packages/`:

```text
packages/
  wake-on-lan/
    project.json
    package.json
    nodes/
```

Add new node packages by creating another directory in `packages/` with its own `project.json`, `package.json`, and n8n node source files.

## Wake-on-LAN

The first package is `n8n-nodes-wol`. It sends Wake-on-LAN magic packets to a configurable MAC address, broadcast address, port, repeat count, and repeat delay.

## Wait for TCP Port

The second package is `n8n-nodes-wait-for-tcp-port`. It waits until a TCP host and port accepts connections, which is useful after sending a Wake-on-LAN packet.

## Development

Install dependencies:

```bash
npm install
```

Check all node projects:

```bash
npm run check
```

Build all node projects:

```bash
npm run build
```

## Releases

GitHub Actions runs `.github/workflows/publish.yml` on pushes to `main`. The release script checks changed `packages/*/project.json` files and publishes only packages whose `version` changed.

For a package to publish, its `project.json` version must match its `package.json` version. This keeps the CI trigger explicit while still publishing the version npm expects.
