#!/bin/bash
set -e

echo "Starting application with xvfb..."
echo "Node version: $(node --version)"
echo "Current directory: $(pwd)"

exec xvfb-run -a node dist/main.js
