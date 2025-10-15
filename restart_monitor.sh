#!/bin/bash

# WhatsApp AI Container Restart Monitor
# This script monitors for restart signals and handles container restarts

CONTAINER_NAME="whatsapp-ai-server"
SIGNAL_FILE="/tmp/whatsapp_restart_required"
VOLUME_NAME="whatsapp-ai-server_auth_info_baileys"

echo "🔍 Starting WhatsApp AI restart monitor..."
echo "📦 Monitoring container: $CONTAINER_NAME"
echo "📁 Signal file: $SIGNAL_FILE"

while true; do
  # Check if container is running
  if docker ps --format "table {{.Names}}" | grep -q "^$CONTAINER_NAME$"; then
    # Check for restart signal inside container
    if docker exec $CONTAINER_NAME test -f $SIGNAL_FILE 2>/dev/null; then
      echo "🚨 Restart signal detected!"
      
      # Get timestamp from signal file
      TIMESTAMP=$(docker exec $CONTAINER_NAME cat $SIGNAL_FILE 2>/dev/null || echo "unknown")
      echo "⏰ Signal timestamp: $TIMESTAMP"
      
      echo "🛑 Stopping container..."
      docker stop $CONTAINER_NAME
      
      echo "🗑️ Clearing session data volume..."
      docker run --rm -v $VOLUME_NAME:/data alpine sh -c "rm -rf /data/*"
      
      echo "🔄 Starting container..."
      docker start $CONTAINER_NAME
      
      echo "✅ Container restarted successfully!"
      echo "⏳ Waiting 30 seconds before next check..."
      sleep 30
    else
      # No signal, wait 10 seconds
      sleep 10
    fi
  else
    echo "⚠️ Container $CONTAINER_NAME is not running"
    sleep 30
  fi
done