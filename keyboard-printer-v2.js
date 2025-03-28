#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const usb = require('usb');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const pdf = require('pdf-parse');

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
        const formattedText = 
            "PDF Document Print\n" +
            "----------------\n" +
            `Title: ${data.info.Title || 'Untitled'}\n` +
            `Pages: ${data.numpages}\n` +
            "----------------\n\n" +
            data.text + "\n";  // This contains all the text from the PDF
            
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

// Epson TM-T88 series printer models
const EPSON_T88_MODELS = [
    'TM-T88III',
    'TM-T88IV',
    'TM-T88V',
    'TM-T88VI'
];

// Epson TM-T88 series vendor ID (0x04b8)
const EPSON_VENDOR_ID = 0x04b8;

// Known product IDs for TM-T88 series
const EPSON_PRODUCT_IDS = {
    'TM-T88IV': 0x0202
};

// Key code mapping for common keys
const keyCodeMap = {
    1: 'ESC', 2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7', 9: '8', 10: '9',
    11: '0', 12: '-', 13: '=', 14: 'BACKSPACE', 15: 'TAB', 16: 'q', 17: 'w', 18: 'e', 19: 'r',
    20: 't', 21: 'y', 22: 'u', 23: 'i', 24: 'o', 25: 'p', 26: '[', 27: ']', 28: 'ENTER',
    29: 'CTRL', 30: 'a', 31: 's', 32: 'd', 33: 'f', 34: 'g', 35: 'h', 36: 'j', 37: 'k',
    38: 'l', 39: ';', 40: "'", 41: '`', 42: 'SHIFT', 43: '\\', 44: 'z', 45: 'x', 46: 'c',
    47: 'v', 48: 'b', 49: 'n', 50: 'm', 51: ',', 52: '.', 53: '/', 54: 'RSHIFT',
    56: 'LALT', 57: 'SPACE', 58: 'CAPSLOCK', 59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4',
    63: 'F5', 64: 'F6', 65: 'F7', 66: 'F8', 67: 'F9', 68: 'F10', 87: 'F11', 88: 'F12',
    96: 'ENTER', 97: 'RCTRL', 102: 'HOME', 103: 'UP', 104: 'PGUP', 105: 'LEFT',
    106: 'RIGHT', 107: 'END', 108: 'DOWN', 109: 'PGDN', 110: 'INS', 111: 'DEL'
};

