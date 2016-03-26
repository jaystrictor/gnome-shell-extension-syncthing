#!/bin/sh

glib-compile-schemas schemas/

rm syncthingicon.zip
zip syncthingicon.zip convenience.js extension.js filewatcher.js metadata.json prefs.js sax.js webviewer.js icons/* schemas/*
