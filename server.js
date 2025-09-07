const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const cors = require('cors');
const path = require('path');
const P = require('pino');
const { Client } = require('ldapts');
require('dotenv').config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 8192;
let sock;
let qrDinamic;
let soket;

// Configuration
const ADMIN_NUMBER = '6285712612218';
let who_i_am = null; // Will be set when connection is established
let who_i_am_lid = null; // Will store our LID for comparison

// LID to Phone Number Mapping System
const lidMapping = new Map(); // LID -> Phone Number
const phoneToLidMapping = new Map(); // Phone Number -> LID
const pushNameMapping = new Map(); // LID -> Push Name

// n8n Integration Configuration
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_ENABLED = process.env.N8N_ENABLED === 'true';
const N8N_TIMEOUT = parseInt(process.env.N8N_TIMEOUT) || 5000;

// LDAP Configuration
const LDAP_URL = process.env.LDAP_URL;
const LDAP_BIND_DN = process.env.LDAP_BIND_DN;
const LDAP_BIND_PASSWORD = process.env.LDAP_BIND_PASSWORD;
const LDAP_BASE_DN = process.env.LDAP_BASE_DN;
const LDAP_SEARCH_FILTER = process.env.LDAP_SEARCH_FILTER || '(telephoneNumber={phone})';
const LDAP_ENABLED = process.env.LDAP_ENABLED === 'true';
const LDAP_TIMEOUT = parseInt(process.env.LDAP_TIMEOUT) || 10000;
const LDAP_CONNECT_TIMEOUT = parseInt(process.env.LDAP_CONNECT_TIMEOUT) || 5000;
const LDAP_MAX_RETRIES = parseInt(process.env.LDAP_MAX_RETRIES) || 3;
const LDAP_RETRY_DELAY = parseInt(process.env.LDAP_RETRY_DELAY) || 1000;

// LDAP Connection Pool
let ldapClient = null;
let ldapConnectionPromise = null;
let lastLdapError = null;
let ldapReconnectAttempts = 0;
const MAX_LDAP_RECONNECT_ATTEMPTS = 5;

// Typing Indicator Configuration
const TYPING_ENABLED = process.env.TYPING_ENABLED === 'true';

// Message Buffering Configuration
const MESSAGE_BUFFER_ENABLED = process.env.MESSAGE_BUFFER_ENABLED === 'true';
const MESSAGE_BUFFER_TIMEOUT = parseInt(process.env.MESSAGE_BUFFER_TIMEOUT) || 3000;

// Message Buffer Storage
const messageBuffers = new Map(); // phoneNumber -> { messages: [], timer: timeoutId, lastMessageTime: timestamp }

// Forward declarations for message processing functions
let processMessageForReply;
let processMessageForLogging;
let sendDefaultReply;

// Message Buffering Functions
function addToMessageBuffer(phoneNumber, messageData) {
  if (!MESSAGE_BUFFER_ENABLED) {
    return false; // Don't buffer if disabled
  }

  const now = Date.now();
  
  if (!messageBuffers.has(phoneNumber)) {
    // Create new buffer for this phone number
    messageBuffers.set(phoneNumber, {
      messages: [],
      timer: null,
      lastMessageTime: now
    });
  }

  const buffer = messageBuffers.get(phoneNumber);
  
  // Add message to buffer
  buffer.messages.push(messageData);
  buffer.lastMessageTime = now;
  
  // Clear existing timer if any
  if (buffer.timer) {
    clearTimeout(buffer.timer);
  }
  
  // Set new timer to flush buffer after timeout
  buffer.timer = setTimeout(() => {
    flushMessageBuffer(phoneNumber);
  }, MESSAGE_BUFFER_TIMEOUT);
  
  return true; // Message was buffered
}

function flushMessageBuffer(phoneNumber) {
  const buffer = messageBuffers.get(phoneNumber);
  if (!buffer || buffer.messages.length === 0) {
    return;
  }
  
  // Combine all messages with newline separators
  const combinedMessage = buffer.messages.map(msg => msg.message).join('\n');
  
  // Create combined message data using the first message as template
  const firstMessage = buffer.messages[0];
  const combinedData = {
    ...firstMessage,
    message: combinedMessage,
    messageCount: buffer.messages.length,
    isBufferedMessage: true
  };
  
  // Clear the buffer
  if (buffer.timer) {
    clearTimeout(buffer.timer);
  }
  messageBuffers.delete(phoneNumber);
  
  // Process combined message based on whether it should reply
  console.log(`Flushing buffered messages for ${phoneNumber}: ${buffer.messages.length} messages combined`);
  
  if (combinedData.shouldReply) {
    // Use the processMessageForReply function (need to make it accessible)
    processMessageForReply(combinedData).catch(error => {
      console.error('Error processing buffered message for reply:', error.message);
    });
  } else {
    // Use the processMessageForLogging function (need to make it accessible)
    processMessageForLogging(combinedData).catch(error => {
      console.error('Error processing buffered message for logging:', error.message);
    });
  }
}

