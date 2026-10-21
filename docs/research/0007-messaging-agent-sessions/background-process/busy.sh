#!/bin/sh
# Keeps a tool call busy for 30 seconds, for testing messages that arrive mid-turn.
node -e 'setTimeout(() => console.log("busy done"), 30000)'
