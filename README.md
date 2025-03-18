# Keyboard Printer V2

A Node.js application that captures keyboard input and prints it to an Epson TM-T88 series thermal printer.

## Features

- Real-time keyboard input capture
- Direct printing to Epson TM-T88 series printers
- PDF file printing support
- Formatted output with headers and timestamps
- Docker support for easy deployment

## Requirements

- Docker and Docker Compose
- Epson TM-T88 series printer
- USB keyboard

## Setup

1. Make sure your Epson printer is connected via USB
2. Build and run the Docker container:

```bash
docker-compose up --build
```

## Usage

1. Type text and press Enter to print
2. Enter a PDF file path to print a PDF
3. Press Ctrl+C to exit

## Troubleshooting

If the printer is not detected:
1. Check if the printer is properly connected
2. Verify USB permissions
3. Check Docker logs: `docker-compose logs`

## Notes

- The container needs privileged access to access USB devices
- The application requires root access to read keyboard input
- Make sure your printer is compatible with the Epson TM-T88 series 