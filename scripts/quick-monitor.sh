#!/bin/bash

# Quick script to create session and monitor status

URL="${1:-https://wikipedia.com/wiki/nepal}"

echo "Creating session and monitoring..."
echo "URL: $URL"
echo ""

# Use Node.js script
node scripts/create-and-monitor.js "$URL"

