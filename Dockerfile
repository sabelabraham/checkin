FROM node:18-slim

# Install required packages
RUN apt-get update && apt-get install -y \
    enscript \
    ghostscript \
    udev \
    input-utils \
    evtest \
    usbutils \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Make the scripts executable
RUN chmod +x keyboard-printer-v2-api.js test-device-access.js

# Run as root to ensure access to all devices
USER root

# Command to run the application
CMD ["node", "keyboard-printer-v2-api.js"] 