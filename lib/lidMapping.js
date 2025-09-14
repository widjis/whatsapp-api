/**
 * Enhanced LID Mapping Module
 * Scans entire chats, extracts contacts, maps LIDs to phone numbers using push names
 * Saves contact data to JSON file for persistence
 */

const fs = require('fs').promises;
const path = require('path');

class LIDMappingManager {
  constructor(options = {}) {
    this.contactsFile = options.contactsFile || path.join(__dirname, '..', 'data', 'contacts.json');
    this.lidMapping = new Map(); // LID -> Phone Number (same as lidToPhone)
    this.phoneToLidMapping = new Map(); // Phone Number -> LID (same as phoneToLid)
    this.pushNameMapping = new Map(); // LID -> Display Name
    this.contactsDatabase = new Map(); // Complete contact information
    this.chatParticipants = new Map(); // Chat ID -> Set of participants
    this.sock = null;
    this.isInitialized = false;
    
    // Statistics
    this.stats = {
      totalContacts: 0,
      mappedLids: 0,
      scannedChats: 0,
      lastScanTime: null
    };
  }

  /**
   * Initialize the LID mapping manager with WhatsApp socket
   */
  async initialize(sock) {
    this.sock = sock;
    await this.ensureDataDirectory();
    await this.loadContactsFromFile();
    this.setupEventListeners();
    this.isInitialized = true;
    
    // Add known LID mapping for 6285712612218 -> 80444922015783
    this.addKnownLidMapping();
    
    console.log('✅ LID Mapping Manager initialized');
  }

