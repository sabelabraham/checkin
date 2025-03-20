#!/usr/bin/env node

const fs = require('fs');
const usb = require('usb');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');

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

// Function to print text to the Epson printer
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

        // Try direct file write first
        try {
            console.log('Attempting direct file write...');
            const fd = fs.openSync(printer.devicePath, 'w');
            
            // Format the text with ESC/POS commands
            const formattedText = Buffer.concat([
                Buffer.from('\x1B\x40'), // Initialize printer
                Buffer.from('\x1B\x61\x01'), // Center alignment
                Buffer.from('\x1B\x21\x30'), // Double height and width
                Buffer.from('PRINTER TEST\n'), // Header
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
            
            fs.writeSync(fd, formattedText);
            fs.closeSync(fd);
            console.log('Direct file write successful');
            return true;
        } catch (err) {
            console.log(`Direct file write failed: ${err.message}`);
        }

        // If direct write fails, try thermal printer library
        console.log('Attempting thermal printer library...');
        const thermalPrinter = new ThermalPrinter({
            type: PrinterTypes.EPSON,
            interface: printer.devicePath,
            characterSet: CharacterSet.PC437_USA,
            removeSpecialCharacters: false,
            lineCharacter: '-',
        });
        
        console.log('Checking printer connection...');
        const isConnected = await thermalPrinter.isPrinterConnected();
        if (!isConnected) {
            console.log('Printer is not connected');
            return false;
        }
        
        console.log('Printer is connected! Sending print job...');
        
        // Format the print job
        thermalPrinter.alignCenter();
        thermalPrinter.bold(true);
        thermalPrinter.setTextSize(2, 2); // Double height and width
        thermalPrinter.println('PRINTER TEST');
        thermalPrinter.setTextSize(1, 1); // Normal size
        thermalPrinter.bold(false);
        thermalPrinter.drawLine();
        
        thermalPrinter.alignLeft();
        thermalPrinter.println(text);
        thermalPrinter.drawLine();
        
        thermalPrinter.alignCenter();
        thermalPrinter.println(new Date().toLocaleString());
        
        // Feed paper and cut with increased margin
        thermalPrinter.println('\n\n\n\n\n\n\n\n\n\n');
        thermalPrinter.cut();
        
        console.log('Executing print job...');
        await thermalPrinter.execute();
        console.log('Print job sent successfully!');
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
        console.log('Starting printer test...');
        
        // Wait for printer to be available
        const printer = await waitForPrinter();
        console.log(`Found ${printer.model} printer at ${printer.devicePath}`);
        
        // Print test message
        const testMessage = 
            "This is a test print\n" +
            "==================\n" +
            "If you can read this,\n" +
            "the printer is working!\n" +
            "==================";
            
        await printToEpson(testMessage, printer);
        
        console.log('Test complete!');
        process.exit(0);
    } catch (err) {
        console.error('Error in main:', err.message);
        console.error('Stack trace:', err.stack);
        process.exit(1);
    }
}

// Start the application
main(); 