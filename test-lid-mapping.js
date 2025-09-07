/**
 * Test Script for Enhanced LID Mapping System
 * Demonstrates the functionality of the refactored LID mapping module
 */

const axios = require('axios');

const API_BASE = 'http://localhost:8192/api';

class LIDMappingTester {
  constructor() {
    this.baseUrl = API_BASE;
  }

  async testConnection() {
    try {
      console.log('🔗 Testing WhatsApp connection...');
      const response = await axios.get(`${this.baseUrl}/status`);
      console.log('✅ Connection Status:', response.data);
      return response.data.status === 'connected';
    } catch (error) {
      console.error('❌ Connection test failed:', error.message);
      return false;
    }
  }

  async getLIDStats() {
    try {
      console.log('\n📊 Getting LID mapping statistics...');
      const response = await axios.get(`${this.baseUrl}/lid/stats`);
      
      if (response.data.success) {
        const stats = response.data.stats;
        console.log('✅ LID Mapping Statistics:');
        console.log(`   📱 Total Contacts: ${stats.totalContacts}`);
        console.log(`   🔗 Mapped LIDs: ${stats.mappedLids}`);
        console.log(`   💬 Scanned Chats: ${stats.scannedChats}`);
        console.log(`   💾 Contacts in Memory: ${stats.contactsInMemory}`);
        console.log(`   📋 LID Mappings: ${stats.lidMappingsCount}`);
        console.log(`   📞 Phone Mappings: ${stats.phoneToLidMappingsCount}`);
        console.log(`   👤 Push Name Mappings: ${stats.pushNameMappingsCount}`);
        console.log(`   ⏰ Last Scan: ${stats.lastScanTime || 'Never'}`);
        return stats;
      } else {
        console.error('❌ Failed to get stats:', response.data.error);
        return null;
      }
    } catch (error) {
      console.error('❌ Error getting LID stats:', error.message);
      return null;
    }
  }

  async getAllContacts() {
    try {
      console.log('\n📋 Getting all contacts...');
      const response = await axios.get(`${this.baseUrl}/lid/contacts`);
      
      if (response.data.success) {
        const contacts = response.data.contacts;
        console.log(`✅ Retrieved ${contacts.length} contacts`);
        
        // Show first 5 contacts as sample
        console.log('\n📝 Sample contacts:');
        contacts.slice(0, 5).forEach((contact, index) => {
          console.log(`   ${index + 1}. ${contact.phoneNumber || 'No phone'} (${contact.pushName || 'No name'})`);
          console.log(`      ID: ${contact.id}`);
          console.log(`      LID: ${contact.lid || 'No LID'}`);
          console.log(`      Source: ${contact.source}`);
          console.log(`      Last Seen: ${contact.lastSeen}`);
          console.log('');
        });
        
        return contacts;
      } else {
        console.error('❌ Failed to get contacts:', response.data.error);
        return [];
      }
    } catch (error) {
      console.error('❌ Error getting contacts:', error.message);
      return [];
    }
  }

  async searchContacts(searchTerm, type = 'name') {
    try {
      console.log(`\n🔍 Searching contacts by ${type}: "${searchTerm}"...`);
      const response = await axios.get(`${this.baseUrl}/lid/contacts`, {
        params: { search: searchTerm, type }
      });
      
      if (response.data.success) {
        const contacts = response.data.contacts;
        console.log(`✅ Found ${contacts.length} matching contacts`);
        
        contacts.forEach((contact, index) => {
          console.log(`   ${index + 1}. ${contact.phoneNumber || 'No phone'} (${contact.pushName || 'No name'})`);
          console.log(`      ID: ${contact.id}`);
          console.log(`      LID: ${contact.lid || 'No LID'}`);
          console.log('');
        });
        
        return contacts;
      } else {
        console.error('❌ Search failed:', response.data.error);
        return [];
      }
    } catch (error) {
      console.error('❌ Error searching contacts:', error.message);
      return [];
    }
  }

  async getContactById(contactId) {
    try {
      console.log(`\n👤 Getting contact details for: ${contactId}...`);
      const response = await axios.get(`${this.baseUrl}/lid/contact/${encodeURIComponent(contactId)}`);
      
      if (response.data.success) {
        const contact = response.data.contact;
        console.log('✅ Contact Details:');
        console.log(`   📞 Phone: ${contact.phoneNumber || 'No phone'}`);
        console.log(`   👤 Name: ${contact.pushName || 'No name'}`);
        console.log(`   🆔 ID: ${contact.id}`);
        console.log(`   🔗 LID: ${contact.lid || 'No LID'}`);
        console.log(`   📍 Source: ${contact.source}`);
        console.log(`   💬 Chat ID: ${contact.chatId || 'N/A'}`);
        console.log(`   📅 Last Seen: ${contact.lastSeen}`);
        
        if (contact.groupId) {
          console.log(`   👥 Group ID: ${contact.groupId}`);
        }
        
        return contact;
      } else {
        console.error('❌ Contact not found:', response.data.error);
        return null;
      }
    } catch (error) {
      console.error('❌ Error getting contact:', error.message);
      return null;
    }
  }

