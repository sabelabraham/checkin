#!/usr/bin/env node

const fs = require('fs');
const usb = require('usb');
const pdf = require('pdf-parse');

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

// Function to format text for thermal printer
function formatTextForPrinter(text) {
    // Split text into lines and format each line
    const lines = text.split('\n');
    const formattedLines = lines.map(line => {
        // Remove any non-printable characters
        line = line.replace(/[^\x20-\x7E]/g, '');
        // Trim whitespace
        line = line.trim();
        return line;
    }).filter(line => line.length > 0); // Remove empty lines

    return formattedLines.join('\n');
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

        // Format the text with ESC/POS commands
        const formattedText = Buffer.concat([
            Buffer.from('\x1B\x40'), // Initialize printer
            Buffer.from('\x1B\x61\x01'), // Center alignment
            Buffer.from('\x1B\x21\x30'), // Double height and width
            Buffer.from('PDF Document\n'), // Header
            Buffer.from('\x1B\x21\x00'), // Normal text
            Buffer.from('\x1B\x61\x00'), // Left alignment
            Buffer.from('----------------\n'), // Separator line
            Buffer.from(text + '\n'), // The actual text
            Buffer.from('----------------\n'), // Separator line
            Buffer.from('\x1B\x61\x01'), // Center alignment
            Buffer.from(new Date().toLocaleString() + '\n'), // Timestamp
            Buffer.from('\x1B\x61\x00'), // Left alignment
            Buffer.from('\n\n\n\n\n\n\n\n\n\n'), // Increased margin before cut
            Buffer.from('\x1D\x56\x00'), // Full paper cut
        ]);
        
        // Write to printer
        const fd = fs.openSync(printer.devicePath, 'w');
        fs.writeSync(fd, formattedText);
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

// Function to process and print PDF file
async function printPDFFile(filePath, printer) {
    try {
        console.log(`Reading PDF file: ${filePath}`);
        const dataBuffer = fs.readFileSync(filePath);
        console.log('PDF file size:', dataBuffer.length, 'bytes');
        
        // Parse PDF content
        console.log('Parsing PDF content...');
        const data = await pdf(dataBuffer);
        console.log('PDF parsed successfully. Pages:', data.numpages);
        
        // Format the text content for printing
        const formattedText = formatTextForPrinter(data.text);
        
        console.log('Printing formatted content...');
        const result = await printToEpson(formattedText, printer);
        console.log('Print result:', result);
        return result;
    } catch (err) {
        console.error('Error in printPDFFile:', err.message);
        console.error('Stack trace:', err.stack);
        return false;
    }
}

// Main function
async function main() {
    try {
        console.log('Starting PDF print...');
        
        // Wait for printer to be available
        const printer = await waitForPrinter();
        console.log(`Found ${printer.model} printer at ${printer.devicePath}`);
        
        // Print the PDF file
        await printPDFFile('receipt.pdf', printer);
        
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