// n8n Webhook Function with Enhanced Error Handling
async function sendToN8N(data) {
  if (!N8N_ENABLED) {
    console.log('n8n integration is disabled');
    return { success: false, reason: 'disabled' };
  }

  if (!N8N_WEBHOOK_URL) {
    console.warn('n8n webhook URL not configured in environment variables');
    return { success: false, reason: 'no_url' };
  }

  const startTime = Date.now();
  
  try {
    console.log(`Sending data to n8n webhook: ${N8N_WEBHOOK_URL}`);
    
    // For HTTPS URLs with SSL issues, use https module directly
    if (N8N_WEBHOOK_URL.startsWith('https://')) {
      const https = require('https');
      const url = require('url');
      
      const parsedUrl = new url.URL(N8N_WEBHOOK_URL);
      const postData = JSON.stringify(data);
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'WhatsApp-AI-Bot/1.0',
          ...(process.env.N8N_API_KEY && { 'Authorization': `Bearer ${process.env.N8N_API_KEY}` })
        },
        rejectUnauthorized: false, // Ignore SSL certificate validation errors
        timeout: N8N_TIMEOUT
      };
      
      return new Promise((resolve) => {
        const req = https.request(options, (res) => {
          let responseData = '';
          
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            const duration = Date.now() - startTime;
            
            if (res.statusCode >= 200 && res.statusCode < 300) {
              console.log(`Successfully sent data to n8n webhook in ${duration}ms`);
              try {
                const result = JSON.parse(responseData);
                resolve({ success: true, duration, result });
              } catch {
                resolve({ success: true, duration, result: { success: true } });
              }
            } else {
              console.error(`n8n webhook failed [${res.statusCode}] in ${duration}ms:`, {
                status: res.statusCode,
                statusText: res.statusMessage,
                url: N8N_WEBHOOK_URL,
                error: responseData
              });
              resolve({ success: false, error: `HTTP ${res.statusCode}: ${res.statusMessage}`, duration });
            }
          });
        });
        
        req.on('error', (error) => {
          const duration = Date.now() - startTime;
          console.error('n8n webhook HTTPS request error:', {
            url: N8N_WEBHOOK_URL,
            error: error.message,
            messageId: data.messageId
          });
          resolve({ success: false, error: error.message, duration });
        });
        
        req.on('timeout', () => {
          const duration = Date.now() - startTime;
          console.error(`n8n webhook timeout after ${N8N_TIMEOUT}ms:`, {
            url: N8N_WEBHOOK_URL,
            timeout: N8N_TIMEOUT,
            messageId: data.messageId
          });
          req.destroy();
          resolve({ success: false, error: 'Request timeout', duration });
        });
        
        req.write(postData);
        req.end();
      });
    }
    
    // For HTTP URLs, use fetch as before
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-AI-Bot/1.0',
        ...(process.env.N8N_API_KEY && { 'Authorization': `Bearer ${process.env.N8N_API_KEY}` })
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(N8N_TIMEOUT)
    };
    
    const response = await fetch(N8N_WEBHOOK_URL, fetchOptions);

    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      console.error(`n8n webhook failed [${response.status}] in ${duration}ms:`, {
        status: response.status,
        statusText: response.statusText,
        url: N8N_WEBHOOK_URL,
        error: errorText
      });
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json().catch(() => ({ success: true }));
    console.log(`Successfully sent data to n8n webhook in ${duration}ms`);
    
    return { success: true, duration, result };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    if (error.name === 'TimeoutError') {
      console.error(`n8n webhook timeout after ${N8N_TIMEOUT}ms:`, {
        url: N8N_WEBHOOK_URL,
        timeout: N8N_TIMEOUT,
        messageId: data.messageId
      });
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('n8n webhook network error:', {
        url: N8N_WEBHOOK_URL,
        error: error.message,
        messageId: data.messageId
      });
    } else {
      console.error(`n8n webhook error in ${duration}ms:`, {
        error: error.message,
        url: N8N_WEBHOOK_URL,
        messageId: data.messageId
      });
    }
    
    return { success: false, error: error.message, duration };
  }
}

// Message Processing Functions
processMessageForReply = async function(data) {
  try {
    // Search for user in Active Directory
    const adUserInfo = await searchUserInAD(data.fromNumber);
    
    const webhookData = {
      ...data,
      adUser: adUserInfo // Add Active Directory user information
    };
    
    console.log('Sending message to n8n for response...');
    const n8nResult = await sendToN8N(webhookData);
    
    if (n8nResult.success && n8nResult.result) {
      // Extract response from n8n
      let replyText = null;
      
      // Handle different n8n response formats
       if (Array.isArray(n8nResult.result) && n8nResult.result.length > 0) {
         // Format: [{ "output": "response text" }]
         replyText = n8nResult.result[0].output || n8nResult.result[0].message || n8nResult.result[0].text || n8nResult.result[0].reply;
       } else if (n8nResult.result.reply) {
         // Format: { "reply": "response text" } - n8n specific format
         replyText = n8nResult.result.reply;
       } else if (n8nResult.result.output) {
         // Format: { "output": "response text" }
         replyText = n8nResult.result.output;
       } else if (n8nResult.result.message) {
         // Format: { "message": "response text" }
         replyText = n8nResult.result.message;
       } else if (typeof n8nResult.result === 'string') {
         // Format: "response text"
         replyText = n8nResult.result;
       }
      
      if (replyText) {
        // Show typing indicator before sending reply (if enabled)
        if (TYPING_ENABLED) {
          try {
            await sock.sendPresenceUpdate('composing', data.from);
            console.log('Showing typing indicator to:', data.fromNumber);
            
            // Wait a moment to simulate natural typing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Send the actual reply
            await sock.sendMessage(data.from, { text: replyText });
            
            // Mark as available after sending
            await sock.sendPresenceUpdate('available', data.from);
            
            console.log('Sent n8n response to:', data.fromNumber);
          } catch (presenceError) {
            console.error('Error with presence update:', presenceError.message);
            // Still send the message even if presence update fails
            await sock.sendMessage(data.from, { text: replyText });
            console.log('Sent n8n response to:', data.fromNumber, '(without typing indicator)');
          }
        } else {
          // Send reply directly without typing indicator
          await sock.sendMessage(data.from, { text: replyText });
          console.log('Sent n8n response to:', data.fromNumber, '(typing disabled)');
        }
      } else {
        console.log('No valid response text found in n8n result:', n8nResult.result);
        // Fallback to default reply
        await sendDefaultReply(data.from, data.isGroup);
      }
    } else {
      console.log('n8n request failed, using default reply');
      // Fallback to default reply
      await sendDefaultReply(data.from, data.isGroup);
    }
  } catch (error) {
    console.error('Error processing n8n response:', error.message);
    // Fallback to default reply
    await sendDefaultReply(data.from, data.isGroup);
  }
};

