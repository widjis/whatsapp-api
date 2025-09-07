# WhatsApp AI API with Baileys

A comprehensive WhatsApp API implementation using Baileys library with modular architecture, enhanced media support, LDAP integration, and n8n webhook functionality for enterprise-grade messaging automation.

## Features

- 🔗 Real-time WhatsApp connection via Baileys
- 📱 QR Code generation and display in web interface
- 💬 Send and receive messages via API endpoints
- 🌐 Socket.IO integration for real-time updates
- 📊 Connection status monitoring
- 🎨 Clean web interface with MTI branding
- 🏗️ **Modular Architecture** with separated concerns
- 📎 **Enhanced Media Support** for images, videos, audio, documents
- 🔐 **LDAP/Active Directory Integration** for enterprise authentication
- 🔗 **n8n Webhook Integration** for workflow automation
- 📋 **Quoted Message Support** with media information extraction
- 🆔 **Advanced LID Mapping** for WhatsApp's privacy updates
- 🐳 **Docker Support** for containerized deployment

## Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

1. Start the server:
   ```bash
   npm start
   ```

2. Open your browser and navigate to:
   ```
   http://localhost:8192
   ```

3. Scan the QR code with your WhatsApp mobile app:
   - Open WhatsApp on your phone
   - Go to Settings > Linked Devices
   - Tap "Link a Device"
   - Scan the QR code displayed on the web page

4. Once connected, you can:
   - View incoming messages in real-time
   - Send messages via API endpoints
   - Monitor connection status

## API Endpoints

### GET /api/status
Get the current connection status and QR code.

**Response:**
```json
{
  "status": "connected|disconnected",
  "qr": "qr_code_string_if_available"
}
```

### POST /api/send-message
Send a message to a WhatsApp number.

**Request Body:**
```json
{
  "number": "1234567890",
  "message": "Hello from WhatsApp API!"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully"
}
```

### POST /api/send-groupmessage
Send a message to a WhatsApp group using either group ID or group name.

**Request Body (using Group ID):**
```json
{
  "groupId": "120363025343298765",
  "message": "Hello group from WhatsApp API!"
}
```

**Request Body (using Group Name):**
```json
{
  "groupId": "My Family Group",
  "message": "Hello group from WhatsApp API!"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Group message sent successfully",
  "groupId": "120363025343298765@g.us"
}
```

**Note:** The groupId can be either:
- A numeric group ID (e.g., "120363025343298765") - the API will add @g.us suffix automatically
- A group name (e.g., "My Family Group") - the API will search for matching groups by name (case-insensitive partial match)

## Socket.IO Events

The web interface uses Socket.IO for real-time communication:

- `connect` - Client connected to server
- `qr` - QR code generated (receives base64 image data)
- `ready` - WhatsApp connection established
- `authenticated` - WhatsApp authentication successful
- `message` - New message received or status update
- `disconnect` - Client disconnected

## Enterprise Features

### Auto-Reply System
Intelligent auto-reply functionality with enterprise integration:

#### Connection Notifications
- Automatically sends connection status to admin number when API connects
- Includes API number, timestamp, and connection status
- LDAP user authentication for admin access

#### Direct Message Auto-Reply
- Responds automatically to direct messages from authenticated users
- LDAP integration for user verification
- Customizable welcome messages and responses

#### Group Message Handling
- Advanced LID-based mention detection
- Only responds when API number is tagged/mentioned
- Enterprise workflow integration via n8n webhooks

### Media Processing
- **Full Media Download**: Downloads complete media files (images, videos, audio)
- **Base64 Encoding**: Converts media to base64 for webhook transmission
- **Metadata Extraction**: Comprehensive media information (type, size, dimensions)
- **Quoted Message Media**: Extracts media information from quoted messages
- **Multiple Attachments**: Support for multiple file attachments

### Webhook Integration
- **n8n Workflow Automation**: Real-time message forwarding to n8n
- **Dual Webhook Support**: Separate endpoints for replies and logging
- **Rich Data Structure**: Complete message context with media support
- **Error Handling**: Robust webhook delivery with retry logic

## LID (Lidded ID) Support

Due to WhatsApp's updated privacy policy, user numbers in groups are now represented as LID (Lidded ID) instead of direct phone numbers. This API includes a comprehensive LID mapping system:

### Features:
- **Dynamic LID Mapping**: Maintains real-time mapping between LIDs, phone numbers, and push names
- **Contact Synchronization**: Automatically syncs contacts to build comprehensive LID database
- **Smart Tag Detection**: Enhanced mention detection using LID mapping for group messages
- **Backward Compatibility**: Still works with traditional phone number formats
- **Enhanced Logging**: Detailed debugging information for LID conversion process

### LID Format Examples:
```
// Traditional format
6285712612218@s.whatsapp.net

// LID format (WhatsApp's new privacy format)
214869110423796@s.whatsapp.net  // This maps to actual phone number
6285712612218:42@s.whatsapp.net
6285712612218.30@s.whatsapp.net
```

