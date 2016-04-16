#!/bin/sh

glib-compile-schemas schemas/

rm syncthingicon.zip
zip syncthingicon.zip convenience.js extension.js filewatcher.js metadata.json prefs.js README.md sax.js stylesheet.css webviewer.js icons/* schemas/*