processMessageForLogging = async function(data) {
  try {
    // Search for user in Active Directory (for logging)
    const adUserInfo = await searchUserInAD(data.fromNumber);
    
    const webhookData = {
      ...data,
      adUser: adUserInfo, // Add Active Directory user information
      shouldReply: false // Indicate this is just for logging
    };
    
    // Send to n8n webhook (non-blocking for logging)
    sendToN8N(webhookData).catch(error => {
      console.error('Failed to send message to n8n for logging:', error.message);
    });
  } catch (error) {
    console.error('Error preparing data for n8n webhook:', error.message);
  }
};

sendDefaultReply = async function(recipient, isGroupMessage) {
  try {
    // Show typing indicator before sending default reply (if enabled)
    if (TYPING_ENABLED) {
      try {
        await sock.sendPresenceUpdate('composing', recipient);
        console.log('Showing typing indicator for default reply to:', recipient);
        
        // Wait a moment to simulate natural typing
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (presenceError) {
        console.error('Error with presence update for default reply:', presenceError.message);
      }
    }
    
    if (isGroupMessage) {
      await sock.sendMessage(recipient, { 
        text: 'Currently, AI system is not available, please wait. 🤖' 
      });
      console.log('Sent default group reply to:', recipient, TYPING_ENABLED ? '' : '(typing disabled)');
    } else {
      await sock.sendMessage(recipient, { 
        text: 'Currently, AI system is not available, please wait. 🤖\n\nPlease try again later.' 
      });
      console.log('Sent default direct reply to:', recipient, TYPING_ENABLED ? '' : '(typing disabled)');
    }
    
    // Mark as available after sending (if typing was enabled)
    if (TYPING_ENABLED) {
      try {
        await sock.sendPresenceUpdate('available', recipient);
      } catch (presenceError) {
        console.error('Error setting available status after default reply:', presenceError.message);
      }
    }
  } catch (error) {
    console.error('Error sending default reply:', error);
  }
};

// LDAP Functions for Active Directory Integration

// Initialize LDAP connection with retry logic
async function initializeLdapConnection() {
  if (ldapConnectionPromise) {
    return ldapConnectionPromise;
  }

  ldapConnectionPromise = (async () => {
    try {
      if (ldapClient) {
        try {
          await ldapClient.unbind();
        } catch (e) {
          // Ignore unbind errors
        }
      }

      ldapClient = new Client({
        url: LDAP_URL,
        timeout: LDAP_TIMEOUT,
        connectTimeout: LDAP_CONNECT_TIMEOUT,
      });

      await ldapClient.bind(LDAP_BIND_DN, LDAP_BIND_PASSWORD);
      console.log('LDAP connection established successfully');
      ldapReconnectAttempts = 0;
      lastLdapError = null;
      return ldapClient;
    } catch (error) {
      console.error('LDAP connection failed:', error.message);
      ldapClient = null;
      ldapConnectionPromise = null;
      lastLdapError = error;
      throw error;
    }
  })();

  return ldapConnectionPromise;
}

// Get or create LDAP connection
async function getLdapConnection() {
  if (ldapClient && lastLdapError === null) {
    return ldapClient;
  }

  if (ldapReconnectAttempts >= MAX_LDAP_RECONNECT_ATTEMPTS) {
    throw new Error(`LDAP connection failed after ${MAX_LDAP_RECONNECT_ATTEMPTS} attempts. Last error: ${lastLdapError?.message}`);
  }

  ldapReconnectAttempts++;
  return await initializeLdapConnection();
}

// Search user with retry logic
async function searchUserInAD(phoneNumber) {
  if (!LDAP_ENABLED || !LDAP_URL || !phoneNumber) {
    return null;
  }

  let lastError = null;
  
  for (let attempt = 1; attempt <= LDAP_MAX_RETRIES; attempt++) {
    try {
      const client = await getLdapConnection();
      
      // Clean phone number (remove + and spaces)
      const cleanPhone = phoneNumber.replace(/[+\s-]/g, '');
      
      // Create search filter
      const searchFilter = LDAP_SEARCH_FILTER.replace('{phone}', cleanPhone);
      
      // Search for user
      const searchOptions = {
        scope: 'sub',
        filter: searchFilter,
        attributes: [
          'displayName', 'department', 'gender', 'mail'
        ]
      };
      
      const searchResult = await client.search(LDAP_BASE_DN, searchOptions);
      
      if (searchResult.searchEntries && searchResult.searchEntries.length > 0) {
        const user = searchResult.searchEntries[0];
        return {
          found: true,
          name: user.displayName,
          gender: user.gender,
          email: user.mail,
          department: user.department
        };
      }
      
      return { found: false, message: 'User not found in Active Directory' };
      
    } catch (error) {
      lastError = error;
      console.error(`LDAP search error (attempt ${attempt}/${LDAP_MAX_RETRIES}):`, {
        phone: phoneNumber,
        error: error.message,
        timestamp: new Date().toISOString(),
        attempt: attempt
      });
      
      // Reset connection on error
      ldapClient = null;
      ldapConnectionPromise = null;
      lastLdapError = error;
      
      // Wait before retry (except on last attempt)
      if (attempt < LDAP_MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, LDAP_RETRY_DELAY * attempt));
      }
    }
  }
  
  return { 
    found: false, 
    error: lastError?.message || 'Unknown LDAP error',
    message: `Error searching Active Directory after ${LDAP_MAX_RETRIES} attempts`
  };
}