// State for accumulating keystrokes
const inputBuffer = {
    line: '',
    shift: false,
    capsLock: false
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
                Buffer.from('PRINT TEST\n'), // Header
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
        thermalPrinter.println('PRINT TEST');
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

// Convert key code to character, considering shift and caps lock
function getCharFromKeyCode(code, isShiftPressed, isCapsLock) {
    if (keyCodeMap[code]) {
        const key = keyCodeMap[code];

        if (key === 'SPACE') return ' ';
        if (key === 'BACKSPACE') return null;
        if (key === 'ENTER') return '\n';
        if (key === 'TAB') return '\t';
        
        if (key.length === 1 && key.match(/[a-z]/)) {
            return (isShiftPressed !== isCapsLock) ? key.toUpperCase() : key;
        }
        
        if (isShiftPressed) {
            const shiftMap = {
                '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
                '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
                '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|',
                ';': ':', "'": '"', ',': '<', '.': '>', '/': '?',
                '`': '~'
            };
            if (shiftMap[key]) return shiftMap[key];
        }
        
        if (key.length === 1) return key;
    }
    return '';
}

// Function to create and print PDF from text input
async function createAndPrintPDF(text, printer) {
    try {
        console.log('Starting PDF creation process...');
        // Create a temporary text file with formatted content
        const timestamp = new Date().toLocaleString();
        const formattedText = 
            "Keyboard Input Print\n" +
            "----------------\n" +
            `Time: ${timestamp}\n` +
            "----------------\n\n" +
            text + "\n";
            
        console.log('Writing text to temp_input.txt...');
        fs.writeFileSync('temp_input.txt', formattedText);
        
        console.log('Converting to PostScript...');
        execSync('enscript -p temp.ps temp_input.txt');
        
        console.log('Converting PostScript to PDF...');
        execSync('ps2pdf temp.ps temp_output.pdf');
        
        console.log('Printing the PDF...');
        const result = await printPDFFile('temp_output.pdf', printer);
        console.log('PDF print result:', result);
        
        console.log('Cleaning up temporary files...');
        fs.unlinkSync('temp_input.txt');
        fs.unlinkSync('temp.ps');
        fs.unlinkSync('temp_output.pdf');
        
        return true;
    } catch (err) {
        console.error('Error in createAndPrintPDF:', err.message);
        console.error('Stack trace:', err.stack);
        return false;
    }
}

// Function to read keyboard input using both console and direct device
function readKeyboardInput(printer) {
    console.log('Start typing - Press ENTER to send text to printer, Ctrl+C to exit');
    
    // Get keyboard device path
    const keyboardDevices = detectKeyboardDevices();
    if (keyboardDevices.length === 0) {
        console.log('No keyboard devices found. Using default device /dev/input/event3');
        keyboardDevices.push('/dev/input/event3');
    }
    
    const devicePath = keyboardDevices[0];
    console.log('Using keyboard device:', devicePath);
    
    // Open keyboard device
    const fd = fs.openSync(devicePath, 'r');
    let isRunning = true;
    
    // Simple signal handler for Ctrl+C
    process.on('SIGINT', () => {
        console.log('\nExiting...');
        isRunning = false;
        try {
            fs.closeSync(fd);
        } catch (err) {
            console.error('Error closing file descriptor:', err.message);
        }
        process.exit(0);
    });
    
    // Read keyboard events from device
    const buffer = Buffer.alloc(24);
    function readEvents() {
        if (!isRunning) return;
        
        try {
            const bytesRead = fs.readSync(fd, buffer, 0, 24, null);
            if (bytesRead === 24) {
                const type = buffer.readUInt16LE(16);
                const code = buffer.readUInt16LE(18);
                const value = buffer.readInt32LE(20);
                
                // Handle key events
                if (type === 1) { // EV_KEY
                    if (value === 1) { // Key down
                        const char = getCharFromKeyCode(code, inputBuffer.shift, inputBuffer.capsLock);
                        if (char === '\n') {
                            console.log('\nProcessing:', inputBuffer.line);
                            if (printer) {
                                printToEpson(inputBuffer.line, printer).catch(err => {
                                    console.error('Error printing:', err.message);
                                });
                            }
                            inputBuffer.line = '';
                        } else if (char === null) { // Backspace
                            if (inputBuffer.line.length > 0) {
                                inputBuffer.line = inputBuffer.line.slice(0, -1);
                                process.stdout.write('\b \b');
                            }
                        } else if (char !== '') {
                            inputBuffer.line += char;
                            process.stdout.write(char);
                        }
                    } else if (value === 0) { // Key up
                        if (code === 42 || code === 54) { // Left/Right Shift
                            inputBuffer.shift = false;
                        }
                    }
                }
            }
            if (isRunning) {
                readEvents();
            }
        } catch (err) {
            if (err.code === 'EINTR') {
                if (isRunning) {
                    console.log('Keyboard read interrupted, retrying...');
                    readEvents();
                }
            } else {
                console.error('Error reading keyboard:', err.message);
                isRunning = false;
                try {
                    fs.closeSync(fd);
                } catch (err) {
                    console.error('Error closing file descriptor:', err.message);
                }
                process.exit(1);
            }
        }
    }
    
    // Start reading events
    readEvents();
}

// Function to detect keyboard devices
function detectKeyboardDevices() {
    const keyboardDevices = [];
    
    try {
        // First try to find keyboard devices in /dev/input/event*
        const eventDevices = fs.readdirSync('/dev/input')
            .filter(file => file.startsWith('event'));
            
        for (const device of eventDevices) {
            const devicePath = `/dev/input/${device}`;
            try {
                // Check if it's a keyboard device by reading its properties
                const deviceInfo = execSync(`udevadm info -a -n ${devicePath} | grep -i keyboard`, { encoding: 'utf8' });
                if (deviceInfo.includes('keyboard')) {
                    keyboardDevices.push(devicePath);
                }
            } catch (err) {
                // Skip if we can't read the device info
                continue;
            }
        }
        
        // If no keyboard devices found, try /dev/input/by-id/*kbd*
        if (keyboardDevices.length === 0) {
            try {
                const byIdDevices = fs.readdirSync('/dev/input/by-id')
                    .filter(file => file.toLowerCase().includes('kbd'));
                    
                for (const device of byIdDevices) {
                    const devicePath = `/dev/input/by-id/${device}`;
                    if (fs.existsSync(devicePath)) {
                        keyboardDevices.push(devicePath);
                    }
                }
            } catch (err) {
                console.log('No keyboard devices found in /dev/input/by-id');
            }
        }
        
        // If still no devices found, try evtest
        if (keyboardDevices.length === 0) {
            try {
                const evtestOutput = execSync('evtest --list-devices', { encoding: 'utf8' });
                const lines = evtestOutput.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes('keyboard')) {
                        const devicePath = lines[i + 1].trim().split(' ')[0];
                        if (devicePath && fs.existsSync(devicePath)) {
                            keyboardDevices.push(devicePath);
                        }
                        i++; // Skip the next line as it's the device path
                    }
                }
            } catch (err) {
                console.log('evtest failed to list devices:', err.message);
            }
        }
        
        console.log('Found keyboard devices:', keyboardDevices);
        return keyboardDevices;
    } catch (err) {
        console.error('Error detecting keyboard devices:', err.message);
        return [];
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

async function waitForKeyboard() {
    console.log('Waiting for keyboard to be detected...');
    while (true) {
        const keyboardDevices = detectKeyboardDevices();
        if (keyboardDevices.length > 0) {
            console.log('Keyboard detected!');
            return keyboardDevices[0];
        }
        console.log('No keyboard detected. Checking again in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

async function printStartupNotification(printer) {
    const startupMessage = 
        "SYSTEM STARTUP\n" +
        "=============\n" +
        `Time: ${new Date().toLocaleString()}\n` +
        "Status: Initializing...\n" +
        "=============\n";
    
    await printToEpson(startupMessage, printer);
}

async function printSystemReady(printer) {
    const readyMessage = 
        "SYSTEM READY\n" +
        "============\n" +
        `Time: ${new Date().toLocaleString()}\n` +
        "Status: Ready for input\n" +
        "============\n";
    
    await printToEpson(readyMessage, printer);
}

async function main() {
    try {
        console.log('Starting keyboard input detector and printer...');
        
        // Wait for printer to be available
        const printer = await waitForPrinter();
        console.log(`Found ${printer.model} printer at ${printer.devicePath}`);
        
        // Print startup notification
        await printStartupNotification(printer);
        
        // Wait for keyboard to be available
        const keyboardDevice = await waitForKeyboard();
        console.log(`Using keyboard device: ${keyboardDevice}`);
        
        // Print system ready notification
        await printSystemReady(printer);
        
        // Start the keyboard input reading
        readKeyboardInput(printer);
    } catch (err) {
        console.error('Error in main:', err.message);
        console.error('Stack trace:', err.stack);
        process.exit(1);
    }
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\nExiting...');
    process.exit(0);
});

// Start the application
main().catch(err => {
    console.error('Error in main:', err);
    process.exit(1);
}); 