### Advanced LID Mapping System:

#### 1. **Mapping Database**
- `lidMapping`: LID → Phone Number
- `phoneToLidMapping`: Phone Number → LID  
- `pushNameMapping`: LID → Display Name

#### 2. **Contact Synchronization**
- Automatically syncs WhatsApp contacts on connection
- Updates mapping when contacts change
- Maintains real-time LID-to-number relationships

#### 3. **Smart Tag Detection**
- Checks message text for `@phoneNumber` and `@LID` mentions
- Analyzes `mentionedJid` array in message context
- Uses `isOurApiNumber()` function for accurate identification
- Provides detailed logging for debugging mention detection

### Implementation Functions:
- `lidToPhoneNumber(lid)`: Converts LID to phone number with caching
- `updateLidMapping(contacts)`: Updates mapping from contact list
- `isOurApiNumber(lid)`: Checks if LID belongs to API number
- Enhanced group message detection with comprehensive logging

## File Structure

```
whatsapp-ai/
├── server.js              # Main server file with modular imports
├── index.html             # Web interface for QR code display
├── package.json           # Project dependencies
├── package-lock.json      # Dependency lock file
├── .gitignore            # Git ignore file
├── Dockerfile            # Docker container configuration
├── docker-compose.yml    # Multi-container setup
├── docs/
│   └── journal.md        # Development journal and documentation
├── lib/                  # Modular architecture components
│   ├── config.js         # Configuration and environment variables
│   ├── ldapClient.js     # LDAP/Active Directory integration
│   ├── lidMapping.js     # LID mapping functionality
│   ├── messageProcessor.js # Message processing and media handling
│   └── n8nIntegration.js # n8n webhook integration
└── auth_info_baileys/    # WhatsApp session data (auto-generated)
```

## Configuration

### Environment Variables
Create a `.env` file with the following variables:

```env
# Server Configuration
PORT=8192
ADMIN_NUMBER=6285712612218

# LDAP Configuration
LDAP_URL=ldap://192.168.1.100:389
LDAP_BIND_DN=CN=ldapuser,CN=Users,DC=merdekabattery,DC=local
LDAP_BIND_PASSWORD=your_ldap_password
LDAP_SEARCH_BASE=DC=merdekabattery,DC=local
LDAP_SEARCH_FILTER=(sAMAccountName={username})

# n8n Webhook Configuration
N8N_WEBHOOK_URL=https://n8nprod.merdekabattery.com:5679/webhook/whatsapptest
N8N_WEBHOOK_URL_LOG=https://n8nprod.merdekabattery.com:5679/webhook/whatsapplog
```

### Core Settings
- **Port**: 8192 (configurable via PORT environment variable)
- **Authentication**: Session data stored in `auth_info_baileys/` folder
- **Logging**: Pino logger with configurable levels
- **LDAP**: Enterprise directory integration for user authentication
- **n8n**: Webhook endpoints for workflow automation

## Security Notes

- The `auth_info_baileys/` folder contains sensitive session data
- Never commit this folder to version control
- Use environment variables for production configurations
- Implement proper authentication for API endpoints in production

## Troubleshooting

### Common Issues
1. **QR Code not appearing**: Check browser console for Socket.IO connection errors
2. **Connection issues**: Ensure WhatsApp Web is not open in another browser
3. **Port conflicts**: Change the PORT environment variable if 8192 is in use
4. **Authentication errors**: Delete the `auth_info_baileys/` folder and restart

### Enterprise Integration Issues
5. **LDAP Connection Failed**: Verify LDAP_URL, credentials, and network connectivity
6. **n8n Webhook Errors**: Check webhook URLs and n8n workflow registration
7. **Media Download Issues**: Ensure sufficient disk space and network bandwidth
8. **Docker Issues**: Check container logs and environment variable configuration

### Debug Mode
Enable detailed logging by setting environment variables:
```env
LOG_LEVEL=debug
DEBUG_LDAP=true
DEBUG_WEBHOOKS=true
```

## Dependencies

### Core Dependencies
- `@whiskeysockets/baileys` - WhatsApp Web API
- `express` - Web server framework
- `socket.io` - Real-time communication
- `qrcode` - QR code generation
- `cors` - Cross-origin resource sharing
- `pino` - Logging library

### Enterprise Features
- `ldapjs` - LDAP/Active Directory integration
- `axios` - HTTP client for webhook requests
- `dotenv` - Environment variable management

### Media Support
- Enhanced media download and processing
- Base64 encoding for webhook transmission
- Support for images, videos, audio, documents, stickers

## Docker Deployment

### Using Docker Compose
```bash
docker-compose up -d
```

### Manual Docker Build
```bash
docker build -t whatsapp-api .
docker run -p 8192:8192 --env-file .env whatsapp-api
```

## License

MIT License - Feel free to use and modify as needed.