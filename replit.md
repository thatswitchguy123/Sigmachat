# SigmaChat Project

## Features
- Real-time messaging with Socket.io
- Multi-server and multi-channel support
- Direct Messages (DMs)
- Image and Video uploads (organized by server)
- Polls
- Admin and SuperAdmin roles
- Persistent storage (JSON + MongoDB fallback)
- Server deletion (cleans up files and messages)

## Storage Structure
- `users.json`: User accounts
- `servers.json`: Server configurations
- `public/uploads/`: Global uploads
- `public/uploads/servers/<serverId>/`: Server-specific uploads
- `server_<serverId>_<channelId>_messages.json`: Channel message history

## Setup
1. `npm install`
2. `node index.js`
3. Access at `http://localhost:5000`