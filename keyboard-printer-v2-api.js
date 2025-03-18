#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const usb = require('usb');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const pdf = require('pdf-parse');
const axios = require('axios');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

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
    106: 'RIGHT', 107: 'END', 108: 'DOWN', 109: 'PGDN', 110: 'INS', 111: 'DEL',
    // Numeric keypad codes
    71: '7', 72: '8', 73: '9', 74: '-', 75: '4', 76: '5', 77: '6', 78: '+', 79: '1',
    80: '2', 81: '3', 82: '0', 83: '.', 84: 'ENTER'
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

// Function to make API call and print response
async function makeApiCallAndPrint(barcode, printer) {
    try {
        console.log(`Making API call for barcode: ${barcode}`);
        const response = await axios.get(`https://api-oa.com/itextpdf2/en/generatePdf?requestType=result&pid=4033504562984884809&blocks=detail&callback=alp.jsonp[-1272062882]&ids=1373510&language=en&layout=tour&maptype=summer&qmap=&reload_cnt=0_0.74261605552917081742254704078&scale=s25k&workplace=api-dev-oa&filename=en-around-immenstadt.pdf`, {
            responseType: 'arraybuffer'
        });
        
        // Check if the response is a PDF
        const contentType = response.headers['content-type'];
        if (contentType && contentType.includes('application/pdf')) {
            console.log('Received PDF response, converting and printing...');
            
            // Save PDF temporarily
            const tempPdfPath = `/tmp/print_${Date.now()}.pdf`;
            fs.writeFileSync(tempPdfPath, response.data);
            
            try {
                // Print using direct commands
                console.log('Sending to printer...');
                const fd = fs.openSync(printer.devicePath, 'w');
                
                // Initialize printer
                const initCommands = Buffer.from([
                    0x1B, 0x40,        // Initialize printer
                    0x1B, 0x4C,        // Select page mode
                    0x1B, 0x54, 0x00,  // Select print direction (normal)
                    0x1B, 0x61, 0x01   // Center alignment
                ]);
                fs.writeSync(fd, initCommands);
                
                // Convert PDF to text and print it
                console.log('Converting PDF to text...');
                const pdfData = await pdf(fs.readFileSync(tempPdfPath));
                const textToPrint = 
                    "PDF Document\n" +
                    "============\n" +
                    `Pages: ${pdfData.numpages}\n` +
                    "============\n\n" +
                    pdfData.text;
                
                // Format and send the text
                const formattedText = Buffer.from(textToPrint);
                fs.writeSync(fd, formattedText);
                
                // Print and exit page mode
                fs.writeSync(fd, Buffer.from([0x0C]));  // FF - Print and return to standard mode
                
                // Feed and cut
                const endCommands = Buffer.from([
                    0x0A, 0x0A, 0x0A, 0x0A,  // Feed lines
                    0x1D, 0x56, 0x00         // Full cut
                ]);
                fs.writeSync(fd, endCommands);
                
                fs.closeSync(fd);
                console.log('Print data sent successfully');
            } finally {
                // Clean up temporary files
                if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
            }
        } else {
            console.log('Response is not a PDF, printing as text...');
            await printToEpson(response.data.toString(), printer);
        }
        
        return true;
    } catch (error) {
        console.error('Error making API call:', error.message);
        await printToEpson(`Error: ${error.message}`, printer);
        return false;
    }
}

// Class to manage multiple keyboard inputs
class KeyboardManager {
    constructor(printer) {
        this.printer = printer;
        this.keyboards = new Map(); // Map to store keyboard file descriptors
        this.currentLine = '';
        this.isShiftPressed = false;
        this.isCapsLock = false;
        this.isShuttingDown = false;
        this.workers = new Map();
    }

    async addKeyboard(devicePath) {
        try {
            const worker = new Worker(__filename, {
                workerData: { devicePath, printer: this.printer }
            });

            worker.on('message', (message) => {
                if (message.type === 'keypress') {
                    this.handleKeyPress(message.char);
                }
            });

            worker.on('error', (error) => {
                console.error(`Worker error for ${devicePath}:`, error);
                this.removeKeyboard(devicePath);
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`Worker for ${devicePath} exited with code ${code}`);
                }
                this.removeKeyboard(devicePath);
            });

            this.workers.set(devicePath, worker);
            console.log(`Added keyboard device: ${devicePath}`);
        } catch (err) {
            console.error(`Error adding keyboard ${devicePath}:`, err);
        }
    }

    handleKeyPress(char) {
        if (char === '\n') {
            console.log(`Enter pressed - Current line: "${this.currentLine}"`);
            if (this.currentLine.trim()) {
                makeApiCallAndPrint(this.currentLine.trim(), this.printer);
                this.currentLine = '';
            }
        } else if (char === null) { // Backspace
            this.currentLine = this.currentLine.slice(0, -1);
            console.log(`Backspace pressed - Current line: "${this.currentLine}"`);
        } else if (char) {
            this.currentLine += char;
            console.log(`Key pressed: "${char}" - Current line: "${this.currentLine}"`);
        }
    }

    removeKeyboard(devicePath) {
        const worker = this.workers.get(devicePath);
        if (worker) {
            try {
                worker.terminate();
                this.workers.delete(devicePath);
                console.log(`Removed keyboard device: ${devicePath}`);
            } catch (err) {
                console.error(`Error removing keyboard ${devicePath}:`, err);
            }
        }
    }

    async shutdown() {
        this.isShuttingDown = true;
        for (const devicePath of this.workers.keys()) {
            this.removeKeyboard(devicePath);
        }
    }

    getActiveKeyboards() {
        return Array.from(this.workers.keys());
    }
}