// Cleanup LDAP connection on shutdown
process.on('SIGTERM', async () => {
  if (ldapClient) {
    try {
      await ldapClient.unbind();
      console.log('LDAP connection closed gracefully');
    } catch (error) {
      console.error('Error closing LDAP connection:', error.message);
    }
  }
});

// Function to convert LID to phone number
function lidToPhoneNumber(lid) {
  if (!lid) return null;
  
  // Check if we have this LID in our mapping
  if (lidMapping.has(lid)) {
    return lidMapping.get(lid);
  }
  
  // Remove @s.whatsapp.net, @g.us, or @lid suffix
  const cleanLid = lid.split('@')[0];
  
  // Check if we have the clean LID in our mapping
  if (lidMapping.has(cleanLid)) {
    return lidMapping.get(cleanLid);
  }
  
  // Handle @lid suffix format - these are typically just the phone number
  if (lid.endsWith('@lid')) {
    // For @lid format, the cleanLid is usually the phone number itself
    if (/^\d+$/.test(cleanLid)) {
      // Store this mapping for future use
      lidMapping.set(cleanLid, cleanLid);
      lidMapping.set(lid, cleanLid);
      phoneToLidMapping.set(cleanLid, cleanLid);
      return cleanLid;
    }
  }
  
  // LID format is typically: phoneNumber:deviceId or phoneNumber.deviceId
  // Extract the phone number part (before : or .)
  const phoneMatch = cleanLid.match(/^(\d+)[:.]?/);
  if (phoneMatch && phoneMatch[1]) {
    const phoneNumber = phoneMatch[1];
    // Store this mapping for future use
    lidMapping.set(cleanLid, phoneNumber);
    lidMapping.set(lid, phoneNumber);
    phoneToLidMapping.set(phoneNumber, cleanLid);
    return phoneNumber;
  }
  
  // If it's already a phone number, return as is
  if (/^\d+$/.test(cleanLid)) {
    return cleanLid;
  }
  
  return cleanLid; // Return original if no pattern matches
}

// Function to update LID mapping from contact info
function updateLidMapping(contacts) {
  if (!contacts || !Array.isArray(contacts)) return;
  
  contacts.forEach(contact => {
    if (contact.id && contact.notify) {
      const phoneNumber = lidToPhoneNumber(contact.id);
      const cleanLid = contact.id.split('@')[0];
      
      // Store mappings
      lidMapping.set(cleanLid, phoneNumber);
      lidMapping.set(contact.id, phoneNumber);
      phoneToLidMapping.set(phoneNumber, cleanLid);
      pushNameMapping.set(cleanLid, contact.notify);
      
      console.log(`Mapped LID: ${cleanLid} -> Phone: ${phoneNumber} (${contact.notify})`);
    }
  });
}

