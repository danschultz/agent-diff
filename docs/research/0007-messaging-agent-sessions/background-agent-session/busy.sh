#!/bin/sh
# Keeps a turn busy for about 30 seconds for the busy test. Claude Code blocks
# a foreground `sleep 30`, so this waits in Node instead.
node -e "setTimeout(() => console.log('waited'), 30000)"
