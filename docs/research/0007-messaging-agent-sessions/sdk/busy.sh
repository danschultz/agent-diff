#!/bin/sh
# Keeps an agent session busy for 30 seconds, then prints "busy done".
node -e 'setTimeout(() => console.log("busy done"), 30000)'
