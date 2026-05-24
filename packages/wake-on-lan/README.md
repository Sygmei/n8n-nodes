# n8n-nodes-wol

Send Wake-on-LAN magic packets from n8n.

## Parameters

- **MAC Address**: The target network adapter MAC address.
- **Broadcast Address**: The IPv4 broadcast address to send to. Defaults to `255.255.255.255`.
- **Port**: The UDP destination port. Defaults to `9`.
- **Repeat Count**: Number of magic packets to send.
- **Delay Between Packets**: Milliseconds to wait between repeated packets.

The node returns the normalized MAC address, destination address, destination port, and packet count for each input item.
