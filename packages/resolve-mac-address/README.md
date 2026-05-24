# n8n-nodes-resolve-mac-address

Resolve a local-network hostname or IPv4 address to a MAC address from n8n.

## Parameters

- **Host**: Hostname or IPv4 address to resolve.
- **Probe Host**: Sends one ping before reading the neighbor table. This can populate the ARP cache.
- **Probe Timeout**: Milliseconds to wait for the probe command.
- **Not Found Behavior**: Choose whether missing MAC addresses throw an error or return a `notFound` status.

This node depends on the operating system neighbor table. It works for hosts visible on the same local network segment and doesn't resolve MAC addresses across routers.

When the target IP matches one of the n8n container's IPv4 interfaces, the output also includes network details: interface name, interface address, netmask, prefix length, network address, and broadcast address.
