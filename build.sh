#!/bin/sh

glib-compile-schemas schemas/

zip syncthingicon.zip convenience.js extension.js prefs.js metadata.json icons/* schemas/*
