# n8n-nodes-wait-for-tcp-port

Wait until a TCP host and port accepts connections from n8n.

## Parameters

- **Host**: DNS name or IP address to connect to.
- **Port**: TCP port to check.
- **Timeout**: Maximum number of seconds to wait.
- **Retry Interval**: Milliseconds to wait between connection attempts.
- **Connection Timeout**: Milliseconds to wait before one connection attempt is considered failed.
- **Timeout Behavior**: Choose whether timeout throws an error or returns a timeout result.

The node returns connection status, attempts, elapsed time, host, and port for each input item.
