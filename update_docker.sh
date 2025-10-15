#!/bin/bash

# Update script for WhatsApp AI Docker container
# This script updates the server.js with improved 405 error handling and session cleanup

echo "🔧 Updating WhatsApp AI server with improved error handling..."

# Create the updated server.js content with the fixes
cat > /tmp/server_update.js << 'EOF'
      } else if (errorCode === 428) {
        // Connection closed - likely network issue
        console.log('🟡 Connection closed error (428). Network issue detected.');
        shouldReconnect = true;
        reconnectDelay = 5000;
      } else if (errorCode === 405) {
        // Method Not Allowed - often indicates session conflicts or server-side issues
        console.log('🔴 Method Not Allowed error (405). Session conflict or server issue detected.');
        shouldReconnect = true;
        clearSession = true;
        reconnectDelay = 15000; // Longer delay for 405 errors
      } else if (errorMessage?.includes('conflict') || errorMessage?.includes('Connection Failure')) {
EOF

# Create the improved session cleanup content
cat > /tmp/session_cleanup.js << 'EOF'
      if (shouldReconnect) {
        if (clearSession) {
          // Clear session data for conflicts
          try {
            const fs = require('fs');
            const path = require('path');
            const authPath = path.join(__dirname, 'auth_info_baileys');
            if (fs.existsSync(authPath)) {
              // First try to change permissions if we're in a container
              try {
                const { execSync } = require('child_process');
                execSync(`chmod -R 755 "${authPath}"`, { stdio: 'ignore' });
                console.log('🔧 Fixed permissions for session directory');
              } catch (permError) {
                console.log('⚠️ Could not fix permissions, continuing with cleanup...');
              }
              
              // Try to remove the directory
              fs.rmSync(authPath, { recursive: true, force: true });
              console.log('✅ Session data cleared. Will require QR scan.');
            }
          } catch (error) {
            console.error('❌ Failed to clear session data:', error.message);
            // If we can't clear the session, try to clear individual files
            try {
              const fs = require('fs');
              const path = require('path');
              const authPath = path.join(__dirname, 'auth_info_baileys');
              if (fs.existsSync(authPath)) {
                const files = fs.readdirSync(authPath);
                for (const file of files) {
                  try {
                    fs.unlinkSync(path.join(authPath, file));
                    console.log(`🗑️ Removed session file: ${file}`);
                  } catch (fileError) {
                    console.log(`⚠️ Could not remove file ${file}: ${fileError.message}`);
                  }
                }
              }
            } catch (fallbackError) {
              console.error('❌ Fallback session cleanup also failed:', fallbackError.message);
            }
          }
        }
EOF

echo "✅ Update files created. Ready to apply to Docker container."
echo "📋 Next steps:"
echo "1. Copy this script to the Docker server"
echo "2. Run the script to apply the updates"
echo "3. Restart the WhatsApp AI container"