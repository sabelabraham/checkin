#!/usr/bin/env node

const fs = require('fs');
const usb = require('usb');
const { execSync } = require('child_process');
const path = require('path');
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

// Function to convert PDF to image
async function convertPDFToImage(pdfPath) {
    try {
        console.log('Converting PDF to image...');
        
        // Create a temporary directory for images
        const tempDir = path.join(__dirname, 'temp_images');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        
        // Convert PDF to images using ImageMagick
        const outputPath = path.join(tempDir, 'page_%d.png');
        execSync(`convert -density 300 ${pdfPath} ${outputPath}`);
        
        // Get list of generated images
        const images = fs.readdirSync(tempDir)
            .filter(file => file.startsWith('page_') && file.endsWith('.png'))
            .sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)[0]);
                const numB = parseInt(b.match(/\d+/)[0]);
                return numA - numB;
            });
        
        return images.map(img => path.join(tempDir, img));
    } catch (err) {
        console.error('Error converting PDF to image:', err.message);
        throw err;
    }
}

// Function to print image to Epson printer
async function printImageToEpson(imagePath, printer) {
    try {
        console.log(`\nAttempting to print image: ${imagePath}`);
        
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

        // Convert image to monochrome bitmap format suitable for printer
        const tempFile = '/tmp/printer_temp.pbm';
        execSync(`convert ${imagePath} -resize 576x -monochrome ${tempFile}`);
        
        // Read the converted image data
        const imageData = fs.readFileSync(tempFile);
        
        // Skip PBM header (first few bytes that contain P4\n and dimensions)
        let headerEnd = 0;
        while (headerEnd < imageData.length) {
            if (imageData[headerEnd] === 0x0a) { // newline
                if (imageData[headerEnd - 1] >= 0x30 && imageData[headerEnd - 1] <= 0x39) { // digit
                    break;
                }
            }
            headerEnd++;
        }
        headerEnd++; // Skip the last newline
        
        const bitmapData = imageData.slice(headerEnd);
        
        // Calculate dimensions from the bitmap data
        const width = 576; // Standard width for thermal printers
        const height = Math.ceil(bitmapData.length * 8 / width);
        
        // Create ESC/POS commands for image printing
        const commands = Buffer.concat([
            Buffer.from('\x1B\x40'), // Initialize printer
            Buffer.from('\x1B\x61\x01'), // Center alignment
            Buffer.from('\x1B\x21\x30'), // Double height and width
            Buffer.from('PDF Document\n'), // Header
            Buffer.from('\x1B\x21\x00'), // Normal text
            Buffer.from('\x1B\x61\x00'), // Left alignment
            Buffer.from('----------------\n'), // Separator line
            
            // Image printing commands
            Buffer.from('\x1B\x2A\x00'), // Select bit image mode
            Buffer.from([width & 0xFF, (width >> 8) & 0xFF]), // Width in bytes
            bitmapData, // The actual bitmap data
            Buffer.from('\x0A'), // Line feed
            
            Buffer.from('\n----------------\n'), // Separator line
            Buffer.from('\x1B\x61\x01'), // Center alignment
            Buffer.from(new Date().toLocaleString() + '\n'), // Timestamp
            Buffer.from('\x1B\x61\x00'), // Left alignment
            Buffer.from('\n\n\n\n\n\n\n\n\n\n'), // Increased margin before cut
            Buffer.from('\x1D\x56\x00'), // Full paper cut
        ]);
        
        // Write to printer
        fs.writeFileSync(printer.devicePath, commands);
        
        // Clean up temporary file
        fs.unlinkSync(tempFile);
        
        console.log('Image print data sent successfully');
        return true;
    } catch (err) {
        console.error('Error printing image:', err.message);
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
        
        // Convert PDF to images
        const imagePaths = await convertPDFToImage(filePath);
        console.log(`Converted PDF to ${imagePaths.length} images`);
        
        // Print each page
        for (const imagePath of imagePaths) {
            console.log(`Printing page ${path.basename(imagePath)}...`);
            await printImageToEpson(imagePath, printer);
            // Wait between pages
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // Clean up temporary files
        const tempDir = path.join(__dirname, 'temp_images');
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        
        return true;
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