// Worker thread code
if (!isMainThread) {
    const { devicePath, printer } = workerData;
    let isShuttingDown = false;
    let isShiftPressed = false;
    let isCapsLock = false;
    let fd = null;

    const cleanup = () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        
        if (fd !== null) {
            try {
                fs.closeSync(fd);
                fd = null;
            } catch (err) {
                // Ignore errors during cleanup
            }
        }
        process.exit(0);
    };

    // Handle worker thread signals
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('SIGQUIT', cleanup);

    try {
        fd = fs.openSync(devicePath, 'r');
        const buffer = Buffer.alloc(24);

        const readLoop = () => {
            if (isShuttingDown) {
                cleanup();
                return;
            }

            try {
                const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
                if (bytesRead === 24) {
                    const type = buffer.readUInt16LE(16);
                    const code = buffer.readUInt16LE(18);
                    const value = buffer.readInt32LE(20);

                    if (type === 1) { // EV_KEY
                        if (code === 42) { // Left Shift
                            isShiftPressed = value === 1;
                            parentPort.postMessage({ type: 'shift', pressed: isShiftPressed });
                        } else if (code === 58) { // Caps Lock
                            if (value === 1) {
                                isCapsLock = !isCapsLock;
                                parentPort.postMessage({ type: 'capslock', on: isCapsLock });
                            }
                        } else if (value === 1) { // Key press
                            const char = getCharFromKeyCode(code, isShiftPressed, isCapsLock);
                            parentPort.postMessage({ type: 'keypress', char });
                        }
                    }
                }
                setImmediate(readLoop);
            } catch (err) {
                if (err.code === 'EINTR' && !isShuttingDown) {
                    setImmediate(readLoop);
                } else {
                    cleanup();
                }
            }
        };

        readLoop();
    } catch (err) {
        cleanup();
    }
} else {
    // Main process code
    let isShuttingDown = false;
    let monitorInterval = null;

    function cleanup() {
        if (isShuttingDown) return;
        isShuttingDown = true;
        
        console.log('\nShutting down...');
        
        try {
            // Clear intervals first
            if (monitorInterval) {
                clearInterval(monitorInterval);
                monitorInterval = null;
            }
            
            // Kill all processes in our group
            execSync('pkill -g ' + process.pid);
        } catch (err) {
            // Force kill our process
            process.kill(process.pid, 'SIGKILL');
        }
    }

    // Remove existing handlers
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGQUIT');

    // Add handlers
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('SIGQUIT', cleanup);

    // Handle errors
    process.on('uncaughtException', (err) => {
        console.error('Uncaught exception:', err);
        cleanup();
    });

    process.on('unhandledRejection', (err) => {
        console.error('Unhandled rejection:', err);
        cleanup();
    });

    // Start the application
    main().catch((err) => {
        console.error('Error in main:', err);
        cleanup();
    });
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
            return keyboardDevices;
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

// Start the application
async function main() {
    try {
        console.log('Starting keyboard input detector and printer...');
        
        // Wait for printer to be available
        const printer = await waitForPrinter();
        global.printer = printer; // Store printer globally
        console.log(`Found ${printer.model} printer at ${printer.devicePath}`);
        
        // Print startup notification
        await printStartupNotification(printer);
        
        // Create and store keyboard manager globally
        global.keyboardManager = new KeyboardManager(printer);
        
        // Wait for keyboard to be available and add it
        const keyboardDevices = await waitForKeyboard();
        console.log(`Using keyboard devices: ${keyboardDevices.join(', ')}`);
        
        // Add all detected keyboard devices
        for (const device of keyboardDevices) {
            await global.keyboardManager.addKeyboard(device);
        }
        
        // Print system ready notification
        await printSystemReady(printer);
        
        // Keep the process running and handle keyboard monitoring
        monitorInterval = setInterval(() => {
            if (global.isShuttingDown) {
                clearInterval(monitorInterval);
                return;
            }
            
            const currentDevices = new Set(global.keyboardManager.getActiveKeyboards());
            const availableDevices = new Set(detectKeyboardDevices());

            // Add new devices
            for (const device of availableDevices) {
                if (!currentDevices.has(device)) {
                    global.keyboardManager.addKeyboard(device);
                }
            }

            // Remove disconnected devices
            for (const device of currentDevices) {
                if (!availableDevices.has(device)) {
                    global.keyboardManager.removeKeyboard(device);
                }
            }
        }, 5000);

        // Keep the process running
        process.stdin.resume();
    } catch (err) {
        console.error('Error in main:', err.message);
        console.error('Stack trace:', err.stack);
        await cleanup();
        process.exit(0);
    }
}

// Make keyboardManager and printer globally accessible for cleanup
global.keyboardManager = null;
global.printer = null;
global.isShuttingDown = false;