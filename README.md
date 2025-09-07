# WhatsApp AI API with Baileys

A WhatsApp API implementation using Baileys library with Socket.IO integration for real-time QR code display and message handling.

## Features

- 🔗 Real-time WhatsApp connection via Baileys
- 📱 QR Code generation and display in web interface
- 💬 Send and receive messages via API endpoints
- 🌐 Socket.IO integration for real-time updates
- 📊 Connection status monitoring
- 🎨 Clean web interface with MTI branding

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

## Auto-Reply Features

The API includes intelligent auto-reply functionality:

### Connection Notifications
- Automatically sends connection status to admin number (6285712612218) when API connects
- Includes API number, timestamp, and connection status

### Direct Message Auto-Reply
- Responds automatically to direct messages from the admin number
- Sends welcome message: "Hi, welcome to WhatsApp API system! 🤖"

### Group Message Handling
- Only responds to group messages when the API number is tagged/mentioned
- Uses `@{api_number}` detection or WhatsApp mention system
- Sends helpful bot response when tagged in groups

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
├── server.js          # Main server file with Baileys integration
├── index.html         # Web interface for QR code display
├── package.json       # Project dependencies
├── .gitignore        # Git ignore file
└── auth_info_baileys/ # WhatsApp session data (auto-generated)
```

## Configuration

- **Port**: 8192 (configurable in server.js)
- **Authentication**: Session data stored in `auth_info_baileys/` folder
- **Logging**: Pino logger with silent level for production

## Security Notes

- The `auth_info_baileys/` folder contains sensitive session data
- Never commit this folder to version control
- Use environment variables for production configurations
- Implement proper authentication for API endpoints in production

## Troubleshooting

1. **QR Code not appearing**: Check browser console for Socket.IO connection errors
2. **Connection issues**: Ensure WhatsApp Web is not open in another browser
3. **Port conflicts**: Change the PORT variable in server.js if 8192 is in use
4. **Authentication errors**: Delete the `auth_info_baileys/` folder and restart

## Dependencies

- `@whiskeysockets/baileys` - WhatsApp Web API
- `express` - Web server framework
- `socket.io` - Real-time communication
- `qrcode` - QR code generation
- `cors` - Cross-origin resource sharing
- `pino` - Logging library

## License

MIT License - Feel free to use and modify as needed.