// Function to check if a LID belongs to our API number
function isOurApiNumber(lid) {
  if (!lid || !who_i_am) {
    console.log(`isOurApiNumber: Invalid input - lid: ${lid}, who_i_am: ${who_i_am}`);
    return false;
  }
  
  const cleanLid = lid.split('@')[0];
  console.log(`isOurApiNumber: Checking lid: ${lid}, cleanLid: ${cleanLid}, who_i_am: ${who_i_am}, who_i_am_lid: ${who_i_am_lid}`);
  
  // Direct comparison with our LID
  if (who_i_am_lid && (cleanLid === who_i_am_lid || lid === who_i_am_lid)) {
    console.log(`isOurApiNumber: Direct LID match found`);
    return true;
  }
  
  // Handle @lid suffix format - extract the LID part
  if (lid.endsWith('@lid')) {
    const lidPart = cleanLid;
    console.log(`isOurApiNumber: Processing @lid format - lidPart: ${lidPart}`);
    
    // Check if this LID maps to our phone number
    const phoneNumber = lidToPhoneNumber(lidPart);
    console.log(`isOurApiNumber: LID ${lidPart} maps to phone: ${phoneNumber}`);
    
    if (phoneNumber === who_i_am) {
      console.log(`isOurApiNumber: Phone number match found via LID mapping`);
      return true;
    }
    
    // Also check if the LID part matches our LID directly
    if (who_i_am_lid && lidPart === who_i_am_lid.split(':')[0]) {
      console.log(`isOurApiNumber: LID part matches our LID base`);
      return true;
    }
    
    // Debug: Check if this could be an alternative LID format
    console.log(`isOurApiNumber: Debugging - lidPart: ${lidPart}, who_i_am: ${who_i_am}, who_i_am_lid: ${who_i_am_lid}`);
    console.log(`isOurApiNumber: Debugging - lidPart === who_i_am: ${lidPart === who_i_am}`);
    if (who_i_am_lid) {
      console.log(`isOurApiNumber: Debugging - lidPart === who_i_am_lid.split(':')[0]: ${lidPart === who_i_am_lid.split(':')[0]}`);
    }
  }
  
  // Check if the LID maps to our phone number
  const phoneNumber = lidToPhoneNumber(lid);
  console.log(`isOurApiNumber: Final check - LID ${lid} maps to phone: ${phoneNumber}`);
  const result = phoneNumber === who_i_am;
  console.log(`isOurApiNumber: Final result: ${result}`);
  return result;
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API Routes
app.get('/api/status', (req, res) => {
  const status = sock ? 'connected' : 'disconnected';
  res.json({ status, qr: qrDinamic });
});

app.post('/api/send-message', async (req, res) => {
  try {
    const { number, message } = req.body;
    
    if (!sock) {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    
    if (!number || !message) {
      return res.status(400).json({ error: 'Number and message are required' });
    }
    
    const formattedNumber = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
    
    await sock.sendMessage(formattedNumber, { text: message });
    res.json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.post('/api/send-groupmessage', async (req, res) => {
  try {
    const { groupId, message } = req.body;
    
    if (!sock) {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    
    if (!groupId || !message) {
      return res.status(400).json({ error: 'Group ID/name and message are required' });
    }
    
    let targetGroupId = groupId;
    
    // If groupId doesn't contain @g.us and is not numeric, treat it as group name
    if (!groupId.includes('@g.us') && isNaN(groupId)) {
      // Search for group by name
      const groups = await sock.groupFetchAllParticipating();
      const groupEntries = Object.entries(groups);
      
      const foundGroup = groupEntries.find(([id, group]) => 
        group.subject && group.subject.toLowerCase().includes(groupId.toLowerCase())
      );
      
      if (!foundGroup) {
        return res.status(404).json({ error: `Group with name '${groupId}' not found` });
      }
      
      targetGroupId = foundGroup[0]; // Use the found group ID
    } else {
      // Format group ID - groups use @g.us suffix
      targetGroupId = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;
    }
    
    await sock.sendMessage(targetGroupId, { text: message });
    res.json({ 
      success: true, 
      message: 'Group message sent successfully',
      groupId: targetGroupId
    });
  } catch (error) {
    console.error('Error sending group message:', error);
    res.status(500).json({ error: 'Failed to send group message' });
  }
});

// WhatsApp Connection Function
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: P({ level: 'silent' })
  });
  
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      qrDinamic = qr;
      try {
        const qrCodeDataURL = await QRCode.toDataURL(qr);
        if (soket) {
          soket.emit('qr', qrCodeDataURL);
        }
        console.log('QR Code generated and sent to client');
      } catch (error) {
        console.error('Error generating QR code:', error);
      }
    }
    
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
      
      if (soket) {
        soket.emit('message', 'Connection closed. Reconnecting...');
      }
      
      if (shouldReconnect) {
        setTimeout(() => {
          connectToWhatsApp();
        }, 3000);
      }
    } else if (connection === 'open') {
      console.log('WhatsApp connection opened');
      
      // Get our own number and LID
      const rawUserId = sock.user?.id;
      who_i_am = lidToPhoneNumber(rawUserId);
      who_i_am_lid = rawUserId?.split('@')[0] || null;
      
      console.log('Connected as:', who_i_am, '(Raw ID:', rawUserId, ', LID:', who_i_am_lid, ')');
      
      // Store our own mapping
      if (who_i_am_lid && who_i_am) {
        lidMapping.set(who_i_am_lid, who_i_am);
        phoneToLidMapping.set(who_i_am, who_i_am_lid);
        
        // Add manual mapping for alternative LID format
        // This LID 214869110423796 appears to be an alternative format for our bot
        lidMapping.set('214869110423796', who_i_am);
        lidMapping.set('214869110423796@lid', who_i_am);
        console.log('Added manual LID mapping: 214869110423796 -> ', who_i_am);
      }
      
      // Sync contacts to build LID mapping
      try {
        console.log('Syncing contacts for LID mapping...');
        // Note: sock.getContacts() is not available in current Baileys version
        // We'll build the mapping as contacts come in through events
        console.log('LID mapping will be built as contacts are received through events');
      } catch (error) {
        console.error('Failed to sync contacts for LID mapping:', error);
      }
      
      if (soket) {
        soket.emit('ready', 'WhatsApp is ready!');
        soket.emit('message', 'WhatsApp connection established successfully');
      }
      
      // Send connection notification to admin
      try {
        const adminJid = `${ADMIN_NUMBER}@s.whatsapp.net`;
        await sock.sendMessage(adminJid, { 
          text: `🟢 WhatsApp API Connected Successfully!\n\nAPI Number: ${who_i_am}\nTimestamp: ${new Date().toLocaleString()}\nStatus: Ready to receive commands` 
        });
        console.log('Connection notification sent to admin:', ADMIN_NUMBER);
      } catch (error) {
        console.error('Failed to send connection notification:', error);
      }
    }
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  // Listen for contact updates to maintain LID mapping
  sock.ev.on('contacts.update', (contacts) => {
    console.log('Contacts updated, refreshing LID mapping...');
    updateLidMapping(contacts);
  });
  
  sock.ev.on('contacts.upsert', (contacts) => {
    console.log('New contacts added, updating LID mapping...');
    updateLidMapping(contacts);
  });
  
  sock.ev.on('messages.upsert', async (m) => {
    const message = m.messages[0];
    if (!message.key.fromMe && m.type === 'notify') {
      // Ignore status broadcast messages
      if (message.key.remoteJid === 'status@broadcast') {
        console.log('Ignoring status broadcast message');
        return;
      }
      // Enhanced media message handling
      let messageText;
      let mediaInfo = null;
      
      if (message.message?.conversation) {
        messageText = message.message.conversation;
      } else if (message.message?.extendedTextMessage?.text) {
        messageText = message.message.extendedTextMessage.text;
      } else if (message.message?.imageMessage) {
        try {
          // Download the image media
          const imageBuffer = await downloadMediaMessage(message, 'buffer', {});
          const imageBase64 = imageBuffer ? imageBuffer.toString('base64') : null;
          
          mediaInfo = {
            type: 'image',
            caption: message.message.imageMessage.caption || '',
            mimetype: message.message.imageMessage.mimetype || 'image/jpeg',
            fileLength: message.message.imageMessage.fileLength || 0,
            imageData: imageBase64,
            width: message.message.imageMessage.width || null,
            height: message.message.imageMessage.height || null
          };
          messageText = mediaInfo.caption || 'Image message received';
          console.log('Image downloaded successfully, size:', imageBuffer ? imageBuffer.length : 0, 'bytes');
        } catch (error) {
          console.error('Error downloading image:', error);
          mediaInfo = {
            type: 'image',
            caption: message.message.imageMessage.caption || '',
            mimetype: message.message.imageMessage.mimetype || 'image/jpeg',
            fileLength: message.message.imageMessage.fileLength || 0,
            imageData: null,
            error: 'Failed to download image'
          };
          messageText = mediaInfo.caption || 'Image message received (download failed)';
        }
      } else if (message.message?.videoMessage) {
        try {
          // Download the video media
          const videoBuffer = await downloadMediaMessage(message, 'buffer', {});
          const videoBase64 = videoBuffer ? videoBuffer.toString('base64') : null;
          
          mediaInfo = {
            type: 'video',
            caption: message.message.videoMessage.caption || '',
            mimetype: message.message.videoMessage.mimetype || 'video/mp4',
            fileLength: message.message.videoMessage.fileLength || 0,
            seconds: message.message.videoMessage.seconds || 0,
            videoData: videoBase64,
            width: message.message.videoMessage.width || null,
            height: message.message.videoMessage.height || null
          };
          messageText = mediaInfo.caption || 'Video message received';
          console.log('Video downloaded successfully, size:', videoBuffer ? videoBuffer.length : 0, 'bytes');
        } catch (error) {
          console.error('Error downloading video:', error);
          mediaInfo = {
            type: 'video',
            caption: message.message.videoMessage.caption || '',
            mimetype: message.message.videoMessage.mimetype || 'video/mp4',
            fileLength: message.message.videoMessage.fileLength || 0,
            seconds: message.message.videoMessage.seconds || 0,
            videoData: null,
            error: 'Failed to download video'
          };
          messageText = mediaInfo.caption || 'Video message received (download failed)';
        }
      } else if (message.message?.audioMessage) {
        try {
          // Download the audio media
          const audioBuffer = await downloadMediaMessage(message, 'buffer', {});
          const audioBase64 = audioBuffer ? audioBuffer.toString('base64') : null;
          
          mediaInfo = {
            type: 'audio',
            mimetype: message.message.audioMessage.mimetype || 'audio/ogg',
            fileLength: message.message.audioMessage.fileLength || 0,
            seconds: message.message.audioMessage.seconds || 0,
            ptt: message.message.audioMessage.ptt || false,
            audioData: audioBase64
          };
          messageText = mediaInfo.ptt ? 'Voice message received' : 'Audio message received';
          console.log('Audio downloaded successfully, size:', audioBuffer ? audioBuffer.length : 0, 'bytes');
        } catch (error) {
          console.error('Error downloading audio:', error);
          mediaInfo = {
            type: 'audio',
            mimetype: message.message.audioMessage.mimetype || 'audio/ogg',
            fileLength: message.message.audioMessage.fileLength || 0,
            seconds: message.message.audioMessage.seconds || 0,
            ptt: message.message.audioMessage.ptt || false,
            audioData: null,
            error: 'Failed to download audio'
          };
          messageText = mediaInfo.ptt ? 'Voice message received (download failed)' : 'Audio message received (download failed)';
        }
      } else if (message.message?.documentMessage) {
        mediaInfo = {
          type: 'document',
          caption: message.message.documentMessage.caption || '',
          mimetype: message.message.documentMessage.mimetype || 'application/octet-stream',
          fileLength: message.message.documentMessage.fileLength || 0,
          fileName: message.message.documentMessage.fileName || 'Unknown file'
        };
        messageText = mediaInfo.caption || `Document: ${mediaInfo.fileName}`;
      } else {
        messageText = 'Media message received';
      }
      
      const sender = message.key.remoteJid;
      const formattedMessage = `**From:** ${sender}\n**Message:** ${messageText}`;
      
      console.log('New message:', formattedMessage);
      
      if (soket) {
        soket.emit('message', formattedMessage);
      }
      
      // Determine if we should reply to this message
      const senderNumber = lidToPhoneNumber(sender);
      const isGroup = sender.endsWith('@g.us');
      let shouldReply = false;
      
      console.log('Processing message from:', senderNumber, '(Raw sender:', sender, ')');
      
      // Check if we should reply to direct messages from admin
      if (!isGroup && senderNumber === ADMIN_NUMBER) {
        shouldReply = true;
      }
      
      // Check if we should reply to group messages (only when tagged)
      if (isGroup && who_i_am) {
        // Check for mentions in the message text
        const textMentions = [
          messageText.includes(`@${who_i_am}`),
          who_i_am_lid && messageText.includes(`@${who_i_am_lid}`)
        ];
        
        // Check for mentions in contextInfo
        const mentionedJids = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        
        console.log('Checking mentions:', {
          messageText,
          mentionedJids,
          who_i_am,
          who_i_am_lid,
          textMentions
        });
        
        // Check if any mentioned JID belongs to our API number
        const jidMentions = mentionedJids.some(jid => {
          const isOurNumber = isOurApiNumber(jid);
          console.log(`Checking JID: ${jid} -> isOurNumber: ${isOurNumber}`);
          return isOurNumber;
        });
        
        shouldReply = textMentions.some(Boolean) || jidMentions;
        
        console.log('Tag detection result:', {
          textMentions,
          jidMentions,
          shouldReply
        });
      }
      
      // Prepare message data for buffering or direct processing
      // Extract and format quoted message information
      let quotedMessageInfo = null;
      const contextInfo = message.message?.extendedTextMessage?.contextInfo || message.message?.imageMessage?.contextInfo || message.message?.videoMessage?.contextInfo || message.message?.audioMessage?.contextInfo || message.message?.documentMessage?.contextInfo;
      
      if (contextInfo?.quotedMessage) {
        const quoted = contextInfo.quotedMessage;
        let quotedText = '';
        let quotedType = 'unknown';
        let quotedMediaInfo = null;
        
        // Extract text and download media from different quoted message types
        if (quoted.conversation) {
          quotedText = quoted.conversation;
          quotedType = 'text';
        } else if (quoted.extendedTextMessage?.text) {
          quotedText = quoted.extendedTextMessage.text;
          quotedType = 'extended_text';
        } else if (quoted.imageMessage) {
          quotedText = quoted.imageMessage.caption || 'Image';
          quotedType = 'image';
          
          // Download quoted image
          try {
            const quotedImageBuffer = await downloadMediaMessage({ message: { imageMessage: quoted.imageMessage } }, 'buffer');
            quotedMediaInfo = {
              type: 'image',
              caption: quoted.imageMessage.caption || '',
              mimetype: quoted.imageMessage.mimetype || 'image/jpeg',
              fileLength: quoted.imageMessage.fileLength || 0,
              width: quoted.imageMessage.width || null,
              height: quoted.imageMessage.height || null,
              imageData: quotedImageBuffer ? quotedImageBuffer.toString('base64') : null
            };
            console.log(`Downloaded quoted image: ${quotedImageBuffer ? quotedImageBuffer.length : 0} bytes`);
          } catch (error) {
            console.error('Failed to download quoted image:', error.message);
            quotedMediaInfo = {
              type: 'image',
              caption: quoted.imageMessage.caption || '',
              mimetype: quoted.imageMessage.mimetype || 'image/jpeg',
              fileLength: quoted.imageMessage.fileLength || 0,
              width: quoted.imageMessage.width || null,
              height: quoted.imageMessage.height || null,
              imageData: null
            };
          }
        } else if (quoted.videoMessage) {
          quotedText = quoted.videoMessage.caption || 'Video';
          quotedType = 'video';
          
          // Download quoted video
          try {
            const quotedVideoBuffer = await downloadMediaMessage({ message: { videoMessage: quoted.videoMessage } }, 'buffer');
            quotedMediaInfo = {
              type: 'video',
              caption: quoted.videoMessage.caption || '',
              mimetype: quoted.videoMessage.mimetype || 'video/mp4',
              fileLength: quoted.videoMessage.fileLength || 0,
              seconds: quoted.videoMessage.seconds || null,
              width: quoted.videoMessage.width || null,
              height: quoted.videoMessage.height || null,
              videoData: quotedVideoBuffer ? quotedVideoBuffer.toString('base64') : null
            };
            console.log(`Downloaded quoted video: ${quotedVideoBuffer ? quotedVideoBuffer.length : 0} bytes`);
          } catch (error) {
            console.error('Failed to download quoted video:', error.message);
            quotedMediaInfo = {
              type: 'video',
              caption: quoted.videoMessage.caption || '',
              mimetype: quoted.videoMessage.mimetype || 'video/mp4',
              fileLength: quoted.videoMessage.fileLength || 0,
              seconds: quoted.videoMessage.seconds || null,
              width: quoted.videoMessage.width || null,
              height: quoted.videoMessage.height || null,
              videoData: null
            };
          }
        } else if (quoted.audioMessage) {
          quotedText = quoted.audioMessage.ptt ? 'Voice message' : 'Audio';
          quotedType = 'audio';
          
          // Download quoted audio
          try {
            const quotedAudioBuffer = await downloadMediaMessage({ message: { audioMessage: quoted.audioMessage } }, 'buffer');
            quotedMediaInfo = {
              type: 'audio',
              mimetype: quoted.audioMessage.mimetype || 'audio/ogg',
              fileLength: quoted.audioMessage.fileLength || 0,
              seconds: quoted.audioMessage.seconds || null,
              ptt: quoted.audioMessage.ptt || false,
              audioData: quotedAudioBuffer ? quotedAudioBuffer.toString('base64') : null
            };
            console.log(`Downloaded quoted audio: ${quotedAudioBuffer ? quotedAudioBuffer.length : 0} bytes`);
          } catch (error) {
            console.error('Failed to download quoted audio:', error.message);
            quotedMediaInfo = {
              type: 'audio',
              mimetype: quoted.audioMessage.mimetype || 'audio/ogg',
              fileLength: quoted.audioMessage.fileLength || 0,
              seconds: quoted.audioMessage.seconds || null,
              ptt: quoted.audioMessage.ptt || false,
              audioData: null
            };
          }
        } else if (quoted.documentMessage) {
          quotedText = quoted.documentMessage.caption || quoted.documentMessage.fileName || 'Document';
          quotedType = 'document';
          
          quotedMediaInfo = {
            type: 'document',
            fileName: quoted.documentMessage.fileName || 'Unknown',
            caption: quoted.documentMessage.caption || '',
            mimetype: quoted.documentMessage.mimetype || 'application/octet-stream',
            fileLength: quoted.documentMessage.fileLength || 0
          };
        }
        
        quotedMessageInfo = {
          type: quotedType,
          text: quotedText,
          participant: contextInfo.participant || 'Unknown',
          messageId: contextInfo.stanzaId || null,
          mediaInfo: quotedMediaInfo,
          raw: quoted // Keep raw data for advanced processing
        };
      }

      // Create universal media object for consistent handling
      let universalMedia = null;
      let hasAttachment = false;
      let attachmentType = 'none';
      
      // Check for direct media first
      if (mediaInfo) {
        universalMedia = {
          ...mediaInfo,
          isQuoted: false,
          source: 'direct'
        };
        hasAttachment = true;
        attachmentType = mediaInfo.type;
      }
      // Check for quoted media if no direct media
      else if (quotedMessageInfo && quotedMessageInfo.mediaInfo) {
        universalMedia = {
          ...quotedMessageInfo.mediaInfo,
          isQuoted: true,
          source: 'quoted',
          quotedFrom: quotedMessageInfo.participant,
          quotedMessageId: quotedMessageInfo.messageId
        };
        hasAttachment = true;
        attachmentType = quotedMessageInfo.mediaInfo.type;
      }
      
      // Determine primary message type
      let primaryMessageType = 'text';
      if (message.message?.conversation) {
        primaryMessageType = 'text';
      } else if (message.message?.extendedTextMessage) {
        primaryMessageType = 'extended_text';
      } else if (mediaInfo) {
        primaryMessageType = mediaInfo.type;
      } else {
        primaryMessageType = 'unknown';
      }

      const messageData = {
        timestamp: new Date().toISOString(),
        messageId: message.key.id,
        from: sender,
        fromNumber: senderNumber,
        message: messageText,
        messageType: primaryMessageType,
        hasAttachment: hasAttachment,
        attachmentType: attachmentType,
        media: universalMedia,
        isGroup: isGroup,
        pushName: message.pushName || 'Unknown',
        quotedMessage: quotedMessageInfo,
        mentionedJids: message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [],
        botNumber: who_i_am,
        botLid: who_i_am_lid,
        shouldReply: shouldReply
      };

      // If we should reply, try to buffer the message first
      if (shouldReply) {
        try {
          // Try to add to message buffer
          const wasBuffered = addToMessageBuffer(senderNumber, messageData);
          
          if (!wasBuffered) {
            // Buffering is disabled, process immediately
            await processMessageForReply(messageData);
          }
          // If buffered, the flushMessageBuffer function will handle processing
        } catch (error) {
          console.error('Error in message buffering/processing:', error.message);
          // Fallback to default reply
          await sendDefaultReply(sender, isGroup);
        }
      } else {
        // For non-reply messages, try buffering for logging
        const wasBuffered = addToMessageBuffer(senderNumber, messageData);
        
        if (!wasBuffered) {
          // Buffering disabled, send directly for logging
          await processMessageForLogging(messageData);
        }
      }
      

      

    }
  });
}

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  soket = socket;
  
  socket.emit('message', 'Connected to WhatsApp API server');
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Starting WhatsApp connection...');
  connectToWhatsApp();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  if (sock) {
    sock.end();
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});