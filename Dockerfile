# Use Node.js 20 LTS as base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for WhatsApp functionality
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    librsvg-dev

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create auth directory with proper permissions
RUN mkdir -p auth_info_baileys && \
    chown -R node:node auth_info_baileys

# Create docs and data directories
RUN mkdir -p docs data && \
    chown -R node:node docs data

# Create startup script to fix permissions at runtime
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'mkdir -p /app/auth_info_baileys /app/docs /app/data' >> /app/start.sh && \
    echo 'chown -R node:node /app/auth_info_baileys /app/docs /app/data' >> /app/start.sh && \
    echo 'exec su-exec node "$@"' >> /app/start.sh && \
    chmod +x /app/start.sh

# Install su-exec for user switching
RUN apk add --no-cache su-exec

# Expose port (configurable via environment variable)
EXPOSE ${PORT:-8193}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8193}/api/status || exit 1

# Start the application with permission fix
CMD ["/app/start.sh", "node", "server.js"]