const fs = require('fs');
const { execSync } = require('child_process');

console.log('Testing device access...\n');

// Test input devices
console.log('Checking input devices:');
try {
    const inputDevices = fs.readdirSync('/dev/input');
    console.log('Input devices found:', inputDevices);
} catch (error) {
    console.error('Error accessing input devices:', error.message);
}

// Test USB devices
console.log('\nChecking USB devices:');
try {
    const usbDevices = execSync('lsusb').toString();
    console.log('USB devices found:\n', usbDevices);
} catch (error) {
    console.error('Error accessing USB devices:', error.message);
}

// Test printer ports
console.log('\nChecking printer ports:');
try {
    const printerPorts = execSync('lpstat -p').toString();
    console.log('Printer ports found:\n', printerPorts);
} catch (error) {
    console.error('Error accessing printer ports:', error.message);
}

// Test device permissions
console.log('\nChecking device permissions:');
try {
    const inputPermissions = fs.statSync('/dev/input');
    console.log('Input directory permissions:', inputPermissions.mode);
    
    const usbPermissions = fs.statSync('/dev/bus/usb');
    console.log('USB directory permissions:', usbPermissions.mode);
} catch (error) {
    console.error('Error checking device permissions:', error.message);
} 