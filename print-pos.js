#!/usr/bin/env node

const fs = require('fs');
const usb = require('usb');

// Epson TM-T88 series vendor ID (0x04b8)
const EPSON_VENDOR_ID = 0x04b8;

// Known product IDs for TM-T88 series
const EPSON_PRODUCT_IDS = {
    'TM-T88IV': 0x0202
};

// Function to get the device path for printing
function getDevicePath(device) {
    const printerPaths = [
        '/dev/usb/lp0',
        '/dev/usb/lp1',
        '/dev/usb/lp2',
        '/dev/usb/lp3',
        '/dev/lp0',
        '/dev/lp1',
        '/dev/lp2',
        '/dev/lp3'
    ];
    
    for (const path of printerPaths) {
        if (fs.existsSync(path)) {
            return path;
        }
    }
    return null;
}

// Function to detect Epson TM-T88 series printers
function detectEpsonPrinters() {
    try {
        const devices = usb.getDeviceList();
        const foundPrinters = [];

        for (const device of devices) {
            const vendorId = device.deviceDescriptor.idVendor;
            const productId = device.deviceDescriptor.idProduct;
            
            if (vendorId === EPSON_VENDOR_ID) {
                // Check for known product IDs first
                for (const [model, knownProductId] of Object.entries(EPSON_PRODUCT_IDS)) {
                    if (productId === knownProductId) {
                        const devicePath = getDevicePath(device);
                        if (devicePath) {
                            foundPrinters.push({
                                model: model,
                                vendorId: vendorId.toString(16).padStart(4, '0'),
                                productId: productId.toString(16).padStart(4, '0'),
                                devicePath: devicePath
                            });
                        }
                        break;
                    }
                }
            }
        }

        return foundPrinters;
    } catch (err) {
        console.error('Error detecting Epson printers:', err.message);
        return [];
    }
}

// Function to convert ESC/POS text to buffer
function convertEscPosToBuffer(text) {
    const lines = text.split('\n');
    const buffer = [];
    
    for (const line of lines) {
        // Skip empty lines and comments
        if (!line.trim() || line.trim().startsWith(';')) continue;
        
        // Handle ESC commands
        if (line.includes('ESC')) {
            const parts = line.split(' ');
            if (parts[1] === '@') {
                buffer.push(0x1B, 0x40); // Initialize printer
            } else if (parts[1] === 'a') {
                buffer.push(0x1B, 0x61, parseInt(parts[2])); // Alignment
            } else if (parts[1] === '!') {
                buffer.push(0x1B, 0x21, parseInt(parts[2])); // Text format
            } else if (parts[1] === 'E') {
                buffer.push(0x1B, 0x45, parseInt(parts[2])); // Bold
            } else if (parts[1] === 'i') {
                buffer.push(0x1D, 0x56, 0x00); // Cut paper
            }
        } else if (line.includes('LF')) {
            buffer.push(0x0A); // Line feed
        } else {
            // Regular text - remove quotes and add to buffer
            const text = line.replace(/"/g, '').trim();
            if (text) {
                buffer.push(...Buffer.from(text + '\n'));
            }
        }
    }
    
    return Buffer.from(buffer);
}

// Function to print to the Epson printer
async function printToEpson(text, printer) {
    try {
        console.log(`\nAttempting to print to ${printer.devicePath}`);
        
        // Check if device exists and is writable
        if (!fs.existsSync(printer.devicePath)) {
            console.log(`Device path ${printer.devicePath} does not exist`);
            return false;
        }
        
        try {
            fs.accessSync(printer.devicePath, fs.constants.W_OK);
            console.log('Device path is writable');
        } catch (err) {
            console.log(`Device path is not writable: ${err.message}`);
            return false;
        }

        // Convert ESC/POS text to buffer
        const buffer = convertEscPosToBuffer(text);
        
        // Write to printer
        const fd = fs.openSync(printer.devicePath, 'w');
        fs.writeSync(fd, buffer);
        fs.closeSync(fd);
        
        console.log('Print data sent successfully');
        return true;
    } catch (err) {
        console.error('Error printing:', err.message);
        console.error('Stack trace:', err.stack);
        return false;
    }
}

async function waitForPrinter() {
    console.log('Waiting for printer to be detected...');
    while (true) {
        const printers = detectEpsonPrinters();
        if (printers.length > 0) {
            console.log('Printer detected!');
            return printers[0];
        }
        console.log('No printer detected. Checking again in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

// Main function
async function main() {
    try {
        console.log('Starting POS receipt print...');
        
        // Read the POS file
        const posContent = fs.readFileSync('pos.txt', 'utf8');
        
        // Wait for printer to be available
        const printer = await waitForPrinter();
        console.log(`Found ${printer.model} printer at ${printer.devicePath}`);
        
        // Print the POS content
        await printToEpson(posContent, printer);
        
        console.log('Print complete!');
        process.exit(0);
    } catch (err) {
        console.error('Error in main:', err.message);
        console.error('Stack trace:', err.stack);
        process.exit(1);
    }
}

// Start the application
main(); 