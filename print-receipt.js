const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const fs = require('fs');
const path = require('path');

async function printReceipt() {
    try {
        // Initialize the printer
        const printer = new ThermalPrinter({
            type: PrinterTypes.EPSON,
            interface: '/dev/usb/lp0',  // Standard USB printer device on Linux
            characterSet: CharacterSet.PC437_USA,
            removeSpecialCharacters: false,
            lineCharacter: '-',
            width: 150,  // Set the width to match the printer's capacity (usually 42 or 48 columns)
            options: {
                timeout: 5000
            }
        });

        // Check if printer is connected
        const isConnected = await printer.isPrinterConnected();
        console.log("Printer connected:", isConnected);

        if (!isConnected) {
            throw new Error("Printer is not connected!");
        }

        // Get the path to the receipt image
        const receiptPath = path.join(__dirname, 'Page_1.png');
        console.log("Printing image from:", receiptPath);

        if (!fs.existsSync(receiptPath)) {
            throw new Error("Receipt image not found at: " + receiptPath);
        }

        // Reset printer settings and align left
        await printer.clear();
        //await printer.alignLeft();
        await printer.alignCenter();
        
        // Print the image with high density
        console.log("Printing image...");
        await printer.printImage(receiptPath, true); // true = high density printing
        
        // Cut the paper
        console.log("Cutting paper...");
        await printer.cut();
        
        // Execute the print job
        console.log("Executing print job...");
        await printer.execute();
        
        console.log("Receipt printed successfully!");
    } catch (error) {
        console.error("Error printing receipt:", error);
    }
}

// Run the print function
printReceipt(); 