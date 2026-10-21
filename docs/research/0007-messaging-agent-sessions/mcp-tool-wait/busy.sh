#!/bin/sh
# Keeps an agent session busy for $1 seconds (default 30) without `sleep`.
node -e "setTimeout(() => console.log('busy done'), ${1:-30} * 1000)"
