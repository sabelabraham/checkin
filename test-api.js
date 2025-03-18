const axios = require('axios');
const fs = require('fs');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const pdf = require('pdf-parse');

async function testApi() {
    try {
        console.log('Testing API call...');
        const response = await axios.get('https://api-oa.com/itextpdf2/en/generatePdf?requestType=result&pid=4033504562984884809&blocks=detail&callback=alp.jsonp[-1272062882]&ids=1373510&language=en&layout=tour&maptype=summer&qmap=&reload_cnt=0_0.74261605552917081742254704078&scale=s25k&workplace=api-dev-oa&filename=en-around-immenstadt.pdf', {
            responseType: 'arraybuffer'
        });
        
        console.log('Content-Type:', response.headers['content-type']);
        
        // Save the response to a file for inspection
        const tempPdfPath = '/tmp/test_response.pdf';
        fs.writeFileSync(tempPdfPath, response.data);
        console.log('Saved response to:', tempPdfPath);
        
        // Try to parse the PDF to verify it's valid
        const dataBuffer = fs.readFileSync(tempPdfPath);
        const data = await pdf(dataBuffer);
        console.log('PDF parsed successfully. Pages:', data.numpages);
        console.log('PDF content preview:', data.text.substring(0, 200) + '...');
        
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);
        }
    }
}

testApi(); 