  /**
   * Ensure data directory exists
   */
  async ensureDataDirectory() {
    const dataDir = path.dirname(this.contactsFile);
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.error('Error creating data directory:', error);
      }
    }
  }

  /**
   * Setup event listeners for real-time contact updates
   */
  setupEventListeners() {
    if (!this.sock) return;

    // Listen for contact updates
    this.sock.ev.on('contacts.update', (contacts) => {
      this.updateContactMappings(contacts);
    });

    this.sock.ev.on('contacts.upsert', (contacts) => {
      this.updateContactMappings(contacts);
    });

    // Listen for chat updates to track participants
    this.sock.ev.on('chats.update', (chats) => {
      this.processChatUpdates(chats);
    });

    // Listen for messages to extract contact info
    this.sock.ev.on('messages.upsert', (messageUpdate) => {
      this.processMessageContacts(messageUpdate);
    });

    console.log('📡 Event listeners setup for real-time contact tracking');
  }

  /**
   * Scan entire chat history to extract contacts and build mappings
   */
  async scanAllChats() {
    if (!this.sock) {
      throw new Error('Socket not initialized. Call initialize() first.');
    }

    console.log('🔍 Starting comprehensive chat scan...');
    this.stats.lastScanTime = new Date();
    this.stats.scannedChats = 0;

    try {
      // Get all chats from store if available
      let chats = [];
      
      if (this.sock.store && this.sock.store.chats) {
        // Use store if available
        chats = Object.values(this.sock.store.chats.all());
        console.log(`📊 Found ${chats.length} chats in store to scan`);
      } else {
        // Fallback: Use existing chat participants we've collected from events
         chats = Array.from(this.chatParticipants.keys()).map(id => ({ id }));
         console.log(`📊 Found ${chats.length} chats from events to scan`);
         
         if (chats.length === 0) {
           console.log('⚠️ No chats found. Chat scanning will happen as messages are received.');
           return;
         }
      }

      for (const chat of chats) {
        await this.scanChatForContacts(chat);
        this.stats.scannedChats++;
        
        // Add small delay to prevent rate limiting
        await this.delay(100);
      }

      // Save updated contacts to file
      await this.saveContactsToFile();
      
      console.log('✅ Chat scan completed');
      this.printScanSummary();
      
    } catch (error) {
      console.error('❌ Error during chat scan:', error);
      throw error;
    }
  }

  /**
   * Scan individual chat for contact information
   */
  async scanChatForContacts(chat) {
    try {
      const chatId = chat.id;
      
      // Initialize participant set for this chat
      if (!this.chatParticipants.has(chatId)) {
        this.chatParticipants.set(chatId, new Set());
      }
      
      // For group chats, get participant information
      if (chatId.endsWith('@g.us')) {
        await this.scanGroupChatParticipants(chatId);
      }
      
      // Scan recent messages for contact info
      await this.scanChatMessages(chatId);
      
    } catch (error) {
      console.error(`Error scanning chat ${chat.id}:`, error.message);
    }
  }

  /**
   * Scan group chat participants
   */
  async scanGroupChatParticipants(groupId) {
    try {
      const groupMetadata = await this.sock.groupMetadata(groupId);
      
      if (groupMetadata && groupMetadata.participants) {
        for (const participant of groupMetadata.participants) {
          const participantId = participant.id;
          
          // Add to chat participants
          this.chatParticipants.get(groupId).add(participantId);
          
          // Extract contact information
          await this.processContactFromParticipant(participant, groupId);
        }
        
        console.log(`📋 Scanned ${groupMetadata.participants.length} participants in group: ${groupMetadata.subject || groupId}`);
      }
    } catch (error) {
      console.error(`Error scanning group participants for ${groupId}:`, error.message);
    }
  }

  /**
   * Scan chat messages for contact information
   */
  async scanChatMessages(chatId, limit = 50) {
    try {
      const messages = await this.sock.fetchMessagesFromWA(chatId, limit);
      
      for (const message of messages) {
        if (message.key && message.key.participant) {
          await this.processContactFromMessage(message, chatId);
        }
      }
    } catch (error) {
      // Some chats might not allow message fetching, continue silently
      console.log(`Note: Could not fetch messages from ${chatId}`);
    }
  }

  /**
   * Process contact information from group participant
   */
  async processContactFromParticipant(participant, groupId) {
    const participantId = participant.id;
    const phoneNumber = this.extractPhoneNumber(participantId);
    const lid = this.extractLID(participantId);
    
    // Try to get push name from contact info
    let pushName = null;
    try {
      const contactInfo = await this.sock.onWhatsApp(phoneNumber);
      if (contactInfo && contactInfo[0]) {
        pushName = contactInfo[0].notify || contactInfo[0].name;
      }
    } catch (error) {
      // Continue without push name
    }
    
    // Store contact information
    this.storeContactInfo({
      id: participantId,
      phoneNumber,
      lid,
      pushName,
      source: 'group_participant',
      groupId,
      lastSeen: new Date().toISOString()
    });
  }

  /**
   * Process contact information from message
   */
  async processContactFromMessage(message, chatId) {
    const senderId = message.key.participant || message.key.remoteJid;
    const phoneNumber = this.extractPhoneNumber(senderId);
    const lid = this.extractLID(senderId);
    
    // Extract push name from message
    const pushName = message.pushName || message.verifiedBizName;
    
    // Processing message contact information
    console.log(`Sender ID:`, senderId);
    console.log(`Phone Number:`, phoneNumber);
    console.log(`LID:`, lid);
    console.log(`Push Name:`, pushName);
    console.log(`Chat ID:`, chatId);
    // Message details processed
    // Message contact processing completed
    
    // Store contact information
    this.storeContactInfo({
      id: senderId,
      phoneNumber,
      lid,
      pushName,
      source: 'message',
      chatId,
      messageTimestamp: message.messageTimestamp,
      lastSeen: new Date().toISOString()
    });
  }

  /**
   * Store contact information in all mappings
   */
  storeContactInfo(contactInfo) {
    const { id, phoneNumber, pushName } = contactInfo;
    let { lid } = contactInfo;
    
    // Storing contact information
    // Contact info prepared
    console.log(`Current Contacts DB Size:`, this.contactsDatabase.size);
    
    if (!id) return;
    
    // Check for existing contact to preserve LID and handle pushName conflicts
    const existingContact = this.contactsDatabase.get(id);
    console.log(`Existing Contact:`, existingContact ? 'Found' : 'None');
    
    // Preserve existing LID if new contact doesn't have one
    if (!lid && existingContact && existingContact.lid) {
      lid = existingContact.lid;
      contactInfo.lid = lid;
      console.log(`📝 Preserved existing LID mapping: ${phoneNumber} -> ${lid}`);
    }
    
    // Also check phoneToLidMapping for existing mappings
    if (!lid && phoneNumber && this.phoneToLidMapping.has(phoneNumber)) {
      lid = this.phoneToLidMapping.get(phoneNumber);
      contactInfo.lid = lid;
      console.log(`📝 Applied existing phone-to-LID mapping: ${phoneNumber} -> ${lid}`);
    }
    
    if (existingContact && existingContact.pushName && pushName && 
        existingContact.pushName !== pushName) {
      console.log(`⚠️ PushName conflict detected for ${phoneNumber}: existing "${existingContact.pushName}" vs new "${pushName}"`);
      
      // Prioritize message-based pushName over contact_event pushName
      if (contactInfo.source === 'message' && existingContact.source === 'contact_event') {
        console.log(`✅ Using message-based pushName: "${pushName}"`);
      } else if (existingContact.source === 'message' && contactInfo.source === 'contact_event') {
        console.log(`✅ Keeping existing message-based pushName: "${existingContact.pushName}"`);
        contactInfo.pushName = existingContact.pushName;
      }
    }
    
    // Store in contacts database
    this.contactsDatabase.set(id, contactInfo);
    console.log(`✅ Stored contact in database: ${contactInfo.phoneNumber} (${contactInfo.pushName || 'No name'})`);
    
    // Update LID mappings
    if (lid && phoneNumber) {
      this.lidMapping.set(lid, phoneNumber);
      this.lidMapping.set(id, phoneNumber);
      this.phoneToLidMapping.set(phoneNumber, lid);
      this.stats.mappedLids++;
      console.log(`🔗 Updated LID mappings: ${phoneNumber} <-> ${lid}`);
    }
    
    // Update push name mapping with synchronization
    if (contactInfo.pushName) {
      this.pushNameMapping.set(id, contactInfo.pushName);
      if (lid) {
        this.pushNameMapping.set(lid, contactInfo.pushName);
        
        // Synchronize pushName between phone contact and LID contact
        const phoneContactId = `${phoneNumber}@s.whatsapp.net`;
        const lidContactId = `${lid}@lid`;
        
        // If this is a LID contact, update the corresponding phone contact
        if (id === lidContactId && phoneContactId !== id) {
          this.pushNameMapping.set(phoneContactId, contactInfo.pushName);
          console.log(`🔄 Synchronized pushName "${contactInfo.pushName}" from LID to phone contact: ${phoneContactId}`);
          // Syncing pushName details
          // LID contact details synced
          console.log(`To Contact ID:`, phoneContactId);
          // PushName sync completed
        }
        
        // If this is a phone contact, update the corresponding LID contact
        if (id === phoneContactId && lidContactId !== id) {
          this.pushNameMapping.set(lidContactId, contactInfo.pushName);
          console.log(`🔄 Synchronized pushName "${contactInfo.pushName}" from phone to LID contact: ${lidContactId}`);
          // PushName sync from phone to LID completed
        }
      }
    }
    
    this.stats.totalContacts++;
    
    console.log(`📝 Stored contact: ${phoneNumber} (${contactInfo.pushName || 'No name'}) [${lid || 'No LID'}]`);
    // Contact information stored
  }

  /**
   * Update contact mappings from contact events
   */
  updateContactMappings(contacts) {
    if (!contacts || !Array.isArray(contacts)) return;
    
    contacts.forEach(contact => {
      if (contact.id) {
        const phoneNumber = this.extractPhoneNumber(contact.id);
        let lid = this.extractLID(contact.id);
        
        // Check for existing contact to preserve LID mapping
        const existingContact = this.contactsDatabase.get(contact.id);
        if (!lid && existingContact && existingContact.lid) {
          lid = existingContact.lid;
          console.log(`📝 Preserved existing LID mapping: ${phoneNumber} -> ${lid}`);
        }
        
        this.storeContactInfo({
          id: contact.id,
          phoneNumber,
          lid,
          pushName: contact.notify || contact.name,
          source: 'contact_event',
          lastSeen: new Date().toISOString()
        });
      }
    });
    
    // Auto-save after contact updates
    this.saveContactsToFile().catch(console.error);
  }

  /**
   * Process chat updates
   */
  processChatUpdates(chats) {
    chats.forEach(chat => {
      if (chat.id && !this.chatParticipants.has(chat.id)) {
        this.chatParticipants.set(chat.id, new Set());
      }
    });
  }

  /**
   * Process message contacts
   */
  processMessageContacts(messageUpdate) {
    if (messageUpdate.messages) {
      messageUpdate.messages.forEach(message => {
        if (message.key) {
          const senderId = message.key.participant || message.key.remoteJid;
          const chatId = message.key.remoteJid;
          
          if (senderId && chatId) {
            this.processContactFromMessage(message, chatId);
          }
        }
      });
    }
  }

  /**
   * Process incoming message for contact mapping
   */
  processMessage(messageInfo) {
    const { from, pushName, messageTimestamp } = messageInfo;
    
    if (!from) return;
    
    const phoneNumber = from.replace('@s.whatsapp.net', '');
    
    // Check for existing contact to preserve LID and pushName
    const existingContact = this.contactsDatabase.get(from);
    let contactLid = null;
    let contactPushName = pushName || null;
    
    // Preserve existing LID if available
    if (existingContact && existingContact.lid) {
      contactLid = existingContact.lid;
    } else {
      // Check if we have a LID mapping for this phone number
      const mappedLid = this.phoneToLidMapping.get(phoneNumber);
      if (mappedLid) {
        contactLid = mappedLid;
        console.log(`📱 Found existing LID mapping: ${phoneNumber} -> ${mappedLid}`);
      }
    }
    
    // Preserve existing pushName if current message doesn't have one
    if (!contactPushName && existingContact && existingContact.pushName) {
      contactPushName = existingContact.pushName;
      console.log(`📝 Preserved existing pushName: ${contactPushName} for ${phoneNumber}`);
    }
    
    const contactInfo = {
      id: from,
      phoneNumber,
      lid: contactLid,
      pushName: contactPushName,
      source: 'message',
      chatId: from,
      messageTimestamp,
      lastSeen: new Date().toISOString()
    };
    
    this.storeContactInfo(contactInfo);
    
    console.log(`📨 Processed message from: ${phoneNumber} (${contactPushName || 'No name'}) [${contactLid || 'No LID'}]`);
  }

  /**
   * Extract phone number from WhatsApp ID
   */
  extractPhoneNumber(id) {
    if (!id) return null;
    
    // Check if we have this in our mapping
    if (this.lidMapping.has(id)) {
      return this.lidMapping.get(id);
    }
    
    // Remove @s.whatsapp.net, @g.us, or @lid suffix
    const cleanId = id.split('@')[0];
    
    // Check if we have the clean ID in our mapping
    if (this.lidMapping.has(cleanId)) {
      return this.lidMapping.get(cleanId);
    }
    
    // Handle @lid suffix format
    if (id.endsWith('@lid')) {
      if (/^\d+$/.test(cleanId)) {
        return cleanId;
      }
    }
    
    // LID format: phoneNumber:deviceId or phoneNumber.deviceId
    const phoneMatch = cleanId.match(/^(\d+)[:.]?/);
    if (phoneMatch && phoneMatch[1]) {
      return phoneMatch[1];
    }
    
    // If it's already a phone number, return as is
    if (/^\d+$/.test(cleanId)) {
      return cleanId;
    }
    
    return cleanId;
  }

  /**
   * Extract LID from WhatsApp ID
   */
  extractLID(id) {
    if (!id) return null;
    
    const cleanId = id.split('@')[0];
    
    // If it contains : or . it's likely a LID
    if (cleanId.includes(':') || cleanId.includes('.')) {
      return cleanId;
    }
    
    // If it ends with @lid, it's a LID
    if (id.endsWith('@lid')) {
      return cleanId;
    }
    
    return null;
  }

  /**
   * Get correct pushName for a sender ID
   */
  getCorrectPushName(senderId, fallbackPushName = null) {
    console.log('🔍 LID MANAGER getCorrectPushName DEBUG:');
    console.log('  - Input senderId:', senderId);
    console.log('  - Input fallbackPushName:', fallbackPushName);
    
    if (!senderId) {
      console.log('  - No senderId provided, returning fallback');
      return fallbackPushName || 'Unknown';
    }
    
    // First check if we have the contact in our database
    const contact = this.contactsDatabase.get(senderId);
    console.log('  - Contact from database:', contact);
    if (contact && contact.pushName) {
      console.log('  - Found pushName in database:', contact.pushName);
      return contact.pushName;
    }
    
    // Check pushName mapping
    console.log('  - Checking pushName mapping for:', senderId);
    if (this.pushNameMapping.has(senderId)) {
      const mappedName = this.pushNameMapping.get(senderId);
      console.log('  - Found in pushName mapping:', mappedName);
      return mappedName;
    }
    
    // For phone numbers, also check if we have a LID mapping with pushName
    const phoneNumber = this.extractPhoneNumber(senderId);
    console.log('  - Extracted phone number:', phoneNumber);
    if (phoneNumber && this.phoneToLidMapping.has(phoneNumber)) {
      const lid = this.phoneToLidMapping.get(phoneNumber);
      const lidContactId = `${lid}@lid`;
      console.log('  - Found LID mapping:', phoneNumber, '->', lid, '(', lidContactId, ')');
      
      // Check LID contact in database
      const lidContact = this.contactsDatabase.get(lidContactId);
      console.log('  - LID contact from database:', lidContact);
      if (lidContact && lidContact.pushName) {
        console.log('  - Found pushName in LID database:', lidContact.pushName);
        return lidContact.pushName;
      }
      
      // Check LID in pushName mapping
      if (this.pushNameMapping.has(lidContactId)) {
        const lidMappedName = this.pushNameMapping.get(lidContactId);
        console.log('  - Found in LID pushName mapping:', lidMappedName);
        return lidMappedName;
      }
    }
    
    console.log('  - No mapping found, returning fallback:', fallbackPushName || 'Unknown');
    return fallbackPushName || 'Unknown';
  }

  /**
   * Convert LID to phone number (legacy function for compatibility)
   */
  lidToPhoneNumber(lid) {
    return this.extractPhoneNumber(lid);
  }

  /**
   * Check if a LID belongs to a specific phone number
   */
  isPhoneNumber(lid, phoneNumber) {
    const extractedPhone = this.extractPhoneNumber(lid);
    return extractedPhone === phoneNumber;
  }

  /**
   * Get contact information by ID
   */
  getContactInfo(id) {
    return this.contactsDatabase.get(id) || null;
  }

  /**
   * Get push name by ID
   */
  getPushName(id) {
    return this.pushNameMapping.get(id) || null;
  }

  /**
   * Get all contacts as array
   */
  getAllContacts() {
    return Array.from(this.contactsDatabase.values());
  }

  /**
   * Search contacts by phone number
   */
  searchByPhoneNumber(phoneNumber) {
    return this.getAllContacts().filter(contact => 
      contact.phoneNumber === phoneNumber
    );
  }

  /**
   * Search contacts by push name
   */
  searchByPushName(pushName) {
    return this.getAllContacts().filter(contact => 
      contact.pushName && contact.pushName.toLowerCase().includes(pushName.toLowerCase())
    );
  }

  /**
   * Save contacts to JSON file
   */
  async saveContactsToFile() {
    try {
      const contactsData = {
        metadata: {
          lastUpdated: new Date().toISOString(),
          totalContacts: this.stats.totalContacts,
          mappedLids: this.stats.mappedLids,
          scannedChats: this.stats.scannedChats,
          lastScanTime: this.stats.lastScanTime
        },
        contacts: Array.from(this.contactsDatabase.values()),
        lidMappings: Object.fromEntries(this.lidMapping),
        phoneToLidMappings: Object.fromEntries(this.phoneToLidMapping),
        pushNameMappings: Object.fromEntries(this.pushNameMapping)
      };
      
      await fs.writeFile(this.contactsFile, JSON.stringify(contactsData, null, 2), 'utf8');
      console.log(`💾 Contacts saved to ${this.contactsFile}`);
      console.log(`📊 Total contacts: ${this.stats.totalContacts}, Mapped LIDs: ${this.stats.mappedLids}`);
      
    } catch (error) {
      console.error('❌ Error saving contacts to file:', error);
      throw error;
    }
  }

  /**
   * Load contacts from JSON file
   */
  async loadContactsFromFile() {
    try {
      const data = await fs.readFile(this.contactsFile, 'utf8');
      const contactsData = JSON.parse(data);
      
      // Restore contacts database
      if (contactsData.contacts) {
        contactsData.contacts.forEach(contact => {
          this.contactsDatabase.set(contact.id, contact);
        });
      }
      
      // Restore mappings
      if (contactsData.lidMappings) {
        Object.entries(contactsData.lidMappings).forEach(([lid, phone]) => {
          this.lidMapping.set(lid, phone);
        });
      }
      
      if (contactsData.phoneToLidMappings) {
        Object.entries(contactsData.phoneToLidMappings).forEach(([phone, lid]) => {
          this.phoneToLidMapping.set(phone, lid);
        });
      }
      
      if (contactsData.pushNameMappings) {
        Object.entries(contactsData.pushNameMappings).forEach(([id, name]) => {
          this.pushNameMapping.set(id, name);
        });
      }
      
      // Restore stats
      if (contactsData.metadata) {
        this.stats = { ...this.stats, ...contactsData.metadata };
      }
      
      console.log(`📂 Loaded ${this.contactsDatabase.size} contacts from file`);
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('📝 No existing contacts file found, starting fresh');
      } else {
        console.error('❌ Error loading contacts from file:', error);
      }
    }
  }

  /**
   * Print scan summary
   */
  printScanSummary() {
    console.log('\n📊 === LID Mapping Scan Summary ===');
    console.log(`📱 Total Contacts: ${this.stats.totalContacts}`);
    console.log(`🔗 Mapped LIDs: ${this.stats.mappedLids}`);
    console.log(`💬 Scanned Chats: ${this.stats.scannedChats}`);
    console.log(`⏰ Last Scan: ${this.stats.lastScanTime}`);
    console.log(`💾 Contacts File: ${this.contactsFile}`);
    console.log('=====================================\n');
  }

  /**
   * Get mapping statistics
   */
  getStats() {
    return {
      ...this.stats,
      contactsInMemory: this.contactsDatabase.size,
      lidMappingsCount: this.lidMapping.size,
      phoneToLidMappingsCount: this.phoneToLidMapping.size,
      pushNameMappingsCount: this.pushNameMapping.size
    };
  }

  /**
   * Utility function for delays
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Export contacts to different formats
   */
  async exportContacts(format = 'json', filename = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultFilename = `contacts-export-${timestamp}`;
    
    switch (format.toLowerCase()) {
      case 'json':
        const jsonFile = filename || `${defaultFilename}.json`;
        await this.saveContactsToFile();
        console.log(`📤 Contacts exported to JSON: ${jsonFile}`);
        break;
        
      case 'csv':
        const csvFile = filename || `${defaultFilename}.csv`;
        await this.exportToCSV(csvFile);
        break;
        
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Export contacts to CSV format
   */
  async exportToCSV(filename) {
    const contacts = this.getAllContacts();
    const csvHeader = 'ID,Phone Number,LID,Push Name,Source,Last Seen\n';
    
    const csvRows = contacts.map(contact => {
      return [
        contact.id || '',
        contact.phoneNumber || '',
        contact.lid || '',
        contact.pushName || '',
        contact.source || '',
        contact.lastSeen || ''
      ].map(field => `"${field.toString().replace(/"/g, '""')}"`).join(',');
    });
    
    const csvContent = csvHeader + csvRows.join('\n');
    const csvPath = path.join(path.dirname(this.contactsFile), filename);
    
    await fs.writeFile(csvPath, csvContent, 'utf8');
    console.log(`📤 Contacts exported to CSV: ${csvPath}`);
  }

  /**
   * Get contact by phone number
   */
  getContactByPhone(phoneNumber) {
    // Try direct lookup first
    const directContact = this.contactsDatabase.get(`${phoneNumber}@s.whatsapp.net`);
    if (directContact) return directContact;
    
    // Try LID lookup
    const lid = this.phoneToLidMapping.get(phoneNumber);
    if (lid) {
      return this.contactsDatabase.get(`${lid}@lid`);
    }
    
    return null;
  }

  /**
   * Add known LID mappings that we've identified
   */
  addKnownLidMapping() {
    console.log('🔧 Adding known LID mappings...');
    
    // Add the known mapping: 6285712612218 <-> 80444922015783 (Widji)
    const phoneNumber = '6285712612218';
    const lid = '80444922015783';
    const pushName = 'Widji';
    
    // Create LID contact if it doesn't exist
    const lidContactId = `${lid}@lid`;
    if (!this.contactsDatabase.has(lidContactId)) {
      console.log(`🔧 Creating LID contact: ${lid} (${pushName})`);
      this.contactsDatabase.set(lidContactId, {
        id: lidContactId,
        phoneNumber: phoneNumber,
        lid: lid,
        pushName: pushName,
        source: 'manual_mapping',
        lastSeen: new Date().toISOString()
      });
    }
    
    // Update mappings
    this.phoneToLidMapping.set(phoneNumber, lid);
    this.lidMapping.set(lid, phoneNumber);
    this.pushNameMapping.set(lidContactId, pushName);
    this.pushNameMapping.set(lid, pushName);
    
    console.log(`✅ Added known mapping: ${phoneNumber} <-> ${lid} (${pushName})`);
  }

  /**
   * Clean up false pushName mappings
   */
  cleanupFalseMappings() {
    console.log('🧹 Starting cleanup of false pushName mappings...');
    
    const pushNameCounts = new Map();
    const contactsByPushName = new Map();
    
    // Count pushName occurrences
    for (const [id, contact] of this.contactsDatabase) {
      if (contact.pushName) {
        const count = pushNameCounts.get(contact.pushName) || 0;
        pushNameCounts.set(contact.pushName, count + 1);
        
        if (!contactsByPushName.has(contact.pushName)) {
          contactsByPushName.set(contact.pushName, []);
        }
        contactsByPushName.get(contact.pushName).push({ id, contact });
      }
    }
    
    // Find and fix duplicates
    for (const [pushName, count] of pushNameCounts) {
      if (count > 1) {
        console.log(`⚠️ Found ${count} contacts with pushName "${pushName}"`);
        const contacts = contactsByPushName.get(pushName);
        
        // Keep the one with message source, remove from others
        const messageBasedContact = contacts.find(c => c.contact.source === 'message');
        if (messageBasedContact) {
          console.log(`✅ Keeping pushName "${pushName}" for message-based contact: ${messageBasedContact.contact.phoneNumber}`);
          
          // Remove pushName from other contacts
          contacts.forEach(({ id, contact }) => {
            if (id !== messageBasedContact.id && contact.source !== 'message') {
              console.log(`🔧 Removing pushName "${pushName}" from contact: ${contact.phoneNumber}`);
              contact.pushName = null;
              this.contactsDatabase.set(id, contact);
              
              // Update pushName mapping
              this.pushNameMapping.delete(id);
              if (contact.lid) {
                this.pushNameMapping.delete(contact.lid);
              }
            }
          });
        }
      }
    }
    
    console.log('✅ Cleanup completed');
  }

  /**
   * Link LID contacts with phone number contacts
   */
  linkLidToPhoneContacts() {
    console.log('🔗 Starting LID to phone number linking...');
    
    let linkedCount = 0;
    
    // Find phone number contacts that need linking
    for (const [id, contact] of this.contactsDatabase) {
      if (id.endsWith('@s.whatsapp.net')) {
        const phoneNumber = contact.phoneNumber;
        
        // Check if we have existing mappings that should be applied to this contact
        if (this.phoneToLidMapping.has(phoneNumber)) {
          const mappedLid = this.phoneToLidMapping.get(phoneNumber);
          const lidContactId = `${mappedLid}@lid`;
          const lidContact = this.contactsDatabase.get(lidContactId);
          
          // Update contact with LID if missing
          if (!contact.lid && mappedLid) {
            console.log(`🔗 Applying LID mapping: ${phoneNumber} -> ${mappedLid}`);
            contact.lid = mappedLid;
            linkedCount++;
          }
          
          // Update contact with pushName if missing and available from LID contact
          if (!contact.pushName && lidContact && lidContact.pushName) {
            console.log(`🔗 Applying pushName from LID contact: ${phoneNumber} -> "${lidContact.pushName}"`);
            contact.pushName = lidContact.pushName;
            this.pushNameMapping.set(id, lidContact.pushName);
          }
          
          // Also check pushName mappings
          if (!contact.pushName && this.pushNameMapping.has(id)) {
            const mappedPushName = this.pushNameMapping.get(id);
            console.log(`🔗 Applying pushName mapping: ${phoneNumber} -> "${mappedPushName}"`);
            contact.pushName = mappedPushName;
          }
          
          // Update the contact in database
          this.contactsDatabase.set(id, contact);
          
          if (contact.lid && contact.pushName) {
            console.log(`✅ Successfully linked ${phoneNumber} -> ${contact.lid} (${contact.pushName})`);
          }
        }
      }
    }
    
    console.log(`✅ LID linking completed. Linked ${linkedCount} contacts.`);
    return linkedCount;
  }
}

module.exports = LIDMappingManager;