  async startChatScan() {
    try {
      console.log('\n🚀 Starting comprehensive chat scan...');
      const response = await axios.post(`${this.baseUrl}/lid/scan`);
      
      if (response.data.success) {
        console.log('✅ Chat scan started successfully');
        console.log('   📝 Check server logs for scan progress');
        console.log('   ⏳ This may take several minutes depending on chat history');
        return true;
      } else {
        console.error('❌ Failed to start scan:', response.data.error);
        return false;
      }
    } catch (error) {
      console.error('❌ Error starting chat scan:', error.message);
      return false;
    }
  }

  async exportContacts(format = 'json') {
    try {
      console.log(`\n💾 Exporting contacts in ${format} format...`);
      const response = await axios.post(`${this.baseUrl}/lid/export`, { format });
      
      if (response.data.success) {
        console.log('✅ Contacts exported successfully');
        console.log('   📁 Check the data/ directory for exported files');
        return true;
      } else {
        console.error('❌ Export failed:', response.data.error);
        return false;
      }
    } catch (error) {
      console.error('❌ Error exporting contacts:', error.message);
      return false;
    }
  }

  async runFullTest() {
    console.log('🧪 === LID Mapping System Test Suite ===\n');
    
    // Test 1: Connection
    const isConnected = await this.testConnection();
    if (!isConnected) {
      console.log('❌ WhatsApp not connected. Please connect first.');
      return;
    }
    
    // Wait a moment for initialization
    console.log('⏳ Waiting for LID Mapping Manager initialization...');
    await this.delay(3000);
    
    // Test 2: Get Statistics
    const stats = await this.getLIDStats();
    if (!stats) {
      console.log('❌ LID Mapping Manager not ready. Try again later.');
      return;
    }
    
    // Test 3: Get All Contacts
    const contacts = await this.getAllContacts();
    
    // Test 4: Search Contacts (if we have any)
    if (contacts.length > 0) {
      // Search by phone number (use first contact's phone)
      const firstContact = contacts.find(c => c.phoneNumber);
      if (firstContact) {
        await this.searchContacts(firstContact.phoneNumber, 'phone');
      }
      
      // Search by name (use first contact's name)
      const namedContact = contacts.find(c => c.pushName);
      if (namedContact) {
        await this.searchContacts(namedContact.pushName.split(' ')[0], 'name');
      }
      
      // Test 5: Get Contact Details
      await this.getContactById(contacts[0].id);
    }
    
    // Test 6: Export Contacts
    await this.exportContacts('json');
    
    // Test 7: Start Chat Scan (optional)
    console.log('\n❓ Would you like to start a comprehensive chat scan?');
    console.log('   This will scan all chats to build a complete LID mapping database.');
    console.log('   Note: This may take several minutes and should be done when the system is not busy.');
    
    // For demo purposes, we'll skip the scan
    console.log('   Skipping chat scan for this demo. Use /api/lid/scan endpoint to trigger manually.');
    
    console.log('\n✅ === Test Suite Completed ===');
    console.log('\n📋 Available API Endpoints:');
    console.log('   GET  /api/lid/stats           - Get LID mapping statistics');
    console.log('   GET  /api/lid/contacts        - Get all contacts (supports search)');
    console.log('   GET  /api/lid/contact/:id     - Get specific contact details');
    console.log('   POST /api/lid/scan            - Start comprehensive chat scan');
    console.log('   POST /api/lid/export          - Export contacts to file');
    console.log('\n🔍 Search Examples:');
    console.log('   GET /api/lid/contacts?search=John&type=name');
    console.log('   GET /api/lid/contacts?search=628123456789&type=phone');
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  const tester = new LIDMappingTester();
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'stats':
      tester.getLIDStats();
      break;
    case 'contacts':
      tester.getAllContacts();
      break;
    case 'search':
      if (args[1] && args[2]) {
        tester.searchContacts(args[1], args[2]);
      } else {
        console.log('Usage: node test-lid-mapping.js search <term> <type>');
        console.log('Types: name, phone');
      }
      break;
    case 'contact':
      if (args[1]) {
        tester.getContactById(args[1]);
      } else {
        console.log('Usage: node test-lid-mapping.js contact <contact-id>');
      }
      break;
    case 'scan':
      tester.startChatScan();
      break;
    case 'export':
      tester.exportContacts(args[1] || 'json');
      break;
    case 'test':
    default:
      tester.runFullTest();
      break;
  }
}

module.exports = LIDMappingTester;