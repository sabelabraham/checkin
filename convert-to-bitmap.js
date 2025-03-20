const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const pdf2image = require('pdf2image');

async function convertPdfToBitmap(inputPdfPath, outputPath) {
    try {
        console.log('Starting PDF to bitmap conversion...');
        console.log(`Input PDF: ${inputPdfPath}`);
        console.log(`Output path: ${outputPath}`);

        // Convert PDF to image
        console.log('Converting PDF to image...');
        const result = await pdf2image.convertPDF(inputPdfPath, {
            density: 300, // Higher density for better quality
            outputDirectory: path.dirname(outputPath),
            outputFormat: 'png',
            page: 1 // Convert first page only
        });

        if (!result || !result[0]) {
            throw new Error('No images were generated from the PDF');
        }

        console.log('PDF converted to image successfully');
        // Get the temporary PNG file path
        const tempPngPath = result[0];
        console.log(`Temporary PNG path: ${tempPngPath}`);

        // Read the PNG image
        console.log('Processing image...');
        const image = sharp(tempPngPath);

        // Get image metadata
        const metadata = await image.metadata();
        console.log('Image metadata:', metadata);
        
        // Convert to grayscale and resize if needed
        const processedImage = image
            .grayscale()
            .resize(384, null, { // 384 is a common thermal printer width
                fit: 'inside',
                withoutEnlargement: true
            });

        // Convert to raw bitmap data
        console.log('Converting to raw bitmap data...');
        const rawData = await processedImage
            .raw()
            .toBuffer();

        // Create bitmap header
        const width = metadata.width;
        const height = metadata.height;
        const header = Buffer.alloc(54); // Standard BMP header size

        // BMP Header
        header.write('BM', 0); // Signature
        header.writeUInt32LE(54 + rawData.length, 2); // File size
        header.writeUInt32LE(54, 10); // Pixel data offset
        header.writeUInt32LE(40, 14); // Header size
        header.writeInt32LE(width, 18); // Width
        header.writeInt32LE(height, 22); // Height
        header.writeUInt16LE(1, 26); // Color planes
        header.writeUInt16LE(8, 28); // Bits per pixel
        header.writeUInt32LE(0, 30); // Compression
        header.writeUInt32LE(rawData.length, 34); // Image data size
        header.writeInt32LE(2835, 38); // Horizontal resolution
        header.writeInt32LE(2835, 42); // Vertical resolution
        header.writeUInt32LE(0, 46); // Colors in palette
        header.writeUInt32LE(0, 50); // Important colors

        // Combine header and image data
        console.log('Creating final bitmap file...');
        const bitmapData = Buffer.concat([header, rawData]);

        // Write to file
        fs.writeFileSync(outputPath, bitmapData);

        // Clean up temporary PNG file
        console.log('Cleaning up temporary files...');
        fs.unlinkSync(tempPngPath);

        console.log(`Successfully converted PDF to bitmap: ${outputPath}`);
        return true;
    } catch (error) {
        console.error('Error converting PDF to bitmap:', error);
        console.error('Error stack:', error.stack);
        return false;
    }
}

// Example usage
if (require.main === module) {
    console.log('Script started as main module');
    const inputPdf = process.argv[2] || 'input.pdf';
    const outputFile = process.argv[3] || 'output.bmp';
    
    console.log(`Checking if input PDF exists: ${inputPdf}`);
    if (!fs.existsSync(inputPdf)) {
        console.error(`Input PDF ${inputPdf} does not exist`);
        process.exit(1);
    }

    console.log('Starting conversion process...');
    convertPdfToBitmap(inputPdf, outputFile)
        .then(success => {
            if (!success) {
                console.error('Conversion failed');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('Unhandled error:', error);
            process.exit(1);
        });
}

module.exports = convertPdfToBitmap; 